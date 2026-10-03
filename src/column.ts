import { Editor, MarkdownPostProcessorContext } from "obsidian";
import type { ListOption } from "./util";

/**
 * 文字分栏（> [!col-2] / [!col-3] / [!col-4]）
 * - 阅读视图：把 callout 内容按「单独一行的 ---」切成 N 栏，并排渲染（段落 / 列表 / 引用都行）
 * - 编辑视图：保持普通引用块外观（栏间 --- 显示为虚线分隔），不做真分栏
 * - 超出栏数的内容自动并入最后一栏，绝不丢内容；空栏显示虚线占位
 */

export const TEXT_COL_OPTIONS: ListOption<unknown>[] = [
	{ label: "2 栏", value: 2, hint: "两栏并排（常用）" },
	{ label: "3 栏", value: 3, hint: "三栏并排" },
	{ label: "4 栏", value: 4, hint: "四栏并排" },
];

/** 插入文字分栏骨架（光标停在第一栏，直接开写） */
export function insertTextColumns(editor: Editor, cols: number): void {
	const n = Math.min(4, Math.max(2, Math.round(cols) || 2));
	const lines: string[] = [`> [!col-${n}]`];
	for (let i = 1; i <= n; i++) {
		lines.push(`> 第 ${i} 栏`);
		if (i < n) lines.push("> ", "> ---", "> ");
	}
	const start = editor.getCursor();
	editor.replaceSelection("\n" + lines.join("\n") + "\n");
	editor.setCursor({ line: start.line + 1, ch: "> 第 1 栏".length });
}

/** 阅读视图渲染：把 col-N callout 的内容按 hr 拆成并排的栏 */
export function colPostProcessor(el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
	el.querySelectorAll<HTMLElement>('.callout[data-callout^="col-"]').forEach((callout) => {
		const m = /^col-(\d+)$/.exec(callout.getAttribute("data-callout") ?? "");
		if (!m) return;
		const cols = Math.min(4, Math.max(2, parseInt(m[1], 10) || 2));
		const content = callout.querySelector<HTMLElement>(".callout-content");
		if (!content || content.querySelector(":scope > .fl-col")) return; // 幂等保护

		const children = Array.from(content.children) as HTMLElement[];
		const groups: HTMLElement[][] = [[]];
		for (const child of children) {
			if (child.tagName === "HR") groups.push([]);
			else groups[groups.length - 1]?.push(child);
		}
		// 超出栏数的内容并入最后一栏（不丢内容）
		if (groups.length > cols) {
			const last = groups[cols - 1];
			if (last) {
				for (let i = cols; i < groups.length; i++) last.push(...(groups[i] ?? []));
			}
			groups.length = cols;
		}

		const grid = createDiv({ cls: "fl-col" });
		grid.style.setProperty("--fl-cols", String(cols));
		for (let i = 0; i < cols; i++) {
			const colEl = grid.createDiv({ cls: "fl-col-item" });
			const group = groups[i] ?? [];
			if (!group.length) {
				colEl.createDiv({ cls: "fl-col-empty", text: "空栏 · 在源码里补内容" });
			} else {
				for (const node of group) colEl.appendChild(node);
			}
		}
		// 此时内容节点都已移入 grid；清掉遗留的分隔 hr 再挂载（grid 尚游离，不受 empty 影响）
		content.empty();
		content.appendChild(grid);
	});
}
