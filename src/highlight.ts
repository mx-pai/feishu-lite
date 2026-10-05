import { Decoration, DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { Editor, MarkdownPostProcessorContext, Notice } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";
import type { ListOption } from "./util";

/**
 * 文本高亮：默认 ==文字== + 彩色 =={red}文字==
 * - 阅读视图：MarkdownPostProcessor 替换为 <mark class="fl-hl-*">；
 *   兼容原生 == 先行渲染出的 <mark>{color}文字</mark>（剥前缀 + 换配色）
 * - 编辑视图（Live Preview）：CM6 装饰（仅用 mark 装饰，避免与原生 == 渲染的 replace 装饰冲突）
 */

export const HL_COLORS = [
	{ label: "红色", value: "red" },
	{ label: "橙色", value: "orange" },
	{ label: "黄色", value: "yellow" },
	{ label: "绿色", value: "green" },
	{ label: "蓝色", value: "blue" },
	{ label: "紫色", value: "purple" },
	{ label: "灰色", value: "gray" },
];

/** 高亮选项（含「默认」= 原生 ==文字==，不写颜色标记） */
export const HL_COLOR_OPTIONS: ListOption<string>[] = [
	{ label: "默认（黄色）", value: "", hint: "原生 ==文字==" },
	...HL_COLORS,
];

const COLOR_SET = new Set(HL_COLORS.map((c) => c.value));
const HL_PATTERN = "==\\{([a-z]+)\\}([^=\\n]+?)==";

export function pickColorAndHighlight(_plugin: FeishuLitePlugin, editor: Editor): void {
	openCascade(editor, "高亮 · 选颜色", HL_COLOR_OPTIONS, (color) => wrapHighlight(editor, color));
}

/** 应用文本高亮；color 为空串时用原生高亮（==文字==）。 */
export function wrapHighlight(editor: Editor, color: string): void {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	if (from.line !== to.line) {
		new Notice("高亮暂不支持跨行选择，请逐行设置");
		return;
	}
	const open = color ? `=={${color}}` : "==";
	if (from.ch === to.ch) {
		editor.replaceSelection(`${open}文字==`);
		const wordStart = from.ch + open.length; // 跳过 "==" 或 "=={color}"
		editor.setSelection({ line: from.line, ch: wordStart }, { line: from.line, ch: wordStart + 2 });
	} else {
		editor.replaceSelection(`${open}${editor.getSelection()}==`);
	}
}

/** 阅读视图渲染 */
export function highlightPostProcessor(el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
	// 路径 1：裸文本 =={color}文字==（原生 == 尚未处理的场景，直接替换文本节点）
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const value = (node as Text).nodeValue;
			if (!value || !value.includes("=={")) return NodeFilter.FILTER_REJECT;
			if (node.parentElement?.closest("code, pre, a")) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	const targets: Text[] = [];
	let n: Node | null;
	while ((n = walker.nextNode())) targets.push(n as Text);

	for (const node of targets) {
		const text = node.nodeValue ?? "";
		const re = new RegExp(HL_PATTERN, "g");
		const frag = createFragment();
		let last = 0;
		let changed = false;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
			if (COLOR_SET.has(m[1])) {
				const mark = createEl("mark", { cls: `fl-hl-${m[1]}` });
				mark.textContent = m[2];
				frag.appendChild(mark);
				changed = true;
			} else {
				frag.appendChild(document.createTextNode(m[0]));
			}
			last = m.index + m[0].length;
		}
		if (!changed) continue;
		if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
		node.parentNode?.replaceChild(frag, node);
	}

	// 路径 2：阅读视图里 Obsidian 原生 == 会先于本处理器把 =={red}文字== 渲染成
	// <mark>{red}文字</mark>（花括号原样保留、默认黄底）。此时回改已生成的 <mark>：
	// 剥掉首文本节点的 "{color}" 前缀，并换上本插件配色类。
	el.querySelectorAll("mark").forEach((mark) => {
		if (mark.closest("code, pre, a")) return;
		if (mark.classList.contains("fl-comment-read")) return;
		if (Array.from(mark.classList).some((cls) => cls.startsWith("fl-hl-"))) return;
		const prefix = /^\{([a-z]+)\}/.exec(mark.textContent ?? "");
		if (!prefix || !COLOR_SET.has(prefix[1])) return;
		const first = mark.firstChild;
		if (!first || first.nodeType !== Node.TEXT_NODE) return;
		const value = first.nodeValue ?? "";
		if (!value.startsWith(prefix[0])) return;
		first.nodeValue = value.slice(prefix[0].length);
		mark.classList.add(`fl-hl-${prefix[1]}`);
	});
}

/** 编辑视图（Live Preview）渲染 */
export function highlightViewPlugin(plugin: FeishuLitePlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, plugin);
			}

			update(update: ViewUpdate): void {
				// 双拼/拼音等 IME 组合期间会产生高频 viewport 测量更新，
				// 组合内容尚未落盘，此时重建装饰没有收益，只会拖慢连打
				if (update.view.composing && !update.docChanged) return;
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

function buildDecorations(view: EditorView, plugin: FeishuLitePlugin): DecorationSet {
	if (!plugin.settings.lpHighlight) return Decoration.none;
	if (view.dom.closest(".is-source-mode")) return Decoration.none;

	const ranges: { from: number; to: number; deco: Decoration }[] = [];
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		// 快速预检：多数行根本没有 ==，先做一次廉价扫描，避免白白跑正则
		if (!text.includes("==")) continue;
		const re = new RegExp(HL_PATTERN, "g");
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			const color = m[1];
			if (!COLOR_SET.has(color)) continue;
			const startAbs = from + m.index;
			const contentStart = startAbs + 4 + color.length;
			const contentEnd = startAbs + m[0].length - 2;
			// 前缀/后缀用 mark 装饰 + CSS 隐藏（不用 replace 装饰，避免与原生 == 的渲染冲突）
			ranges.push({ from: startAbs, to: contentStart, deco: Decoration.mark({ class: "fl-hl-syntax" }) });
			ranges.push({ from: contentStart, to: contentEnd, deco: Decoration.mark({ class: `fl-hl-${color}` }) });
			ranges.push({ from: contentEnd, to: startAbs + m[0].length, deco: Decoration.mark({ class: "fl-hl-syntax" }) });
		}
	}
	if (!ranges.length) return Decoration.none;
	ranges.sort((a, b) => a.from - b.from || a.to - b.to);
	return Decoration.set(
		ranges.map((r) => r.deco.range(r.from, r.to)),
		true
	);
}
