/**
 * 列表增强的纯逻辑（不依赖 Obsidian / CodeMirror，便于单测）：
 * 计算「整棵子树上下移动」的替换区间。
 */

export interface MoveResult {
	/** 替换区间：fromLine..toLine（含两端，0-based 行号） */
	fromLine: number;
	toLine: number;
	replacement: string[];
	/** 移动后光标应处的行（0-based，绝对行号） */
	cursorLine: number;
}

const ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;

export function isListItem(line: string): boolean {
	return ITEM_RE.test(line);
}

/** 行首缩进宽度（tab 记 4） */
export function indentWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (ch === " ") w += 1;
		else if (ch === "\t") w += 4;
		else break;
	}
	return w;
}

/**
 * 光标行所属的列表项根行：光标在项行 → 它自己；在续行（非空非项）→ 向上最近的项；
 * 遇到空行则视为不在列表里（返回 null）。
 */
export function itemRootAt(lines: string[], lineIdx: number): number | null {
	let i = lineIdx;
	while (i >= 0) {
		if (isListItem(lines[i])) return i;
		if (lines[i].trim() === "") return null;
		i--;
	}
	return null;
}

/** 列表项整棵子树的区间 [start, end)（end 不含） */
export function itemBlock(lines: string[], root: number): { start: number; end: number; indent: number } | null {
	if (!isListItem(lines[root])) return null;
	const indent = indentWidth(lines[root]);
	let end = root + 1;
	while (end < lines.length) {
		const t = lines[end];
		if (t.trim() === "") {
			// 空行：若其后还有更深缩进的内容，则空行与内容都算块内
			let k = end + 1;
			while (k < lines.length && lines[k].trim() === "") k++;
			if (k < lines.length && indentWidth(lines[k]) > indent) {
				end = k;
				continue;
			}
			break;
		}
		if (indentWidth(t) > indent) {
			end++;
			continue;
		}
		break;
	}
	return { start: root, end, indent };
}

/**
 * 整棵子树与相邻同级项交换。dir = -1 上移，+1 下移。
 * 找不到同级兄弟（如首个子项）时返回 null（v1 不做跨层级移动）。
 */
export function moveListItem(lines: string[], root: number, dir: 1 | -1): MoveResult | null {
	const block = itemBlock(lines, root);
	if (!block) return null;
	const raw = lines.slice(block.start, block.end);

	if (dir === -1) {
		// 找前一个同级兄弟：先跳过更深缩进的行（属于前一项的子树），再跳过空行
		let p = block.start - 1;
		while (p >= 0 && lines[p].trim() !== "" && indentWidth(lines[p]) > block.indent) p--;
		while (p >= 0 && lines[p].trim() === "") p--;
		if (p < 0) return null;
		if (!isListItem(lines[p]) || indentWidth(lines[p]) !== block.indent) return null;
		const pBlock = itemBlock(lines, p);
		if (!pBlock) return null;
		const gap = lines.slice(pBlock.end, block.start);
		if (gap.some((l) => l.trim() !== "")) return null;
		return {
			fromLine: pBlock.start,
			toLine: block.end - 1,
			replacement: [...raw, ...gap, ...lines.slice(pBlock.start, pBlock.end)],
			cursorLine: pBlock.start,
		};
	}

	// 下移：找后一个同级兄弟
	let q = block.end;
	while (q < lines.length && lines[q].trim() === "") q++;
	if (q >= lines.length) return null;
	if (!isListItem(lines[q]) || indentWidth(lines[q]) !== block.indent) return null;
	const qBlock = itemBlock(lines, q);
	if (!qBlock) return null;
	const gap = lines.slice(block.end, q);
	if (gap.some((l) => l.trim() !== "")) return null;
	const qLines = lines.slice(qBlock.start, qBlock.end);
	return {
		fromLine: block.start,
		toLine: qBlock.end - 1,
		replacement: [...qLines, ...gap, ...raw],
		cursorLine: block.start + qLines.length + gap.length,
	};
}
