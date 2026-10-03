import { Editor, TFile } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";
import { TEXT_COL_OPTIONS, insertTextColumns } from "./column";
import { openTablePicker } from "./table-picker";
import { HL_COLOR_OPTIONS, pickColorAndHighlight, wrapHighlight } from "./highlight";
import { insertGridSkeletonCols, openImagePicker, wrapSelectionIntoGrid } from "./image-grid";
import { insertMermaid, insertMermaidType, MERMAID_TYPES } from "./mermaid-snippets";
import type { MermaidType } from "./mermaid-snippets";
import type { ListOption } from "./util";

/** 参数式项的级联规格：回车后在菜单右侧展开，而非直接执行 */
export interface SlashParamSpec {
	title: string;
	options: ListOption<unknown>[];
	run: (plugin: FeishuLitePlugin, editor: Editor, file: TFile | null, value: unknown) => void | Promise<void>;
}

export interface SlashItem {
	id: string;
	name: string;
	hint: string;
	/** 匹配键：英文 / 拼音全称 / 拼音缩写 / 中文，任一前缀或包含即命中 */
	keys: string[];
	/** 次级项：刚输入 `/` 时默认不出现在列表里，输入关键词才命中（如"高亮块·选类型"） */
	secondary?: boolean;
	/** 有参数的项：斜杠菜单回车后在菜单右侧展开级联（run 仅作兜底） */
	params?: SlashParamSpec;
	run: (plugin: FeishuLitePlugin, editor: Editor, file: TFile | null) => void | Promise<void>;
}

const CALLOUT_TYPES = [
	{ label: "提示 note", value: "note", hint: "蓝色 · 默认" },
	{ label: "建议 tip", value: "tip", hint: "青色" },
	{ label: "成功 success", value: "success", hint: "绿色" },
	{ label: "注意 warning", value: "warning", hint: "橙色" },
	{ label: "危险 danger", value: "danger", hint: "红色" },
	{ label: "信息 info", value: "info", hint: "蓝色" },
	{ label: "问题 question", value: "question", hint: "黄色" },
	{ label: "示例 example", value: "example", hint: "紫色" },
];

const CODE_LANGS = [
	["javascript", "JS"], ["typescript", "TS"], ["python", "Python"], ["java", "Java"],
	["kotlin", "Kotlin"], ["swift", "Swift"], ["objective-c", "OC"], ["c", "C"],
	["cpp", "C++"], ["csharp", "C#"], ["go", "Go"], ["rust", "Rust"],
	["bash", "Bash"], ["shell", "Shell"], ["json", "JSON"], ["yaml", "YAML"],
	["sql", "SQL"], ["html", "HTML"], ["css", "CSS"], ["xml", "XML"],
	["latex", "LaTeX"], ["markdown", "Markdown"], ["text", "纯文本"],
].map(([value, label]) => ({ value, label: `${label} (${value})` }));

const MERMAID_OPTIONS: ListOption<unknown>[] = MERMAID_TYPES.map((t) => ({
	label: t.label,
	value: t,
	hint: t.hint,
}));

export function insertCallout(_plugin: FeishuLitePlugin, editor: Editor, fold: boolean): void {
	openCascade(editor, fold ? "折叠高亮块 · 选类型" : "高亮块 · 选类型", CALLOUT_TYPES, (type) =>
		insertCalloutOfType(editor, type, fold)
	);
}

/** 按指定类型插入高亮块 */
export function insertCalloutOfType(editor: Editor, type: string, fold: boolean): void {
	const marker = fold ? `[!${type}]-` : `[!${type}]`;
	editor.replaceSelection(`> ${marker}\n> `);
}

/** 回车直接插入高亮块（默认「提示」样式），不弹类型选择器 */
export function insertCalloutDirect(editor: Editor, fold: boolean): void {
	const marker = fold ? "[!tip]-" : "[!tip]";
	editor.replaceSelection(`> ${marker}\n> `);
}

export function insertCodeBlock(_plugin: FeishuLitePlugin, editor: Editor): void {
	openCascade(editor, "代码块 · 选语言", CODE_LANGS, (lang) => insertCodeBlockOfLang(editor, lang));
}

/** 按指定语言插入代码块（光标停在内容行） */
export function insertCodeBlockOfLang(editor: Editor, lang: string): void {
	const start = editor.getCursor();
	editor.replaceSelection("```" + lang + "\n\n```");
	editor.setCursor({ line: start.line + 1, ch: 0 });
}

export function insertTodo(editor: Editor): void {
	const cur = editor.getCursor();
	const before = editor.getLine(cur.line).slice(0, cur.ch);
	// 已在列表项里（如 "- /todo"）则直接补复选标记
	if (/^\s*[-*+]\s+$/.test(before)) editor.replaceSelection("[ ] ");
	else editor.replaceSelection("- [ ] ");
}

export function insertQuote(editor: Editor): void {
	editor.replaceSelection("> ");
}

export function insertDivider(editor: Editor): void {
	const cur = editor.getCursor();
	const before = editor.getLine(cur.line).slice(0, cur.ch);
	const after = editor.getLine(cur.line).slice(cur.ch);
	if (before.trim() === "" && after.trim() === "") editor.replaceSelection("---\n");
	else editor.replaceSelection("\n---\n");
}

export function insertDate(editor: Editor): void {
	const d = new Date();
	const p = (n: number) => (n < 10 ? "0" + n : String(n));
	editor.replaceSelection(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

export const SLASH_ITEMS: SlashItem[] = [
	{
		id: "callout",
		name: "高亮块",
		hint: "/glk 或 /glklx · 回车选类型（默认提示块）",
		keys: ["callout", "callouttype", "gaoliangkuai", "gaoliangkuaileixing", "glk", "glklx", "高亮块", "高亮块类型", "高亮类型", "高亮", "col"],
		params: {
			title: "高亮块 · 选类型",
			options: CALLOUT_TYPES,
			run: (_p, e, _f, v) => insertCalloutOfType(e, v as string, false),
		},
		run: (p, e) => insertCallout(p, e, false),
	},
	{
		id: "fold",
		name: "折叠高亮块",
		hint: "/zdk · 回车直接插入折叠块",
		keys: ["fold", "zhedie", "zdk", "折叠", "折叠块"],
		run: (_p, e) => insertCalloutDirect(e, true),
	},
	{
		id: "code",
		name: "代码块",
		hint: "/dmk · 选择语言后插入",
		keys: ["code", "daimakuai", "daima", "dmk", "代码块", "代码"],
		params: {
			title: "代码块 · 选语言",
			options: CODE_LANGS,
			run: (_p, e, _f, v) => insertCodeBlockOfLang(e, v as string),
		},
		run: (p, e) => insertCodeBlock(p, e),
	},
	{
		id: "mermaid",
		name: "Mermaid 图",
		hint: "/mmd · 选类型插入骨架（流程图/时序/甘特…）",
		keys: ["mermaid", "mmd", "liucheng", "图表", "流程图"],
		params: {
			title: "Mermaid 图 · 选类型",
			options: MERMAID_OPTIONS,
			run: (_p, e, _f, v) => insertMermaidType(e, v as MermaidType),
		},
		run: (p, e) => insertMermaid(p, e),
	},
	{
		id: "todo",
		name: "待办",
		hint: "/rw · - [ ] 任务项",
		keys: ["todo", "task", "renwu", "rw", "待办", "任务"],
		run: (_p, e) => insertTodo(e),
	},
	{
		id: "quote",
		name: "引用",
		hint: "/yy · > 引用块",
		keys: ["quote", "yinyong", "yy", "引用"],
		run: (_p, e) => insertQuote(e),
	},
	{
		id: "divider",
		name: "分割线",
		hint: "/fgx · ---",
		keys: ["divider", "fengexian", "fgx", "分割线", "hr"],
		run: (_p, e) => insertDivider(e),
	},
	{
		id: "table",
		name: "表格",
		hint: "/bg · 悬停网格选行列插入",
		keys: ["table", "biaoge", "bg", "表格"],
		run: (_p, e) => openTablePicker(e),
	},
	{
		id: "grid",
		name: "图片分栏",
		hint: "/tpfl · 回车按默认栏数；tpfl2/3/4 指定",
		keys: ["grid", "tupianfenlan", "fenlan", "tpfl", "fl", "图片分栏", "分栏"],
		run: (p, e) => insertGridSkeletonCols(e, p.settings.defaultColumns),
	},
	{
		id: "grid-2",
		name: "图片分栏·2栏",
		hint: "/tpfl2 · 两列并排",
		keys: ["tpfl2", "erlan", "2lan", "2栏"],
		secondary: true,
		run: (_p, e) => insertGridSkeletonCols(e, 2),
	},
	{
		id: "grid-3",
		name: "图片分栏·3栏",
		hint: "/tpfl3 · 三列并排",
		keys: ["tpfl3", "sanlan", "3lan", "3栏"],
		secondary: true,
		run: (_p, e) => insertGridSkeletonCols(e, 3),
	},
	{
		id: "grid-4",
		name: "图片分栏·4栏",
		hint: "/tpfl4 · 四列并排",
		keys: ["tpfl4", "silan", "4lan", "4栏"],
		secondary: true,
		run: (_p, e) => insertGridSkeletonCols(e, 4),
	},
	{
		id: "text-columns",
		name: "文字分栏",
		hint: "/wzfl · 回车选栏数（2/3/4 栏并排）",
		keys: ["wzfl", "wenzifenlan", "文字分栏", "文字栏"],
		params: {
			title: "文字分栏 · 选栏数",
			options: TEXT_COL_OPTIONS,
			run: (_p, e, _f, v) => insertTextColumns(e, v as number),
		},
		run: (_p, e) => insertTextColumns(e, 2),
	},
	{
		id: "picker",
		name: "插入图片",
		hint: "/tp · 从图库多选（空格多选）",
		keys: ["image", "tupian", "tp", "图片", "插图", "chatu", "ct"],
		run: (p, e, f) => openImagePicker(p, e, f?.path ?? ""),
	},
	{
		id: "wrap",
		name: "选中包成多栏",
		hint: "/dl · 把选中的图片行包成网格",
		keys: ["wrap", "duolan", "dl", "多栏", "成栏", "包栏"],
		run: (p, e) => wrapSelectionIntoGrid(p, e),
	},
	{
		id: "highlight",
		name: "高亮",
		hint: "/hl 或 /cshl · 文本高亮，回车后选颜色（含默认）",
		keys: ["highlight", "gaoliang", "hl", "cshl", "caisegaoliang", "高亮", "高亮色", "彩色高亮"],
		params: {
			title: "高亮 · 选颜色",
			options: HL_COLOR_OPTIONS,
			run: (_p, e, _f, v) => wrapHighlight(e, v as string),
		},
		run: (p, e) => pickColorAndHighlight(p, e),
	},
	{
		id: "date",
		name: "日期",
		hint: "/rq · 插入今天日期",
		keys: ["date", "riqi", "rq", "日期", "today"],
		run: (_p, e) => insertDate(e),
	},
];
