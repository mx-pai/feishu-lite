/**
 * 表格增强的纯逻辑（不依赖 Obsidian / CodeMirror，便于单测）：
 * - 单元格切分（支持转义 \| 与不规范空格）
 * - 显示宽度（CJK 记 2 宽，用于对齐）
 * - 整表格式化（列宽归一 + 补齐空格，分隔行用横线填满）
 */

export interface Cell {
	/** 去除两端空白后的内容 */
	text: string;
	/** 内容在行内的起始 ch（已跳过前导空白） */
	from: number;
	/** 内容在行内的结束 ch（尾随空白之前） */
	to: number;
}

/** 判断是否宽字符（CJK / 全角 / emoji 大致记 2 宽） */
export function isWideChar(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0xa000 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	);
}

/** 字符串显示宽度（等宽环境下用于表格对齐） */
export function dispWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
	return w;
}

/** 单元格是否为分隔行语法（--- / :--- / ---: / :---:） */
export function isSeparatorCell(text: string): boolean {
	return /^:?-+:?$/.test(text);
}

/**
 * 解析一行标准表格行（| a | b |）。无法解析返回 null。
 * 位置 from/to 是相对整行的 ch 值。
 */
export function parseRow(line: string): Cell[] | null {
	const first = line.indexOf("|");
	const last = line.lastIndexOf("|");
	if (first < 0 || last <= first) return null;
	const cells: Cell[] = [];
	let segStart = first + 1;
	for (let i = first + 1; i < last; i++) {
		const ch = line[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "|") {
			pushCell(cells, line, segStart, i);
			segStart = i + 1;
		}
	}
	pushCell(cells, line, segStart, last);
	return cells.length ? cells : null;
}

function pushCell(cells: Cell[], line: string, segStart: number, segEnd: number): void {
	let a = segStart;
	let b = segEnd;
	while (a < b && (line[a] === " " || line[a] === "\t")) a++;
	while (b > a && (line[b - 1] === " " || line[b - 1] === "\t")) b--;
	if (a === b) {
		// 空单元格：from/to 指向内容区起点（紧跟 "|" 之后），光标落上即可直接输入
		cells.push({ text: "", from: segStart, to: segStart });
		return;
	}
	cells.push({ text: line.slice(a, b), from: a, to: b });
}

export function isSeparatorRow(cells: Cell[]): boolean {
	return cells.length > 0 && cells.every((c) => isSeparatorCell(c.text));
}

/** 光标（行内 ch）落在哪个单元格：返回最后一个 from <= ch 的下标 */
export function cellIndexAt(cells: Cell[], ch: number): number {
	for (let j = cells.length - 1; j >= 0; j--) {
		if (ch >= cells[j].from) return j;
	}
	return 0;
}

/** 把若干行（各已解析出单元格）格式化为对齐的 markdown 表格 */
export function formatTableRows(rows: Cell[][]): string[] {
	const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const width: number[] = [];
	for (let j = 0; j < cols; j++) {
		let w = 3;
		for (const r of rows) {
			const c = r[j];
			if (c && !isSeparatorCell(c.text)) w = Math.max(w, dispWidth(c.text));
		}
		width[j] = w;
	}
	return rows.map((r) => {
		const parts: string[] = [];
		for (let j = 0; j < cols; j++) {
			const t = r[j]?.text ?? "";
			if (isSeparatorCell(t)) {
				const left = t.startsWith(":");
				const right = t.endsWith(":");
				const n = Math.max(1, width[j] - (left ? 1 : 0) - (right ? 1 : 0));
				parts.push(`${left ? ":" : ""}${"-".repeat(n)}${right ? ":" : ""}`);
			} else {
				const pad = Math.max(0, width[j] - dispWidth(t));
				parts.push(t + " ".repeat(pad));
			}
		}
		return "| " + parts.join(" | ") + " |";
	});
}

/** 表格多行（原始文本）→ 格式化后的行；任一行无法解析则返回 null */
export function formatTableLines(lines: string[]): string[] | null {
	const rows: Cell[][] = [];
	for (const line of lines) {
		const cells = parseRow(line);
		if (!cells) return null;
		rows.push(cells);
	}
	return formatTableRows(rows);
}

// ---------------- 行 / 列增删（表格选择器与行列命令用，纯逻辑可单测） ----------------

function parseRows(lines: string[]): Cell[][] | null {
	const rows: Cell[][] = [];
	for (const line of lines) {
		const cells = parseRow(line);
		if (!cells) return null;
		rows.push(cells);
	}
	return rows;
}

function blankCell(): Cell {
	return { text: "", from: 0, to: 0 };
}

/** 在下标 at 处插入一个空行（列数对齐当前最大列数）；at 越界则追加到末尾 */
export function insertRow(lines: string[], at: number): string[] | null {
	const rows = parseRows(lines);
	if (!rows) return null;
	const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
	rows.splice(Math.max(0, Math.min(at, rows.length)), 0, Array.from({ length: cols }, () => blankCell()));
	return formatTableRows(rows);
}

/** 删除下标 at 行 */
export function deleteRow(lines: string[], at: number): string[] | null {
	const rows = parseRows(lines);
	if (!rows || at < 0 || at >= rows.length) return null;
	rows.splice(at, 1);
	return formatTableRows(rows);
}

/** 在下标 at 列前插入一列（分隔行的新单元格用 ---，保持分隔语义） */
export function insertCol(lines: string[], at: number): string[] | null {
	const rows = parseRows(lines);
	if (!rows) return null;
	for (const r of rows) {
		const idx = Math.max(0, Math.min(at, r.length));
		r.splice(idx, 0, isSeparatorRow(r) ? { text: "---", from: 0, to: 0 } : blankCell());
	}
	return formatTableRows(rows);
}

/** 删除下标 at 列（至少保留一列，否则返回 null） */
export function deleteCol(lines: string[], at: number): string[] | null {
	const rows = parseRows(lines);
	if (!rows) return null;
	const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
	if (cols <= 1 || at < 0 || at >= cols) return null;
	for (const r of rows) {
		if (at < r.length) r.splice(at, 1);
	}
	return formatTableRows(rows);
}
