import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, TFile } from "obsidian";
import type FeishuLitePlugin from "./main";
import { SLASH_ITEMS, SlashItem } from "./slash-items";
import { openSlashCascade } from "./cascade";

/**
 * 斜杠菜单是否处于「代码 / 元数据」上下文（处于其中则不该触发）：
 * - 围栏代码块：向上数未闭合的 ``` / ~~~（与 cjk-space / wrap-core 同一套判定）
 * - 行内代码：斜杠之前有奇数个反引号
 * - YAML 前置元数据：首行 --- 起、且存在闭合 --- / ... 行，斜杠在两者之间
 */
function inCodeContext(editor: Editor, line: number, ch: number): boolean {
	if ((editor.getLine(line).slice(0, ch).match(/`/g) ?? []).length % 2 === 1) return true;
	let inFence = false;
	let fenceChar = "";
	for (let i = 0; i < line; i++) {
		const fm = /^\s*(```+|~~~+)/.exec(editor.getLine(i));
		if (!fm) continue;
		const c = fm[1]?.charAt(0) ?? "";
		if (!inFence) {
			inFence = true;
			fenceChar = c;
		} else if (c === fenceChar) {
			inFence = false;
		}
	}
	if (inFence) return true;
	if (editor.getLine(0).trim() !== "---") return false; // 前置元数据必须在文档第一行
	for (let i = 1; i <= editor.lastLine(); i++) {
		if (/^(---|\.\.\.)\s*$/.test(editor.getLine(i))) return line > 0 && line < i;
	}
	return false;
}

/**
 * 飞书式斜杠菜单：行首（或列表项开头）输入 / 唤起。
 * 支持中文 / 英文 / 拼音全称 / 拼音缩写匹配（如 glk = 高亮块）。
 */
export class SlashSuggest extends EditorSuggest<SlashItem> {
	private plugin: FeishuLitePlugin;
	/** 最近一次建议列表：进入级联时左栏继续显示这份列表（菜单不消失） */
	private lastItems: SlashItem[] = [];

	constructor(plugin: FeishuLitePlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.limit = 20;
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		// 仅当 / 是行首第一个非空字符（可带缩进或列表符号）时触发，避免误伤 URL / 路径 / 日期
		const m = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?)\/([^\s/]*)$/.exec(before);
		if (!m) return null;
		// 代码块 / 行内代码 / 前置元数据里不弹斜杠菜单（否则 Enter 会把命令内容插进代码）
		if (inCodeContext(editor, cursor.line, m[1].length)) return null;
		const start: EditorPosition = { line: cursor.line, ch: m[1].length };
		return { start, end: cursor, query: m[2] };
	}

	getSuggestions(context: EditorSuggestContext): SlashItem[] {
		const q = context.query.trim().toLowerCase();
		// 刚敲 `/` 时只列主项，次级项（选类型/指定栏数等）输入关键词才出现
		const items = !q
			? SLASH_ITEMS.filter((it) => !it.secondary)
			: SLASH_ITEMS.filter(
					(it) =>
						it.keys.some((k) => k.toLowerCase().startsWith(q)) ||
						it.keys.some((k) => k.toLowerCase().includes(q))
				);
		this.lastItems = items;
		return items;
	}

	renderSuggestion(item: SlashItem, el: HTMLElement): void {
		el.addClass("fl-slash-item");
		el.createDiv({ cls: "fl-slash-name", text: item.name });
		el.createDiv({ cls: "fl-slash-hint", text: item.hint });
	}

	selectSuggestion(item: SlashItem): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor, start, end, file } = ctx;
		// 先吃掉输入的 /query，再执行插入
		editor.replaceRange("", start, end);
		const source = (file as TFile | null) ?? null;
		// 参数式项：一级菜单保留在左、参数展开在右（飞书式级联，不再弹筛选弹窗）
		if (item.params) {
			openSlashCascade(this.plugin, editor, source, this.lastItems.length ? this.lastItems : [item], item);
			return;
		}
		Promise.resolve()
			.then(() => item.run(this.plugin, editor, source))
			.catch((err) => {
				console.error("[feishu-lite] slash 操作失败", err);
				new Notice("Feishu Lite：操作失败，详见控制台");
			});
	}
}
