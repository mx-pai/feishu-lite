import { EditorSelection } from "@codemirror/state";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/**
 * 划词包裹的纯计算核心（无 DOM / 无视图依赖，可直接单测；由划词工具条消费）：
 * 给一段选区套上 open/close 标记，并处理「选区已在标记内 / 覆盖标记」的情况：
 * - 标记紧贴选区外侧 → 只替换两侧标记（连续换色、高亮 ↔ 行内代码 ↔ 删除线互转都不叠加）
 * - 选区覆盖整个标记 → 剥壳后整体重包
 * - open/close 传空串 → 输出「剥壳」事务（工具条再次点击已生效样式 = 取消）
 */

/** 支持的标记族：彩色高亮 =={red} / 默认高亮 == / 行内代码 ` / 删除线 ~~ */
const MARK_SRC = "(?:==\\{[a-z]+\\}|==|`|~~)";
const RE_BEFORE = new RegExp(MARK_SRC + "$");
const RE_INNER = new RegExp("^" + MARK_SRC);

/** 开标记对应的闭标记 */
function closerOf(open: string): string {
	if (open === "`") return "`";
	if (open === "~~") return "~~";
	return "==";
}

export function buildWrapSpec(st: EditorState, open: string, close: string): TransactionSpec | null {
	const sel = st.selection.main;
	if (sel.empty) return null;
	const from = sel.from;
	const to = sel.to;
	let inner = st.sliceDoc(from, to);

	// 1) 标记紧贴选区外侧 → 只替换两侧标记
	const before = st.sliceDoc(Math.max(0, from - 12), from);
	const after = st.sliceDoc(to, Math.min(st.doc.length, to + 12));
	const outer = RE_BEFORE.exec(before);
	if (outer) {
		const o = outer[0];
		const closer = closerOf(o);
		if (after.startsWith(closer)) {
			return {
				changes: [
					{ from: from - o.length, to: from, insert: open },
					{ from: to, to: to + closer.length, insert: close },
				],
				selection: EditorSelection.range(
					from - o.length + open.length,
					from - o.length + open.length + inner.length
				),
			};
		}
	}

	// 2) 选区覆盖整个标记 → 剥壳后整体重包
	const self = RE_INNER.exec(inner);
	if (self) {
		const o = self[0];
		const closer = closerOf(o);
		if (inner.endsWith(closer) && inner.length >= o.length + closer.length + 1) {
			inner = inner.slice(o.length, inner.length - closer.length);
		}
	}

	return {
		changes: { from, to, insert: open + inner + close },
		selection: EditorSelection.range(from + open.length, from + open.length + inner.length),
	};
}

/** 当前恰好包裹选区的开标记（"==" / "=={red}" / "`" / "~~"），没有则 null。工具条用它判断「再次点击 = 取消」 */
export function currentWrapOpen(st: EditorState): string | null {
	const sel = st.selection.main;
	if (sel.empty) return null;
	const from = sel.from;
	const to = sel.to;

	// 与 buildWrapSpec 同一套判定：先看紧贴选区外侧的标记，再看选区整体覆盖的标记
	const before = st.sliceDoc(Math.max(0, from - 12), from);
	const after = st.sliceDoc(to, Math.min(st.doc.length, to + 12));
	const outer = RE_BEFORE.exec(before);
	if (outer && after.startsWith(closerOf(outer[0]))) return outer[0];

	const inner = st.sliceDoc(from, to);
	const self = RE_INNER.exec(inner);
	if (self) {
		const closer = closerOf(self[0]);
		if (inner.endsWith(closer) && inner.length >= self[0].length + closer.length + 1) return self[0];
	}
	return null;
}

/** 第 lineNo 行（1 起）是否处于 ``` / ~~~ 围栏内（代码块里不弹工具条） */
export function lineInFence(state: EditorState, lineNo: number): boolean {
	let inFence = false;
	let fenceChar = "";
	for (let i = 1; i < lineNo; i++) {
		const m = /^\s*(```+|~~~+)/.exec(state.doc.line(i).text);
		if (!m) continue;
		const ch = m[1]?.charAt(0) ?? "";
		if (!inFence) {
			inFence = true;
			fenceChar = ch;
		} else if (ch === fenceChar) {
			inFence = false;
		}
	}
	return inFence;
}
