import { Notice } from "obsidian";
import type { Editor } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 中英混排美化（盘古之白）：中文与半角英文/数字之间补一个空格。
 * - 命令：有选区只处理选区，否则整篇（只替换变化的片段，光标/滚动位置不受影响）
 * - 可选：粘贴时自动（设置项，默认关）；光标在代码块里时不处理
 * - 保护：代码块围栏 / 行内代码 / [[双链]] / [文本](链接) / 裸链 / $公式$ / =={color} / HTML 标签
 */

/** 中文范围：U+3040-30FF 假名 · U+3400-4DBF 扩展A · U+4E00-9FFF 基本区 · U+F900-FAFF 兼容区 */
const CJK_ASCII = /([぀-ヿ㐀-䶿一-鿿豈-﫿])([A-Za-z0-9])/g;
const ASCII_CJK = /([A-Za-z0-9])([぀-ヿ㐀-䶿一-鿿豈-﫿])/g;

/** 受保护片段：不参与补空格（split 的奇数下标 = 命中的整段） */
const PROTECT_RE =
	/(`[^`\n]*`|\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+|\$\$?[^$\n]+\$\$?|==\{[a-z]+\}|<[^>\n]+>)/g;

/** 单段文本：中文 ↔ 英文/数字间补空格（已隔空则不重复补） */
function spaceSegment(seg: string): string {
	return seg.replace(CJK_ASCII, "$1 $2").replace(ASCII_CJK, "$1 $2");
}

/** 一行文本：按保护片段切分，只处理普通段落 */
function spaceLine(line: string): string {
	return line
		.split(PROTECT_RE)
		.map((seg, i) => (i % 2 === 1 ? seg : spaceSegment(seg)))
		.join("");
}

/** 文档级美化：跳过 frontmatter、``` / ~~~ 围栏、4 空格或 Tab 缩进的代码行、引用式链接定义 */
export function beautifyMixedText(text: string): string {
	const lines = text.split("\n");
	let inFence = false;
	let fenceChar = "";
	// frontmatter 区段：首行 --- 且后方确有闭合行时才认（避免把正文开头的分隔线当成属性区）
	const frontEnd = /^(?:\uFEFF)?---\s*$/.test(lines[0] ?? "")
		? lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
		: -1;
	let inFront = frontEnd > 0;
	const out = lines.map((line, index) => {
		if (inFront) {
			if (index >= frontEnd) inFront = false;
			return line;
		}
		const m = /^\s*(```+|~~~+)/.exec(line);
		if (m) {
			const ch = m[1]?.charAt(0) ?? "";
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
			}
			return line;
		}
		if (inFence) return line;
		if (/^(?: {4}|\t)/.test(line)) return line; // 缩进代码块
		if (/^\s*\[[^\]]+\]:/.test(line)) return line; // 引用式链接定义，形如 [label]: url
		return spaceLine(line);
	});
	return out.join("\n");
}

/** 命令：美化当前选区或整篇（每次修复只插入一个空格，增量 = 修复处数） */
export function formatCjkSpacing(editor: Editor): void {
	const sel = editor.getSelection();
	if (sel) {
		const fixed = beautifyMixedText(sel);
		if (fixed === sel) {
			new Notice("中英混排已经很整齐，无需调整");
			return;
		}
		editor.replaceSelection(fixed);
		new Notice(`已在 ${fixed.length - sel.length} 处补空格`);
		return;
	}

	const oldText = editor.getValue();
	const newText = beautifyMixedText(oldText);
	if (newText === oldText) {
		new Notice("中英混排已经很整齐，无需调整");
		return;
	}
	// 只替换「变化的中段」：前后缀保持原样，光标与滚动位置不受影响
	const minLen = Math.min(oldText.length, newText.length);
	let prefix = 0;
	while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;
	let suffix = 0;
	while (suffix < minLen - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
	editor.replaceRange(
		newText.slice(prefix, newText.length - suffix),
		editor.offsetToPos(prefix),
		editor.offsetToPos(oldText.length - suffix)
	);
	new Notice(`已在 ${newText.length - oldText.length} 处补空格`);
}

// ---------------- 粘贴时自动美化（可开关） ----------------

/** 光标是否处于 ``` / ~~~ 代码块内（粘贴进代码块时不处理） */
function cursorInFence(editor: Editor): boolean {
	const cursorLine = editor.getCursor().line;
	let inFence = false;
	let fenceChar = "";
	for (let i = 0; i < cursorLine; i++) {
		const m = /^\s*(```+|~~~+)/.exec(editor.getLine(i));
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

export function registerCjkPaste(plugin: FeishuLitePlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on("editor-paste", (evt, editor) => {
			if (evt.defaultPrevented) return; // 已被（本插件 CM6 通道或其它插件）处理，不抢
			if (!plugin.settings.cjkPaste) return;
			const cd = evt.clipboardData;
			if (!cd || (cd.files && cd.files.length > 0)) return; // 图片/文件粘贴交给图片模块
			if (Array.from(cd.types ?? []).includes("text/html")) return; // 富文本粘贴让位给 Obsidian 原生处理，避免被降级为纯文本
			const text = cd.getData("text/plain");
			if (!text) return;
			if (cursorInFence(editor)) return;
			const fixed = beautifyMixedText(text);
			if (fixed === text) return;
			evt.preventDefault();
			editor.replaceSelection(fixed);
		})
	);
}
