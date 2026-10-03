import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type FeishuLitePlugin from "./main";
import { isPluginEnabled } from "./util";
import { itemRootAt, moveListItem } from "./list-core";

/**
 * 列表增强（炼化 Outliner 的招牌键位）：Cmd+Shift+↑/↓ 整棵子树与相邻同级项换位。
 * - Tab/Shift+Tab/Enter 的基础列表行为由 Obsidian 原生覆盖，不重复造
 * - 「Outliner」插件启用时自动让位；非列表行放行默认行为
 */
const OUTLINER_ID = "obsidian-outliner";

export function listEnhanceExtension(plugin: FeishuLitePlugin) {
	return Prec.highest(
		keymap.of([
			{ key: "Mod-Shift-ArrowUp", run: (view) => runMove(plugin, view, -1) },
			{ key: "Mod-Shift-ArrowDown", run: (view) => runMove(plugin, view, 1) },
		])
	);
}

function runMove(plugin: FeishuLitePlugin, view: EditorView, dir: 1 | -1): boolean {
	try {
		if (view.composing) return false; // IME 组合期间不拦截
		if (!plugin.settings.listAssist) return false;
		if (isPluginEnabled(plugin.app, OUTLINER_ID)) return false;

		const state = view.state;
		if (state.selection.ranges.length !== 1) return false;
		const head = state.selection.main.head;
		const cur = state.doc.lineAt(head);

		// 纯逻辑输入：全文行数组（普通笔记规模足够快）
		const lines: string[] = [];
		for (let n = 1; n <= state.doc.lines; n++) lines.push(state.doc.line(n).text);

		const root = itemRootAt(lines, cur.number - 1);
		if (root === null) return false;
		const res = moveListItem(lines, root, dir);
		if (!res) return false;

		const fromPos = state.doc.line(res.fromLine + 1).from;
		const toPos = state.doc.line(res.toLine + 1).to;
		const insert = res.replacement.join("\n");

		// 光标：整棵子树文本原样搬家，用「相对根行起点的字符偏移」映射即可
		const oldRootStart = state.doc.line(root + 1).from;
		const delta = head - oldRootStart;
		let rel = 0;
		const offset = res.cursorLine - res.fromLine;
		for (let i = 0; i < offset; i++) rel += (res.replacement[i]?.length ?? 0) + 1;

		view.dispatch({
			changes: { from: fromPos, to: toPos, insert },
			selection: { anchor: fromPos + rel + delta },
		});
		return true;
	} catch (err) {
		console.error("[feishu-lite] 列表子树移动失败", err);
		return false;
	}
}
