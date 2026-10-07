import { Editor, Notice, TFile } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";
import { TEXT_COL_OPTIONS, insertTextColumns } from "./column";
import { openTablePicker } from "./table-picker";
import { HL_COLOR_OPTIONS, pickColorAndHighlight, wrapHighlight } from "./highlight";
import { insertGridSkeletonCols, openImagePicker, wrapSelectionIntoGrid } from "./image-grid";
import { insertMermaid, insertMermaidType, MERMAID_TYPES } from "./mermaid-snippets";
import type { MermaidType } from "./mermaid-snippets";
import { isPluginEnabled } from "./util";
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
	/** 说明行（菜单右侧灰色小字）；可传函数、每次渲染时求值（第三方扩展项用得上） */
	hint: string | (() => string);
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

const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** 日期命令：弹出格式级联（选项即今天日期的实际写法，所见即所得） */
export function openDatePicker(editor: Editor): void {
	const d = new Date();
	const p = (n: number) => (n < 10 ? "0" + n : String(n));
	const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	const cn = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
	const week = `周${WEEK_CN[d.getDay()] ?? ""}`;
	const monthDay = `${d.getMonth() + 1}月${d.getDate()}日`;
	const withTime = `${iso} ${p(d.getHours())}:${p(d.getMinutes())}`;
	const options: ListOption<string>[] = [
		{ label: iso, value: iso, hint: "标准" },
		{ label: cn, value: cn, hint: "中文" },
		{ label: `${cn}（${week}）`, value: `${cn}（${week}）`, hint: "中文 · 带星期" },
		{ label: monthDay, value: monthDay, hint: "月日" },
		{ label: withTime, value: withTime, hint: "日期 + 时间" },
	];
	openCascade(editor, "日期 · 选格式", options, (v) => editor.replaceSelection(v));
}

const EXCALIDRAW_ID = "obsidian-excalidraw-plugin";

/** 个别命令执行条件不满足时的专属提示（默认给通用文案） */
const EXCALIDRAW_UNAVAILABLE: Record<string, string> = {
	"excalidraw-insert-last-active-transclusion": "还没有最近编辑过的画板",
};

/** 画板：转发给 Excalidraw 插件的官方命令（画板的创建 / 命名 / 存储 / 渲染全归 Excalidraw，本插件只做入口） */
function runExcalidraw(plugin: FeishuLitePlugin, command: string): void {
	if (!isPluginEnabled(plugin.app, EXCALIDRAW_ID)) {
		new Notice("Feishu Lite：画板需要 Excalidraw 插件（请先在社区插件中启用）");
		return;
	}
	// app.commands 未进 obsidian.d.ts 公开类型（运行时存在）；窄接口收口
	const registry = (plugin.app as unknown as {
		commands?: { commands?: Record<string, unknown>; executeCommandById?: (id: string) => boolean };
	}).commands;
	const id = `${EXCALIDRAW_ID}:${command}`;
	if (!registry?.commands || !(id in registry.commands)) {
		new Notice("Feishu Lite：未找到 Excalidraw 命令（插件版本可能过低）");
		return;
	}
	if (!registry.executeCommandById?.(id)) {
		new Notice(`Feishu Lite：${EXCALIDRAW_UNAVAILABLE[command] ?? "Excalidraw 命令当前不可用"}`);
	}
}

const BOARD_OPTIONS: ListOption<unknown>[] = [
	{ label: "新建并嵌入", value: "excalidraw-autocreate-and-embed", hint: "新建画板并嵌入当前笔记（默认）" },
	{ label: "新建 · 全屏编辑", value: "excalidraw-autocreate-newtab", hint: "新标签打开，先画后嵌" },
	{ label: "嵌入已有画板", value: "excalidraw-insert-transclusion", hint: "从库里的画板中挑选" },
	{ label: "嵌入最近画板", value: "excalidraw-insert-last-active-transclusion", hint: "插入最近编辑过的画板" },
];

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
		hint: "/rq · 回车选格式（标准 / 中文 / 带星期 / 月日 / 含时间）",
		keys: ["date", "riqi", "rq", "日期", "today"],
		run: (_p, e) => openDatePicker(e),
	},
	{
		id: "board",
		name: "画板",
		hint: "/hb · 新建画板并嵌入当前笔记（Excalidraw）",
		keys: ["board", "huaban", "hb", "画板", "白板", "baiban", "bb", "excalidraw", "绘图", "huitu"],
		run: (p) => runExcalidraw(p, "excalidraw-autocreate-and-embed"),
	},
	{
		id: "board-pick",
		name: "画板 · 选方式",
		hint: "/hblx · 新建 / 全屏 / 嵌入已有 / 嵌入最近",
		keys: ["hblx", "huabanxuanze", "画板方式", "画板选项", "嵌入画板", "插入画板"],
		secondary: true,
		params: {
			title: "画板 · 选方式",
			options: BOARD_OPTIONS,
			run: (p, _e, _f, v) => runExcalidraw(p, v as string),
		},
		run: (p, e) => openCascade(e, "画板 · 选方式", BOARD_OPTIONS, (v) => runExcalidraw(p, v as string)),
	},
];
