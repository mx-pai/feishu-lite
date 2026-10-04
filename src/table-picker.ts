import type { Editor } from "obsidian";
import { anchorRect } from "./cascade";
import { formatTableRows } from "./table-core";
import type { Cell } from "./table-core";

/**
 * 表格选择器（飞书式悬停网格）：
 * - 斜杠 /bg 或命令「插入：表格」唤起；悬停 / 方向键选「列 × 行」，点击 / Enter 插入
 * - rows 含表头行（第一行为 列1…列n）；网格上限 8×8，默认 3×3 起步
 */

const MAX_COLS = 8;
const MAX_ROWS = 8;

/** 插入指定「行列」的表格（第一行为表头）；光标落在表头第一格 */
export function insertTableSized(editor: Editor, rows: number, cols: number): void {
	const grid: Cell[][] = [];
	grid.push(Array.from({ length: cols }, (_, i) => ({ text: `列${i + 1}`, from: 0, to: 0 })));
	grid.push(Array.from({ length: cols }, () => ({ text: "---", from: 0, to: 0 })));
	for (let r = 1; r < rows; r++) {
		grid.push(Array.from({ length: cols }, () => ({ text: "", from: 0, to: 0 })));
	}
	const lines = formatTableRows(grid);
	const start = editor.getCursor();
	editor.replaceSelection(lines.join("\n"));
	editor.setCursor({ line: start.line, ch: 2 });
}

let closePicker: (() => void) | null = null;

/** 停用 / 卸载插件时收起选择器（由 main.ts 注册；未打开时无操作） */
export function closeTablePicker(): void {
	closePicker?.();
}

export function openTablePicker(editor: Editor, onPick?: (rows: number, cols: number) => void): void {
	closePicker?.();
	const onPicked = onPick ?? ((rows: number, cols: number) => insertTableSized(editor, rows, cols));
	const openedAt = Date.now();

	const root = document.body.createDiv({ cls: "fl-cascade" });
	const panel = root.createDiv({ cls: "fl-cascade-panel fl-table-picker" });
	const title = panel.createDiv({ cls: "fl-cascade-title" });
	const grid = panel.createDiv({ cls: "fl-table-picker-grid" });
	panel.createDiv({ cls: "fl-cascade-foot", text: "悬停或方向键选择 · 点击 / Enter 插入 · Esc 取消" });

	let cur = { r: 3, c: 3 };
	let closed = false;
	const cells: HTMLElement[] = [];

	const isOn = (i: number): boolean => Math.floor(i / MAX_COLS) < cur.r && i % MAX_COLS < cur.c;

	function refresh(): void {
		cells.forEach((el, i) => el.toggleClass("is-on", isOn(i)));
		title.setText(`${cur.c} 列 × ${cur.r} 行`);
	}

	function close(): void {
		if (closed) return;
		closed = true;
		if (closePicker === close) closePicker = null;
		document.removeEventListener("keydown", onKey, true);
		document.removeEventListener("mousedown", onMouseDown, true);
		window.removeEventListener("scroll", onScroll, true);
		root.remove();
	}

	function apply(): void {
		if (closed) return;
		const { r, c } = cur;
		close();
		try {
			onPicked(r, c);
		} catch (err) {
			console.error("[feishu-lite] 插入表格失败", err);
		}
	}

	function onKey(e: KeyboardEvent): void {
		if (e.isComposing || e.key === "Process") return;
		if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			cur = { r: Math.min(MAX_ROWS, cur.r + 1), c: cur.c };
			refresh();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			cur = { r: Math.max(1, cur.r - 1), c: cur.c };
			refresh();
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			e.stopPropagation();
			cur = { r: cur.r, c: Math.min(MAX_COLS, cur.c + 1) };
			refresh();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			e.stopPropagation();
			cur = { r: cur.r, c: Math.max(1, cur.c - 1) };
			refresh();
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			apply();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else {
			close(); // 其它按键：关闭并放行
		}
	}

	function onMouseDown(e: MouseEvent): void {
		if (e.target instanceof Node && root.contains(e.target)) {
			// 点在格子上：阻止默认聚焦，保持编辑器焦点不丢
			if (e.target.instanceOf(HTMLElement) && e.target.closest(".fl-table-picker-cell")) e.preventDefault();
			return;
		}
		close();
	}

	function onScroll(e: Event): void {
		if (e.target instanceof Node && root.contains(e.target)) return;
		close();
	}

	for (let i = 0; i < MAX_ROWS * MAX_COLS; i++) {
		const r = Math.floor(i / MAX_COLS);
		const c = i % MAX_COLS;
		const el = grid.createDiv({ cls: "fl-table-picker-cell" });
		el.onmouseenter = () => {
			cur = { r: r + 1, c: c + 1 };
			refresh();
		};
		el.onclick = () => {
			if (Date.now() - openedAt < 150) return; // 吸收唤起那一次点击的尾巴
			cur = { r: r + 1, c: c + 1 };
			apply();
		};
		cells.push(el);
	}
	refresh();

	// 定位：光标下方；越出视口则收回到边缘内
	const rect = anchorRect(editor);
	let left = rect ? rect.left : Math.round(window.innerWidth / 2 - 90);
	const top = rect ? rect.bottom + 4 : Math.round(window.innerHeight / 3);
	root.style.left = `${left}px`;
	root.style.top = `${top}px`;
	const w = root.offsetWidth;
	const h = root.offsetHeight;
	if (left + w > window.innerWidth - 8) {
		left = Math.max(8, window.innerWidth - w - 8);
		root.style.left = `${left}px`;
	}
	if (top + h > window.innerHeight - 8) {
		root.style.top = `${Math.max(8, window.innerHeight - h - 8)}px`;
	}

	document.addEventListener("keydown", onKey, true);
	document.addEventListener("mousedown", onMouseDown, true);
	window.addEventListener("scroll", onScroll, true);
	closePicker = close;
}
