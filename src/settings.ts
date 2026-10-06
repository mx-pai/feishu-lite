import { App, Notice, PluginSettingTab } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import type FeishuLitePlugin from "./main";
import { buildImageName } from "./naming";
import type { DateStyle } from "./naming";
import { HL_COLORS } from "./highlight";
import { showTocPanel, syncToc } from "./toc";
import { clearReadPositions } from "./read-position";
import { t } from "./i18n";

export interface FlSettings {
	commentsEnabled: boolean;
	commentAuthor: string;
	imageTools: boolean;
	/** 粘贴/拖入图片时按模板重命名 */
	renameOnPaste: boolean;
	/** 命名模板，支持 {note} {date} {time} {i} */
	namePattern: string;
	/** {date} 的写法：compact=20261003 · dash=2026-10-03 · short=261003 */
	datePattern: DateStyle;
	/** 一次粘贴多张图片时自动包成网格 */
	autoGridOnMultiPaste: boolean;
	/** 斜杠 /tpfl、图库多选插入、自动成栏的默认列数 */
	defaultColumns: number;
	/** 0 = 自适应高度；>0 = 固定行高（等高裁切） */
	gridRowHeight: number;
	gridGap: number;
	gridRadius: number;
	/** 空分栏显示虚线占位提示 */
	showEmptyGridHint: boolean;
	/** 编辑视图：分栏源码态下用缩略图代替文件名文字 */
	gridSourceThumbs: boolean;
	/** 在编辑视图（Live Preview）渲染彩色高亮 */
	lpHighlight: boolean;
	/** 阅读视图：代码块美化（语言徽标 / 一键复制 / 行号） */
	codePretty: boolean;
	/** 阅读视图：图片查看器（点击图片放大；滚轮缩放 / 拖拽平移） */
	imageLightbox: boolean;
	/** 附件自动清理：全库无引用且超过 24 小时的图片移入回收站 */
	autoCleanAttachments: boolean;
	/** 阅读视图：表格斑马纹 + 悬停行高亮 */
	tablePretty: boolean;
	/** 浮动目录（Feishu 式右侧悬浮大纲）当前是否显示；命令 / 面板收起按钮会翻转并持久化 */
	tocVisible: boolean;
	/** 阅读位置记忆：重开笔记自动回到上次读到的位置（阅读视图生效，按笔记单独记） */
	rememberScroll: boolean;
	/** 粘贴时自动美化中英混排（中文与英文/数字间补空格；命令「格式：中英混排美化」可手动执行） */
	cjkPaste: boolean;
	/** 阅读位置表：vault 路径 -> 视口顶部行号（由 read-position 模块自动维护，勿手改） */
	readPositions: Record<string, number>;
	/** 自定义高亮颜色（颜色名 -> #hex），空 = 使用内置配色 */
	customHighlightColors: Record<string, string>;
	/** 图库多选插入器：搜索范围 */
	pickerScope: "all" | "attachments";
	/** 图库多选插入器：排序 */
	pickerSort: "newest" | "oldest" | "name";
	/** 表格增强：Tab/Shift+Tab/Enter 跳格 + 自动对齐（Advanced Tables 启用时自动让位） */
	tableAssist: boolean;
	/** 列表增强：Cmd+Shift+↑/↓ 整棵子树移动（Outliner 启用时自动让位） */
	listAssist: boolean;
	/** 划词工具条：选中文字时浮现小工具条（高亮换色 / 行内代码） */
	selectToolbar: boolean;
	/** 粘贴 / 拖入时压缩图片 */
	compressOnPaste: boolean;
	/** 压缩格式：webp（支持透明）| jpeg */
	compressFormat: "webp" | "jpeg";
	/** 压缩质量 10-100 */
	compressQuality: number;
	/** 最长边像素，超过等比缩小；0 = 不限 */
	compressMaxEdge: number;
}

export const DEFAULT_SETTINGS: FlSettings = {
	commentsEnabled: true,
	commentAuthor: "我",
	imageTools: true,
	renameOnPaste: true,
	namePattern: "{note}-{date}-{i}",
	datePattern: "compact",
	autoGridOnMultiPaste: true,
	defaultColumns: 3,
	gridRowHeight: 0,
	gridGap: 8,
	gridRadius: 8,
	showEmptyGridHint: true,
	gridSourceThumbs: true,
	lpHighlight: true,
	codePretty: true,
	imageLightbox: true,
	autoCleanAttachments: true,
	tablePretty: true,
	tocVisible: false,
	rememberScroll: true,
	cjkPaste: false,
	readPositions: {},
	customHighlightColors: {},
	pickerScope: "all",
	pickerSort: "newest",
	tableAssist: true,
	listAssist: true,
	selectToolbar: true,
	compressOnPaste: false,
	compressFormat: "webp",
	compressQuality: 80,
	compressMaxEdge: 1600,
};

/** 嵌套表字段的拷贝：类型不符（旧数据 / 损坏数据）时回落到默认值的拷贝 */
function cloneRecord<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
	const source = value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
	return { ...source };
}

/**
 * 载入 / 重置用的归一化：默认值整体深拷贝后与已存数据合并。
 * 关键点：嵌套对象（readPositions / customHighlightColors）绝不与 DEFAULT_SETTINGS 共享引用——
 * 否则运行期写入会写脏默认值，「恢复默认」就恢复不出来。
 */
export function normalizeSettings(data: Partial<FlSettings> | null): FlSettings {
	const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as FlSettings;
	if (!data) return base;
	return {
		...base,
		...data,
		readPositions: cloneRecord(data.readPositions, base.readPositions),
		customHighlightColors: cloneRecord(data.customHighlightColors, base.customHighlightColors),
	};
}

/** 高亮 7 色的默认色值（与 styles.css 的 --fl-hl-* 默认配色一致，供颜色选择器回显） */
const HL_DEFAULT_HEX: Record<string, string> = {
	red: "#ff6363",
	orange: "#ff9f40",
	yellow: "#ffd900",
	green: "#48c776",
	blue: "#4a90ff",
	purple: "#9e6cf0",
	gray: "#8c8c8c",
};

function hexToRgba(hex: string, alpha: number): string | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1] ?? "", 16);
	if (!Number.isFinite(n)) return null;
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 把设置注入 body（CSS 变量 + 行为类名，styles.css 消费） */
export function applyCssVars(s: FlSettings): void {
	const body = document.body;
	body.style.setProperty("--fl-grid-gap", `${s.gridGap}px`);
	body.style.setProperty("--fl-grid-radius", `${s.gridRadius}px`);
	body.style.setProperty("--fl-grid-row-height", s.gridRowHeight > 0 ? `${s.gridRowHeight}px` : "auto");
	body.classList.toggle("fl-hide-empty-hint", !s.showEmptyGridHint);
	body.classList.toggle("fl-table-pretty", s.tablePretty);

	// 自定义高亮颜色：只覆盖用户改过的颜色；未设置时移除内联值，回落到 styles.css 默认配色
	const custom = s.customHighlightColors ?? {};
	for (const c of HL_COLORS) {
		const hex = custom[c.value];
		const rgba = hex ? hexToRgba(hex, 0.32) : null;
		if (rgba) body.style.setProperty(`--fl-hl-${c.value}`, rgba);
		else body.style.removeProperty(`--fl-hl-${c.value}`);
	}
}

/** 读取库设置的附件目录名（用于「仅附件目录」选项的显示与过滤） */
function attachmentFolder(app: App): string {
	try {
		const raw = (app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.(
			"attachmentFolderPath"
		);
		const v = (typeof raw === "string" ? raw : "")
			.replace(/^\.\//, "")
			.replace(/^\/+|\/+$/g, "");
		return v === "." ? "" : v;
	} catch {
		return "";
	}
}

/**
 * 设置页（Obsidian 1.13+ 声明式设置）：
 * - 全部界面由 getSettingDefinitions() 描述（原生外观 + 全局设置搜索）；
 *   官方迁移指南（Path A）要求 minAppVersion ≥ 1.13.0 后移除 display()
 * - 控件的读写走 getControlValue / setControlValue 覆写：写回统一走 plugin.saveSettings()
 *   （落盘 + CSS 变量 + 编辑器重绘），并补设置项副作用（批注刷新 / 工具条收起 / 目录联动）
 * - 文案全部来自 src/i18n（中文 / 英文按 Obsidian 界面语言自动选择）
 */
export class FlSettingTab extends PluginSettingTab {
	icon = "feather";

	private plugin: FeishuLitePlugin;
	private colorTimer: number | null = null;

	constructor(app: App, plugin: FeishuLitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ---------- 声明式控件的值通道 ----------

	/** 读取：普通键直接读设置字段；hl.* 读自定义高亮配色（缺省回落到内置色） */
	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key.startsWith("hl.")) {
			const name = key.slice(3);
			return s.customHighlightColors[name] ?? HL_DEFAULT_HEX[name] ?? "#888888";
		}
		return (s as unknown as Record<string, unknown>)[key];
	}

	/** 写入：转型 / 夹取后落盘；取色器拖动只做即时预览 + 节流落盘（避免高频派发编辑器事务）。 */
	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (key.startsWith("hl.")) {
			const name = key.slice(3);
			if (typeof value === "string") {
				this.plugin.settings.customHighlightColors = {
					...this.plugin.settings.customHighlightColors,
					[name]: value,
				};
				applyCssVars(this.plugin.settings);
				this.persistColorsSoon();
			}
			return;
		}
		this.writeSetting(key, value);
		return this.commit(key);
	}

	/** 逐键转型写入（下拉框给字符串、数字控件给数字，统一在这里夹取到合法范围） */
	private writeSetting(key: string, value: unknown): void {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		switch (key) {
			case "defaultColumns":
				s.defaultColumns = Math.min(4, Math.max(2, Math.floor(Number(value)) || 3));
				break;
			case "gridRowHeight":
				s.gridRowHeight = Math.max(0, Math.floor(Number(value)) || 0);
				break;
			case "gridGap":
				s.gridGap = Math.min(40, Math.max(0, Math.floor(Number(value)) || 0));
				break;
			case "gridRadius":
				s.gridRadius = Math.min(40, Math.max(0, Math.floor(Number(value)) || 0));
				break;
			case "compressQuality":
				s.compressQuality = Math.min(100, Math.max(10, Math.floor(Number(value)) || 80));
				break;
			case "compressMaxEdge":
				s.compressMaxEdge = Math.max(0, Math.floor(Number(value)) || 0);
				break;
			case "datePattern":
				s.datePattern = value === "dash" || value === "short" ? value : "compact";
				break;
			case "compressFormat":
				s.compressFormat = value === "jpeg" ? "jpeg" : "webp";
				break;
			case "pickerScope":
				s.pickerScope = value === "attachments" ? "attachments" : "all";
				break;
			case "pickerSort":
				s.pickerSort = value === "oldest" || value === "name" ? value : "newest";
				break;
			case "commentAuthor":
				s.commentAuthor =
					(typeof value === "string" ? value.trim() : "") || DEFAULT_SETTINGS.commentAuthor;
				break;
			default:
				// 布尔开关与其余字符串字段：原样写入
				s[key] = value;
		}
	}

	/** 写回后的统一收尾：落盘 + 设置项副作用 + 可见性谓词重估 */
	private async commit(key: string): Promise<void> {
		await this.plugin.saveSettings();
		switch (key) {
			case "commentsEnabled":
				this.plugin.comments.schedule();
				break;
			case "imageTools":
				this.plugin.imageTools.closeToolbar();
				break;
			case "tocVisible":
				if (this.plugin.settings.tocVisible) showTocPanel(this.plugin);
				else syncToc(this.plugin);
				break;
			case "datePattern":
				this.update(); // 命名模板行的示例要跟着新日期格式重绘
				break;
		}
		this.refreshDomState();
	}

	/** 取色器拖动：400ms 后落盘（与旧界面的节流策略一致；拖动过程只走 CSS 变量即时预览） */
	private persistColorsSoon(): void {
		if (this.colorTimer !== null) window.clearTimeout(this.colorTimer);
		this.colorTimer = window.setTimeout(() => {
			this.colorTimer = null;
			void this.plugin.persistSettings();
		}, 400);
	}

	/** 用当前设置和当前笔记名生成一个命名示例，用于「命名模板」实时预览 */
	private previewName(): string {
		const note = this.app.workspace.getActiveFile()?.basename || t.paste.pattern.noteFallback;
		const s = this.plugin.settings;
		return buildImageName(s.namePattern || DEFAULT_SETTINGS.namePattern, note, 1, "png", s.datePattern);
	}

	/** 恢复默认设置：先确认，再整体归一化 + 清阅读位置 + 落盘 + 界面联动 */
	private async resetToDefaults(): Promise<void> {
		const ok = await this.plugin.confirmAction(t.maintenance.confirmTitle, t.maintenance.confirmMessage);
		if (!ok) return;
		// 走归一化函数取默认值：嵌套对象都是深拷贝，恢复后不会与 DEFAULT_SETTINGS 再共享引用
		Object.assign(this.plugin.settings, normalizeSettings(null));
		clearReadPositions(); // 阅读位置表已换新引用：模块内 map 同步清空，防止旧记录被写回
		await this.plugin.saveSettings();
		syncToc(this.plugin); // 浮动目录可见性可能变化：立即生效
		this.update();
		new Notice(t.notices.defaultsRestored);
	}

	// ---------- 设置页定义 ----------

	getSettingDefinitions(): SettingDefinitionItem[] {
		const folder = attachmentFolder(this.app);
		return [
			{
				type: "group",
				heading: t.groups.paste,
				items: [
					{
						name: t.paste.rename.name,
						desc: t.paste.rename.desc,
						control: { type: "toggle", key: "renameOnPaste" },
					},
					{
						name: t.paste.pattern.name,
						desc: t.paste.pattern.desc,
						visible: () => this.plugin.settings.renameOnPaste,
						render: (setting) => {
							const preview = setting.descEl.createDiv({ cls: "fl-setting-preview" });
							const refresh = (): void => preview.setText(t.paste.pattern.preview(this.previewName()));
							refresh();
							setting.addText((text) =>
								text
									.setPlaceholder(DEFAULT_SETTINGS.namePattern)
									.setValue(this.plugin.settings.namePattern)
									.onChange(async (value) => {
										this.plugin.settings.namePattern =
											value.trim() || DEFAULT_SETTINGS.namePattern;
										await this.plugin.saveSettings();
										refresh();
									})
							);
						},
					},
					{
						name: t.paste.datePattern.name,
						desc: t.paste.datePattern.desc,
						visible: () => this.plugin.settings.renameOnPaste,
						control: {
							type: "dropdown",
							key: "datePattern",
							options: t.paste.datePattern.options,
						},
					},
					{
						name: t.paste.compress.name,
						desc: t.paste.compress.desc,
						control: { type: "toggle", key: "compressOnPaste" },
					},
					{
						name: t.paste.format.name,
						desc: t.paste.format.desc,
						visible: () => this.plugin.settings.compressOnPaste,
						control: {
							type: "dropdown",
							key: "compressFormat",
							options: t.paste.format.options,
						},
					},
					{
						name: t.paste.quality.name,
						desc: t.paste.quality.desc,
						visible: () => this.plugin.settings.compressOnPaste,
						control: {
							type: "slider",
							key: "compressQuality",
							min: 10,
							max: 100,
							step: 1,
							displayFormat: (v) => `${v}`,
						},
					},
					{
						name: t.paste.maxEdge.name,
						desc: t.paste.maxEdge.desc,
						visible: () => this.plugin.settings.compressOnPaste,
						control: { type: "number", key: "compressMaxEdge", min: 0, step: 10, placeholder: "1600" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.grid,
				items: [
					{
						name: t.grid.columns.name,
						desc: t.grid.columns.desc,
						control: { type: "dropdown", key: "defaultColumns", options: t.grid.columns.options },
					},
					{
						name: t.grid.autoWrap.name,
						desc: t.grid.autoWrap.desc,
						control: { type: "toggle", key: "autoGridOnMultiPaste" },
					},
					{
						name: t.grid.rowHeight.name,
						desc: t.grid.rowHeight.desc,
						control: { type: "number", key: "gridRowHeight", min: 0, step: 10, placeholder: "0" },
					},
					{
						name: t.grid.gap.name,
						desc: t.grid.gap.desc,
						control: {
							type: "slider",
							key: "gridGap",
							min: 0,
							max: 40,
							step: 1,
							displayFormat: (v) => `${v} px`,
						},
					},
					{
						name: t.grid.radius.name,
						desc: t.grid.radius.desc,
						control: {
							type: "slider",
							key: "gridRadius",
							min: 0,
							max: 40,
							step: 1,
							displayFormat: (v) => `${v} px`,
						},
					},
					{
						name: t.grid.preview,
						searchable: false,
						render: (setting) => {
							setting.settingEl.addClass("fl-grid-preview-row");
							const preview = setting.controlEl.createDiv({ cls: "fl-grid-preview" });
							preview.createDiv();
							preview.createDiv();
							preview.createDiv();
						},
					},
					{
						name: t.grid.emptyHint.name,
						desc: t.grid.emptyHint.desc,
						control: { type: "toggle", key: "showEmptyGridHint" },
					},
					{
						name: t.grid.sourceThumbs.name,
						desc: t.grid.sourceThumbs.desc,
						control: { type: "toggle", key: "gridSourceThumbs" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.imageTools,
				items: [
					{
						name: t.imageTools.toolbar.name,
						desc: t.imageTools.toolbar.desc,
						control: { type: "toggle", key: "imageTools" },
					},
					{
						name: t.imageTools.lightbox.name,
						desc: t.imageTools.lightbox.desc,
						control: { type: "toggle", key: "imageLightbox" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.library,
				items: [
					{
						name: t.library.scope.name,
						desc: t.library.scope.desc,
						control: {
							type: "dropdown",
							key: "pickerScope",
							options: {
								all: t.library.scope.all,
								attachments: t.library.scope.attachmentsOnly(folder),
							},
						},
					},
					{
						name: t.library.sort.name,
						desc: t.library.sort.desc,
						control: { type: "dropdown", key: "pickerSort", options: t.library.sort.options },
					},
					{
						name: t.library.clean.name,
						desc: t.library.clean.desc,
						control: { type: "toggle", key: "autoCleanAttachments" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.editor,
				items: [
					{
						name: t.editor.toolbar.name,
						desc: t.editor.toolbar.desc,
						control: { type: "toggle", key: "selectToolbar" },
					},
					{
						name: t.editor.table.name,
						desc: t.editor.table.desc,
						control: { type: "toggle", key: "tableAssist" },
					},
					{
						name: t.editor.list.name,
						desc: t.editor.list.desc,
						control: { type: "toggle", key: "listAssist" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.comments,
				items: [
					{
						name: t.comments.enabled.name,
						desc: t.comments.enabled.desc,
						control: { type: "toggle", key: "commentsEnabled" },
					},
					{
						name: t.comments.author.name,
						desc: t.comments.author.desc,
						visible: () => this.plugin.settings.commentsEnabled,
						control: { type: "text", key: "commentAuthor" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.highlight,
				items: [
					{
						name: t.highlight.livePreview.name,
						desc: t.highlight.livePreview.desc,
						control: { type: "toggle", key: "lpHighlight" },
					},
					...HL_COLORS.map(
						(c): SettingDefinition => ({
							name: (t.highlight.colors as Record<string, string>)[c.value] ?? c.label,
							control: { type: "color", key: `hl.${c.value}` },
						})
					),
					{
						name: t.highlight.restoreColors,
						action: () => {
							this.plugin.settings.customHighlightColors = {};
							void this.plugin.saveSettings();
							this.update();
							new Notice(t.notices.colorsRestored);
						},
					},
				],
			},
			{
				type: "group",
				heading: t.groups.reading,
				items: [
					{
						name: t.reading.codePretty.name,
						desc: t.reading.codePretty.desc,
						control: { type: "toggle", key: "codePretty" },
					},
					{
						name: t.reading.tablePretty.name,
						desc: t.reading.tablePretty.desc,
						control: { type: "toggle", key: "tablePretty" },
					},
					{
						name: t.reading.toc.name,
						desc: t.reading.toc.desc,
						control: { type: "toggle", key: "tocVisible" },
					},
					{
						name: t.reading.rememberScroll.name,
						desc: t.reading.rememberScroll.desc,
						control: { type: "toggle", key: "rememberScroll" },
					},
					{
						name: t.reading.cjk.name,
						desc: t.reading.cjk.desc,
						control: { type: "toggle", key: "cjkPaste" },
					},
				],
			},
			{
				type: "group",
				heading: t.groups.maintenance,
				items: [
					{
						name: t.maintenance.reset.name,
						desc: t.maintenance.reset.desc,
						action: () => {
							void this.resetToDefaults();
						},
					},
				],
			},
		];
	}
}
