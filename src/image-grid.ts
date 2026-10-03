import { Editor, Notice } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";
import { parseImageLine, toGridBlock } from "./naming";
import { ImagePickerModal } from "./image-picker";

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
