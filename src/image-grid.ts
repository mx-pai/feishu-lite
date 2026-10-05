import { Editor, MarkdownRenderChild, Notice } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";
import { parseImageLine, toGridBlock } from "./naming";
import { ImagePickerModal } from "./image-picker";
import { isImagePath } from "./util";

const COLS_OPTIONS = [
	{ label: "2 栏", value: 2, hint: "两列并排" },
	{ label: "3 栏", value: 3, hint: "三列并排" },
	{ label: "4 栏", value: 4, hint: "四列并排" },
];

const GRID_HEADER = /^\s*>\s*\[!img-[234]\]\s*$/i;

function pickColumns(editor: Editor, title: string, onPick: (cols: number) => void): void {
	openCascade(editor, title, COLS_OPTIONS, onPick);
}

/** 插入指定栏数的空骨架，光标停在内容行 */
export function insertGridSkeletonCols(editor: Editor, cols: number): void {
	const n = Math.min(Math.max(Math.round(cols), 2), 4);
	editor.replaceSelection(`\n> [!img-${n}]\n> \n`);
	const end = editor.getCursor();
	editor.setCursor({ line: end.line - 1, ch: 2 });
}

/** 插入一个空的图片分栏骨架（先选列数），光标停在内容行 */
export function insertGridSkeleton(_plugin: FeishuLitePlugin, editor: Editor): void {
	pickColumns(editor, "图片分栏 · 选列数", (cols) => insertGridSkeletonCols(editor, cols));
}

/** 把选中的图片行包成网格（自动去掉尺寸前缀、保留 alt） */
export function wrapSelectionIntoGrid(_plugin: FeishuLitePlugin, editor: Editor): void {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	if (from.line === to.line && from.ch === to.ch) {
		new Notice("请先选中要成栏的图片行");
		return;
	}
	const embeds: string[] = [];
	for (let l = from.line; l <= to.line; l++) {
		const line = editor.getLine(l);
		if (!line.trim()) continue;
		const parsed = parseImageLine(line);
		if (!parsed) {
			new Notice(`第 ${l + 1} 行不是图片行，请只选中图片行`);
			return;
		}
		embeds.push(parsed.embed);
	}
	if (!embeds.length) {
		new Notice("选中内容里没有图片");
		return;
	}
	pickColumns(editor, "包成图片分栏 · 选列数", (cols) => {
		const block = toGridBlock(embeds, cols);
		editor.replaceRange(block, { line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
	});
}

/** 把光标所在的图片分栏块还原为普通图片行 */
export function unwrapGrid(_plugin: FeishuLitePlugin, editor: Editor): void {
	const cursor = editor.getCursor();
	let startLine = -1;
	for (let l = cursor.line; l >= 0 && cursor.line - l <= 500; l--) {
		const line = editor.getLine(l);
		if (GRID_HEADER.test(line)) {
			startLine = l;
			break;
		}
		if (l < cursor.line && line.trim() !== "" && !/^\s*>/.test(line)) break;
	}
	if (startLine < 0) {
		new Notice("光标不在图片分栏块内");
		return;
	}
	let endLine = startLine;
	const last = editor.lastLine();
	while (endLine + 1 <= last && /^\s*>/.test(editor.getLine(endLine + 1))) endLine++;

	const content: string[] = [];
	for (let l = startLine + 1; l <= endLine; l++) {
		content.push(editor.getLine(l).replace(/^\s*>\s?/, ""));
	}
	while (content.length && content[content.length - 1].trim() === "") content.pop();

	editor.replaceRange(
		content.join("\n"),
		{ line: startLine, ch: 0 },
		{ line: endLine, ch: editor.getLine(endLine).length }
	);
	new Notice("已取消分栏");
}

/** 打开图库多选插入器；≥2 张时按默认列数包成网格 */
export function openImagePicker(plugin: FeishuLitePlugin, editor: Editor, sourcePath: string): void {
	new ImagePickerModal(plugin.app, (files) => {
		const links = files.map((f) => "!" + plugin.app.fileManager.generateMarkdownLink(f, sourcePath));
		if (links.length === 1) {
			editor.replaceSelection(links[0] + "\n");
			return;
		}
		const cols = Math.min(Math.max(plugin.settings.defaultColumns, 2), 4);
		editor.replaceSelection(`\n${toGridBlock(links, cols)}\n`);
	}, {
		scope: plugin.settings.pickerScope,
		sort: plugin.settings.pickerSort,
	}).open();
}

const GRID_CONTENT = '.callout:is([data-callout="img-2"],[data-callout="img-3"],[data-callout="img-4"]) .callout-content';

/** 图片嵌入可能尚未生成 img；先按嵌入节点判定，兼容异步加载 */
function isImageEmbed(el: Element): boolean {
	return el.matches("img, .image-embed, .fl-image-figure") ||
		(el.matches(".internal-embed") && isImagePath(el.getAttribute("src") ?? "")) ||
		(el.tagName === "A" && !el.textContent?.trim() && !!el.querySelector("img"));
}

/** 把纯图片段落展平成共享网格，保留原嵌入节点、点击处理和 Markdown 源码 */
export function syncGridEmptyState(root: HTMLElement): void {
	const contents = Array.from(root.querySelectorAll<HTMLElement>(GRID_CONTENT));
	if (root.matches(GRID_CONTENT)) contents.unshift(root);
	for (const content of contents) {
		for (const p of Array.from(content.children)) {
			if (p.tagName !== "P") continue;
			const nodes = Array.from(p.childNodes);
			const onlyImages = nodes.every((node) => {
				if (node.nodeType === 3) return !node.textContent?.trim();
				if (node.nodeType !== 1) return false;
				const el = node as Element;
				return el.tagName === "BR" || isImageEmbed(el);
			});
			if (!onlyImages) continue;
			p.replaceWith(...Array.from(p.children).filter(isImageEmbed));
		}
		const hasImage = Array.from(content.querySelectorAll("img, .internal-embed, .image-embed")).some(isImageEmbed);
		content.classList.toggle("fl-grid-empty", !hasImage);
	}
}

/** 只跟踪分栏相关 DOM 变化；每个渲染根独立防抖，卸载时释放 */
export function observeImageGrids(root: HTMLElement): () => void {
	const owner = root.ownerDocument.defaultView ?? window;
	let timer: number | null = null;
	const observer = new MutationObserver((records) => {
		const changed = records.some((record) => {
			const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
			return !!target?.closest(GRID_CONTENT) || Array.from(record.addedNodes).some((node) =>
				node.nodeType === 1 && ((node as Element).matches(GRID_CONTENT) || !!(node as Element).querySelector(GRID_CONTENT))
			);
		});
		if (!changed) return;
		if (timer !== null) owner.clearTimeout(timer);
		timer = owner.setTimeout(() => {
			timer = null;
			syncGridEmptyState(root);
		}, 120);
	});
	syncGridEmptyState(root);
	observer.observe(root, { childList: true, subtree: true });
	return () => {
		observer.disconnect();
		if (timer !== null) owner.clearTimeout(timer);
	};
}

class ImageGridRenderChild extends MarkdownRenderChild {
	private stopObserving?: () => void;

	onload(): void {
		this.stopObserving = observeImageGrids(this.containerEl);
	}

	onunload(): void {
		this.stopObserving?.();
	}
}

/** 阅读视图：等待图片嵌入完成，并随渲染块生命周期清理监听 */
export function imageGridPostProcessor(root: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	if (root.matches(GRID_CONTENT) || root.querySelector(GRID_CONTENT)) {
		ctx.addChild(new ImageGridRenderChild(root));
	}
}
