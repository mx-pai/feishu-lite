import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { Notice } from "obsidian";
import type { Editor } from "obsidian";
import type FeishuLitePlugin from "./main";
import { isPluginEnabled } from "./util";
import type { Cell } from "./table-core";
import { cellIndexAt, deleteCol, deleteRow, formatTableLines, insertCol, insertRow, isSeparatorRow, parseRow } from "./table-core";

/**
 * 表格增强（炼化 Advanced Tables 核心行为）：
 * - Tab → 下一格；Shift+Tab → 上一格；Enter → 下一行同列
 * - 每次跳格顺带把整表格式化（CJK 记 2 宽对齐）；末行末格 Tab/Enter 自动补新行
 * - 「Advanced Tables」插件启用时自动让位；纯源码模式不拦截
 */
const AT_ID = "table-editor-obsidian";

export function tableEnhanceExtension(plugin: FeishuLitePlugin) {
	return Prec.highest(
		keymap.of([
			{ key: "Tab", run: (view) => runNav(plugin, view, 1) },
			{ key: "Shift-Tab", run: (view) => runNav(plugin, view, -1) },
			{ key: "Enter", run: (view) => runNav(plugin, view, 0) },
		])
	);
}

function active(plugin: FeishuLitePlugin): boolean {
	return plugin.settings.tableAssist && !isPluginEnabled(plugin.app, AT_ID);
}

interface TableAround {
	/** 表格首行（1-based 行号） */
	startLine: number;
	/** 表格末行（1-based） */
	endLine: number;
	lines: string[];
	rows: Cell[][];
}

/** 取光标所在表格（连续「标准管道行」且至少含一个分隔行），否则 null */
function getTableAround(view: EditorView): TableAround | null {
	const state = view.state;
	if (state.selection.ranges.length !== 1) return null;
	const head = state.selection.main.head;
	const cur = state.doc.lineAt(head);
	if (!parseRow(cur.text)) return null;

	let start = cur.number;
	while (start > 1 && parseRow(state.doc.line(start - 1).text)) start--;
	let end = cur.number;
	while (end < state.doc.lines && parseRow(state.doc.line(end + 1).text)) end++;

	const lines: string[] = [];
	const rows: Cell[][] = [];
	for (let n = start; n <= end; n++) {
		const t = state.doc.line(n).text;
		const cells = parseRow(t);
		if (!cells) return null;
		lines.push(t);
		rows.push(cells);
	}
	if (!rows.some((r) => isSeparatorRow(r))) return null; // 不是表格（缺分隔行）→ 不接管
	return { startLine: start, endLine: end, lines, rows };
}

/**
 * dir = 1 下一格，-1 上一格，0 下一行同列（Enter）。
 * 统一流程：组装行（可能追加新行）→ 格式化 → 整段替换 → 光标落到目标格内容末尾。
 */
function runNav(plugin: FeishuLitePlugin, view: EditorView, dir: 1 | -1 | 0): boolean {
	if (view.composing) return false; // 双拼/拼音组合提交时绝不拦截
	if (!active(plugin)) return false;
	const t = getTableAround(view);
	if (!t) return false;
	// 补全弹窗（[[ 链接、斜杠菜单等）打开时，Enter/Tab 归补全窗处理
	if (document.querySelector(".suggestion-container")) return false;

	const state = view.state;
	const head = state.selection.main.head;
	const cur = state.doc.lineAt(head);
	const row = cur.number - t.startLine;
	const cells = t.rows[row];
	const col = cellIndexAt(cells, head - cur.from);

	let targetRow = row;
	let targetCol = col;
	if (dir === 1) {
		targetCol = col + 1;
		if (targetCol >= cells.length) {
			targetRow = row + 1;
			targetCol = 0;
		}
	} else if (dir === -1) {
		targetCol = col - 1;
		if (targetCol < 0) {
			if (row === 0) return false; // 首行首格：放行默认行为
			targetRow = row - 1;
			targetCol = Math.max(0, t.rows[row - 1].length - 1);
		}
	} else {
		targetRow = row + 1; // Enter：下一行同列
	}

	// 越过末行 → 追加新行
	let extraRow: string | null = null;
	if (targetRow >= t.rows.length) {
		const headerCols = t.rows[0].length;
		extraRow = "| " + new Array(headerCols).fill("").join(" | ") + " |";
		targetRow = t.rows.length;
		targetCol = Math.min(targetCol, headerCols - 1);
	}

	const rawLines = extraRow ? [...t.lines, extraRow] : t.lines;
	const formatted = formatTableLines(rawLines);
	if (!formatted) return false;

	const fCells = parseRow(formatted[targetRow]);
	const safeCol = Math.min(targetCol, (fCells?.length ?? 1) - 1);
	const cell = fCells?.[safeCol];
	const ch = cell ? cell.to : (formatted[targetRow]?.length ?? 0);

	// 目标位置：区域起点 + 目标行之前的行长度 + 行内 ch
	const from = state.doc.line(t.startLine).from;
	const to = state.doc.line(t.endLine).to;
	let rel = 0;
	for (let i = 0; i < targetRow; i++) rel += (formatted[i]?.length ?? 0) + 1;

	view.dispatch({
		changes: { from, to, insert: formatted.join("\n") },
		selection: { anchor: from + rel + ch },
	});
	return true;
}

/** 命令版：切换光标所在列的列对齐（默认 → 居中 → 右对齐 → 默认），顺带整表格式化 */
export function cycleColumnAlign(editor: Editor): void {
	const cur = editor.getCursor();
	const cells = parseRow(editor.getLine(cur.line));
	if (!cells) {
		new Notice("Feishu Lite：光标不在表格里");
		return;
	}
	let start = cur.line;
	let end = cur.line;
	while (start > 0 && parseRow(editor.getLine(start - 1))) start--;
	while (end < editor.lastLine() && parseRow(editor.getLine(end + 1))) end++;
	const lines: string[] = [];
	for (let l = start; l <= end; l++) lines.push(editor.getLine(l));

	// 找分隔行（对齐语法写在分隔行里）
	let sepIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const rowCells = parseRow(lines[i] ?? "");
		if (rowCells && isSeparatorRow(rowCells)) {
			sepIdx = i;
			break;
		}
	}
	if (sepIdx < 0) {
		new Notice("Feishu Lite：表格缺少分隔行（| --- |）");
		return;
	}

	const sepCells = parseRow(lines[sepIdx] ?? "");
	if (!sepCells) return;
	const col = Math.min(cellIndexAt(cells, cur.ch), sepCells.length - 1);
	const cell = sepCells[col];
	if (!cell) return;
	const current = cell.text.trim();
	let next: string;
	let label: string;
	if (current.startsWith(":") && current.endsWith(":")) {
		next = "---:"; // 居中 → 右对齐
		label = "右对齐";
	} else if (current.endsWith(":")) {
		next = "---"; // 右对齐 → 默认
		label = "默认（左对齐）";
	} else {
		next = ":---:"; // 默认 → 居中
		label = "居中";
	}

	const sepLine = lines[sepIdx] ?? "";
	lines[sepIdx] = sepLine.slice(0, cell.from) + next + sepLine.slice(cell.to);
	const formatted = formatTableLines(lines) ?? lines;
	editor.replaceRange(
		formatted.join("\n"),
		{ line: start, ch: 0 },
		{ line: end, ch: editor.getLine(end).length }
	);
	new Notice(`Feishu Lite：第 ${col + 1} 列 → ${label}`);
}

/** 命令版：格式化光标所在表格（用于修复外部粘进来的乱表） */
export function formatTableAtCursor(editor: Editor): void {
	const cur = editor.getCursor();
	if (!parseRow(editor.getLine(cur.line))) {
		new Notice("Feishu Lite：光标不在表格里");
		return;
	}
	let start = cur.line;
	let end = cur.line;
	while (start > 0 && parseRow(editor.getLine(start - 1))) start--;
	while (end < editor.lastLine() && parseRow(editor.getLine(end + 1))) end++;
	const lines: string[] = [];
	for (let l = start; l <= end; l++) lines.push(editor.getLine(l));
	const formatted = formatTableLines(lines);
	if (!formatted) return;
	editor.replaceRange(
		formatted.join("\n"),
		{ line: start, ch: 0 },
		{ line: end, ch: editor.getLine(end).length }
	);
}

// ---------------- 行列增删（命令版） ----------------

export type TableOp = "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "rowDelete" | "colDelete";

/** 命令版：表格行列增删（作用于光标所在表格；表头行 / 分隔行有保护） */
export function editTableAtCursor(editor: Editor, op: TableOp): void {
	const cur = editor.getCursor();
	const cursorCells = parseRow(editor.getLine(cur.line));
	if (!cursorCells) {
		new Notice("Feishu Lite：光标不在表格里");
		return;
	}
	let start = cur.line;
	let end = cur.line;
	while (start > 0 && parseRow(editor.getLine(start - 1))) start--;
	while (end < editor.lastLine() && parseRow(editor.getLine(end + 1))) end++;
	const lines: string[] = [];
	for (let l = start; l <= end; l++) lines.push(editor.getLine(l));
	const rows = lines.map((l) => parseRow(l) ?? []);
	const rowIdx = cur.line - start;
	const sepIdx = rows.findIndex((r) => isSeparatorRow(r));
	const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const col = Math.min(cellIndexAt(cursorCells, cur.ch), Math.max(0, maxCols - 1));

	let out: string[] | null = null;
	let focusIdx = rowIdx;

	if (op === "rowDelete") {
		if (rowIdx === 0) {
			new Notice("Feishu Lite：表头行不可删除");
			return;
		}
		if (rowIdx === sepIdx) {
			new Notice("Feishu Lite：分隔行不可删除");
			return;
		}
		out = deleteRow(lines, rowIdx);
		focusIdx = Math.min(rowIdx, (out?.length ?? lines.length) - 1);
	} else if (op === "colDelete") {
		out = deleteCol(lines, col);
		if (!out) {
			new Notice("Feishu Lite：删不了——表格至少要保留一列");
			return;
		}
	} else if (op === "rowAbove" || op === "rowBelow") {
		if (rowIdx === sepIdx) {
			new Notice("Feishu Lite：光标在分隔行上，请移到数据行");
			return;
		}
		if (op === "rowAbove" && rowIdx === 0) {
			new Notice("Feishu Lite：表头行上方无法插入");
			return;
		}
		let at = op === "rowAbove" ? rowIdx : rowIdx + 1;
		if (op === "rowBelow" && rowIdx === 0 && sepIdx >= 0) at = sepIdx + 1; // 表头下插 = 首条数据行
		out = insertRow(lines, at);
		focusIdx = at;
	} else {
		out = insertCol(lines, op === "colLeft" ? col : col + 1);
	}
	if (!out) return;

	editor.replaceRange(out.join("\n"), { line: start, ch: 0 }, { line: end, ch: editor.getLine(end).length });
	const target = Math.min(start + focusIdx, start + out.length - 1);
	editor.setCursor({ line: target, ch: 2 });
}
