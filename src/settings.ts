import { App, Notice, PluginSettingTab, requireApiVersion, Setting, setIcon } from "obsidian";
import type FeishuLitePlugin from "./main";
import { buildImageName } from "./naming";
import type { DateStyle } from "./naming";
import { HL_COLORS } from "./highlight";
import { showTocPanel, syncToc } from "./toc";
import { clearReadPositions } from "./read-position";

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
	/** 设置页分区折叠状态（section id → 是否收起；缺省展开） */
	settingsCollapsed: Record<string, boolean>;
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
	settingsCollapsed: {},
};

/** 设置页分区 id（折叠状态键 + 「全部折叠」用） */
const SECTION_IDS = ["naming", "grid", "editor", "annotations", "highlight", "read", "tools", "reset"];

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

export class FlSettingTab extends PluginSettingTab {
	private plugin: FeishuLitePlugin;

	constructor(app: App, plugin: FeishuLitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** 刷新设置页：1.13+ 走 update()；更早版本回落到 display()（minAppVersion < 1.13 时的合法路径） */
	private refresh(): void {
		const tab = this as unknown as { update?: () => void; display?: () => void };
		if (typeof tab.update === "function") tab.update();
		else tab.display?.();
	}

	/** 分区卡片：图标 + 标题（点标题行可折叠 / 展开）+ 说明；返回卡体（该区设置项都挂在它下面）。
	 *  折叠状态存设置（settingsCollapsed），跨会话记住 */
	private section(id: string, icon: string, title: string, desc: string): HTMLElement {
		const wrap = this.containerEl.createDiv({ cls: "fl-sec" });
		const head = wrap.createDiv({ cls: "fl-sec-head" });
		setIcon(head.createDiv({ cls: "fl-sec-icon" }), icon);
		head.createDiv({ cls: "fl-sec-title", text: title });
		const chev = head.createDiv({ cls: "fl-sec-chev" });
		const body = wrap.createDiv({ cls: "fl-sec-body" });
		body.createDiv({ cls: "fl-sec-desc", text: desc });
		// 只刷视觉（初值 + 切换共用）；落盘单独走保存，渲染不写设置
		const setFold = (on: boolean): void => {
			wrap.toggleClass("is-collapsed", on);
			setIcon(chev, on ? "chevron-right" : "chevron-down");
			head.setAttribute("aria-label", on ? `展开「${title}」` : `收起「${title}」`);
		};
		setFold(this.plugin.settings.settingsCollapsed[id] === true);
		head.addEventListener("click", () => {
			const on = !(this.plugin.settings.settingsCollapsed[id] === true);
			setFold(on);
			if (on) this.plugin.settings.settingsCollapsed[id] = true;
			else delete this.plugin.settings.settingsCollapsed[id];
			void this.plugin.saveSettings();
		});
		return body;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("fl-settings");

		const hero = containerEl.createDiv({ cls: "fl-hero" });
		const heroText = hero.createDiv({ cls: "fl-hero-text" });
		heroText.createDiv({ cls: "fl-hero-title", text: "Feishu Lite" });
		heroText.createDiv({ cls: "fl-hero-sub", text: "文档增强 · 批注 / 图片 / 高亮 / 阅读" });
		// 一键收起 / 展开全部分区（找某一项时不用来回滑动）
		const allFolded = SECTION_IDS.every((id) => this.plugin.settings.settingsCollapsed[id] === true);
		const foldAll = hero.createEl("button", {
			cls: "fl-foldall",
			text: allFolded ? "全部展开" : "全部折叠",
		});
		foldAll.setAttribute("aria-label", allFolded ? "展开所有分区" : "收起所有分区");
		foldAll.addEventListener("click", () => {
			if (allFolded) this.plugin.settings.settingsCollapsed = {};
			else for (const id of SECTION_IDS) this.plugin.settings.settingsCollapsed[id] = true;
			void this.plugin.saveSettings();
			this.refresh();
		});

		this.renderNaming(this.section("naming", "image", "图片 · 粘贴与命名", "粘贴 / 拖入图片时自动命名、压缩（落点跟随库的附件设置）"));
		this.renderGrid(this.section("grid", "columns-2", "图片 · 分栏", "斜杠 /tpfl、图库插入与多图粘贴的默认分栏样式"));
		this.renderEditor(this.section("editor", "pencil", "编辑 · 增强", "划词工具条与表格 / 列表操作增强（原插件仍启用时自动让位）"));
		this.renderAnnotations(this.section("annotations", "message-square", "编辑 · 批注与图片工具", "选中文字留批注（存于笔记内）；点击图片弹出工具条调整版式"));
		this.renderHighlight(this.section("highlight", "highlighter", "编辑 · 文本高亮", "=={颜色}文字== 的渲染开关与 7 色配色"));
		this.renderReading(this.section("read", "book-open", "阅读 · 美化与导航", "阅读视图的呈现与定位：代码 / 表格 / 图片美化、浮动目录、阅读位置"));
		this.renderTools(this.section("tools", "images", "图片 · 图库与附件清理", "图库弹窗的搜索范围与排序；全库无引用图片的自动清理"));
		this.renderReset(this.section("reset", "rotate-ccw", "维护", "所有选项回到初始值；不影响已写入笔记的内容"));
	}

	/** 用当前设置和当前笔记名生成一个命名示例，用于「命名模板」实时预览 */
	private previewName(): string {
		const note = this.app.workspace.getActiveFile()?.basename || "笔记";
		const s = this.plugin.settings;
		return buildImageName(s.namePattern || DEFAULT_SETTINGS.namePattern, note, 1, "png", s.datePattern);
	}

	// ---------------- 图片 · 粘贴与命名 ----------------

	private renderNaming(el: HTMLElement): void {
		new Setting(el)
			.setName("粘贴自动命名")
			.setDesc("粘贴 / 拖入图片时，按命名模板重命名后存入附件目录（跟随库设置）；关闭则完全让位给其它插件")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.renameOnPaste).onChange(async (v) => {
					this.plugin.settings.renameOnPaste = v;
					await this.plugin.saveSettings();
				})
			);

		const nameItem = new Setting(el)
			.setName("命名模板")
			.setDesc("可用变量：{note} 笔记名 · {date} 日期 · {time} 时间 · {i} 序号");
		const previewEl = nameItem.descEl.createDiv({ cls: "fl-setting-preview" });
		const refreshPreview = () => previewEl.setText(`示例：${this.previewName()}`);
		refreshPreview();
		nameItem.addText((t) =>
			t
				.setPlaceholder(DEFAULT_SETTINGS.namePattern)
				.setValue(this.plugin.settings.namePattern)
				.onChange(async (v) => {
					this.plugin.settings.namePattern = v.trim() || DEFAULT_SETTINGS.namePattern;
					await this.plugin.saveSettings();
					refreshPreview();
				})
		);

		new Setting(el)
			.setName("日期格式")
			.setDesc("「命名模板」里 {date} 的写法")
			.addDropdown((d) =>
				d
					.addOption("compact", "紧凑：20261003")
					.addOption("dash", "带横线：2026-10-03")
					.addOption("short", "短年份：261003")
					.setValue(this.plugin.settings.datePattern)
					.onChange(async (v) => {
						this.plugin.settings.datePattern = v === "dash" || v === "short" ? v : "compact";
						await this.plugin.saveSettings();
						refreshPreview();
					})
			);

		new Setting(el)
			.setName("粘贴自动压缩")
			.setDesc("粘贴 / 拖入时先压缩再保存（转后更大、失败、GIF / SVG 自动保留原图）")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.compressOnPaste).onChange(async (v) => {
					this.plugin.settings.compressOnPaste = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("压缩格式")
			.setDesc("WebP 支持透明、体积更小；JPEG 兼容性最好但没有透明通道")
			.addDropdown((d) =>
				d
					.addOption("webp", "WebP（推荐）")
					.addOption("jpeg", "JPEG")
					.setValue(this.plugin.settings.compressFormat)
					.onChange(async (v) => {
						this.plugin.settings.compressFormat = v === "jpeg" ? "jpeg" : "webp";
						await this.plugin.saveSettings();
					})
			);

		const qualityItem = new Setting(el).setName("压缩质量").setDesc("越低体积越小；80 左右观感基本无损");
		qualityItem.addSlider((s) =>
			s
				.setLimits(10, 100, 1)
				.setValue(this.plugin.settings.compressQuality)
				.onChange(async (v) => {
					this.plugin.settings.compressQuality = v;
					qualityItem.controlEl.querySelector<HTMLElement>(".fl-slider-val")?.setText(String(v));
					await this.plugin.saveSettings();
				})
		);
		qualityItem.controlEl.createSpan({ cls: "fl-slider-val", text: String(this.plugin.settings.compressQuality) });

		new Setting(el)
			.setName("最长边（px）")
			.setDesc("超过则等比缩小；0 = 不限制尺寸（截图建议 1600 左右）")
			.addText((t) =>
				t
					.setPlaceholder("1600")
					.setValue(String(this.plugin.settings.compressMaxEdge))
					.onChange(async (v) => {
						this.plugin.settings.compressMaxEdge = Math.max(0, parseInt(v, 10) || 0);
						await this.plugin.saveSettings();
					})
			);
	}

	// ---------------- 图片 · 分栏 ----------------

	private renderGrid(el: HTMLElement): void {
		new Setting(el)
			.setName("默认分栏数")
			.setDesc("斜杠菜单 /tpfl、图库多选插入、多图粘贴自动成栏的默认列数")
			.addDropdown((d) =>
				d
					.addOption("2", "2 栏")
					.addOption("3", "3 栏")
					.addOption("4", "4 栏")
					.setValue(String(this.plugin.settings.defaultColumns))
					.onChange(async (v) => {
						this.plugin.settings.defaultColumns = parseInt(v, 10) || 3;
						await this.plugin.saveSettings();
					})
			);

		new Setting(el)
			.setName("多图粘贴自动成栏")
			.setDesc("一次粘贴 / 拖入多张图片时，自动包成图片分栏网格")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoGridOnMultiPaste).onChange(async (v) => {
					this.plugin.settings.autoGridOnMultiPaste = v;
					await this.plugin.saveSettings();
				})
			);

		// 统一行高：预设档位（点一下即切换）+ 自定义数值
		const rowItem = new Setting(el)
			.setName("统一行高")
			.setDesc("0 = 自适应（每张图按自身比例）；大于 0 时所有图片等高裁切，更整齐（飞书风格）");
		const presetRow = rowItem.settingEl.createDiv({ cls: "fl-preset-row" });
		for (const [label, value] of [
			["自适应", 0],
			["300", 300],
			["400", 400],
			["500", 500],
		] as [string, number][]) {
			const chip = presetRow.createEl("button", { text: label, cls: "fl-chip" });
			chip.onclick = async () => {
				this.plugin.settings.gridRowHeight = value;
				await this.plugin.saveSettings();
				this.refresh();
			};
		}
		rowItem.addText((t) =>
			t
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.gridRowHeight))
				.onChange(async (v) => {
					this.plugin.settings.gridRowHeight = Math.max(0, parseInt(v, 10) || 0);
					await this.plugin.saveSettings();
				})
		);

		const gapItem = new Setting(el).setName("分栏间距").setDesc("图片之间的空隙（px）");
		gapItem.addSlider((s) =>
			s
				.setLimits(0, 40, 1)
				.setValue(this.plugin.settings.gridGap)
				.onChange(async (v) => {
					this.plugin.settings.gridGap = v;
					gapItem.controlEl.querySelector<HTMLElement>(".fl-slider-val")?.setText(`${v} px`);
					await this.plugin.saveSettings();
				})
		);
		gapItem.controlEl.createSpan({ cls: "fl-slider-val", text: `${this.plugin.settings.gridGap} px` });

		const radiusItem = new Setting(el).setName("圆角").setDesc("图片圆角半径（px）");
		radiusItem.addSlider((s) =>
			s
				.setLimits(0, 40, 1)
				.setValue(this.plugin.settings.gridRadius)
				.onChange(async (v) => {
					this.plugin.settings.gridRadius = v;
					radiusItem.controlEl.querySelector<HTMLElement>(".fl-slider-val")?.setText(`${v} px`);
					await this.plugin.saveSettings();
				})
		);
		radiusItem.controlEl.createSpan({ cls: "fl-slider-val", text: `${this.plugin.settings.gridRadius} px` });

		el.createEl("p", { text: "效果预览（随上方数值实时变化）", cls: "setting-item-description fl-preview-cap" });
		const preview = el.createDiv({ cls: "fl-grid-preview" });
		preview.createDiv();
		preview.createDiv();
		preview.createDiv();

		new Setting(el)
			.setName("空分栏占位提示")
			.setDesc("未贴图的分栏显示虚线框和「把图片粘贴或拖进来」提示；关闭后空分栏显示为空白")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showEmptyGridHint).onChange(async (v) => {
					this.plugin.settings.showEmptyGridHint = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("编辑视图 · 图片行缩略图")
			.setDesc("编辑视图点到分栏块内部时，未在编辑的图片行显示小缩略图（不露文件名）；点到哪行哪行恢复原文")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.gridSourceThumbs).onChange(async (v) => {
					this.plugin.settings.gridSourceThumbs = v;
					await this.plugin.saveSettings();
				})
			);
	}

	// ---------------- 编辑 · 增强（炼化模块） ----------------

	private renderEditor(el: HTMLElement): void {
		new Setting(el)
			.setName("划词工具条")
			.setDesc("编辑视图划词显示工具条：单行支持高亮、行内代码和删除线，段落内跨行选区支持批注")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.selectToolbar).onChange(async (v) => {
					this.plugin.settings.selectToolbar = v;
					await this.plugin.saveSettings();
				})
			);

		el.createEl("p", {
			text: "以下为「炼化」自其它插件的核心能力：只要对应原插件仍在启用就自动让位（不重复接管）；停用原插件后由本插件无缝接手。",
			cls: "setting-item-description fl-preview-cap",
		});

		new Setting(el)
			.setName("表格增强")
			.setDesc("表格内 Tab / Shift+Tab / Enter 跳格，每次跳格自动对齐格式化；末格跳格自动补新行。原插件：Advanced Tables")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.tableAssist).onChange(async (v) => {
					this.plugin.settings.tableAssist = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("列表增强")
			.setDesc("Cmd+Shift+↑ / ↓ 整体移动列表项（含整棵子树，与相邻同级项换位）。原插件：Outliner")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.listAssist).onChange(async (v) => {
					this.plugin.settings.listAssist = v;
					await this.plugin.saveSettings();
				})
			);
	}

	// ---------------- 编辑 · 批注与图片工具 ----------------
	private renderAnnotations(el: HTMLElement): void {
		new Setting(el).setName("笔记批注").setDesc("选中文字后使用工具条留批注，桌面侧栏与手机底部面板查看线程；数据保存在笔记内").addToggle(t => t.setValue(this.plugin.settings.commentsEnabled).onChange(async value => { this.plugin.settings.commentsEnabled = value; await this.plugin.saveSettings(); this.plugin.comments.schedule(); }));
		new Setting(el).setName("批注署名").addText(t => t.setValue(this.plugin.settings.commentAuthor).onChange(async value => { this.plugin.settings.commentAuthor = value.trim() || "我"; await this.plugin.saveSettings(); }));
		new Setting(el).setName("图片工具条").setDesc("点击图片调整宽度、图注、分栏和顺序，或打开裁剪与标注；原图保留，编辑生成新图片").addToggle(t => t.setValue(this.plugin.settings.imageTools).onChange(async value => { this.plugin.settings.imageTools = value; await this.plugin.saveSettings(); this.plugin.imageTools.closeToolbar(); }));
	}

	// ---------------- 编辑 · 文本高亮 ----------------

	private renderHighlight(el: HTMLElement): void {
		new Setting(el)
			.setName("编辑视图渲染")
			.setDesc("在 Live Preview 中渲染 =={颜色}文字== 语法（关闭则仅阅读视图渲染；改动重开笔记后完全生效）")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.lpHighlight).onChange(async (v) => {
					this.plugin.settings.lpHighlight = v;
					await this.plugin.saveSettings();
				})
			);

		const colorItem = new Setting(el)
			.setName("自定义颜色")
			.setDesc("点色块调整配色（半透明底色、深浅主题共用）；「全部恢复默认」还原内置 7 色");
		colorItem.addButton((b) =>
			b.setButtonText("全部恢复默认").onClick(async () => {
				this.plugin.settings.customHighlightColors = {};
				await this.plugin.saveSettings();
				this.refresh();
				new Notice("Feishu Lite：已恢复默认高亮配色");
			})
		);
		const colorGrid = colorItem.settingEl.createDiv({ cls: "fl-color-grid" });
		for (const c of HL_COLORS) {
			const cell = colorGrid.createDiv({ cls: "fl-color-cell" });
			const input = cell.createEl("input", { attr: { type: "color" }, cls: "fl-color-input" });
			input.value =
				this.plugin.settings.customHighlightColors?.[c.value] ?? HL_DEFAULT_HEX[c.value] ?? "#888888";
			input.oninput = async () => {
				this.plugin.settings.customHighlightColors[c.value] = input.value;
				await this.plugin.saveSettings();
			};
			cell.createDiv({ cls: "fl-color-label", text: c.label });
		}
	}

	// ---------------- 阅读 · 美化与导航（美化 / 浮动目录 / 阅读与写作） ----------------

	private renderReading(el: HTMLElement): void {
		el.createEl("p", {
			text: "以下美化只作用于阅读视图（不影响编辑视图与他人共享的 Markdown 源文件）。",
			cls: "setting-item-description fl-preview-cap",
		});

		new Setting(el)
			.setName("代码块美化")
			.setDesc("代码块右上角加语言徽标 + 「复制」按钮；4 行以上的自动显示行号（关掉后重开笔记完全生效）")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.codePretty).onChange(async (v) => {
					this.plugin.settings.codePretty = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("表格斑马纹")
			.setDesc("表格隔行浅色底 + 鼠标悬停整行高亮；列对齐用命令「表格：切换列对齐（左/中/右）」")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.tablePretty).onChange(async (v) => {
					this.plugin.settings.tablePretty = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("图片查看器")
			.setDesc("点击图片 → 悬浮查看：滚轮缩放、拖拽平移、Esc / 点击空白关闭（阅读 / 编辑视图均可；视频 / 画布不受影响）")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.imageLightbox).onChange(async (v) => {
					this.plugin.settings.imageLightbox = v;
					await this.plugin.saveSettings();
				})
			);

		el.createDiv({ cls: "fl-subtitle", text: "浮动目录" });
		el.createEl("p", {
			text: "Feishu 式右侧悬浮大纲：滚动时自动高亮所在章节、点击条目跳转；只跟随当前激活的笔记。",
			cls: "setting-item-description fl-preview-cap",
		});

		new Setting(el)
			.setName("显示浮动目录")
			.setDesc("命令「视图：显示 / 展开浮动目录」可随时唤出（建议绑快捷键）；面板默认收成右缘窄轨不遮正文，鼠标悬停自动展开；右上角「»」或本开关整体关闭。状态会记住")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.tocVisible).onChange(async (v) => {
					this.plugin.settings.tocVisible = v;
					await this.plugin.saveSettings();
					if (v) showTocPanel(this.plugin);
					else syncToc(this.plugin);
				})
			);

		el.createDiv({ cls: "fl-subtitle", text: "阅读与写作" });

		new Setting(el)
			.setName("记住阅读位置")
			.setDesc("按笔记记住上次读到的位置，重开自动回到原位（只在阅读视图恢复；编辑视图的光标位置由 Obsidian 原生恢复）")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.rememberScroll).onChange(async (v) => {
					this.plugin.settings.rememberScroll = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(el)
			.setName("粘贴时自动美化中英混排")
			.setDesc("粘贴文本时自动在中文与英文 / 数字间补一个空格（代码块、链接、公式内不处理）；命令「格式：中英混排美化（加空格）」可随时手动执行")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.cjkPaste).onChange(async (v) => {
					this.plugin.settings.cjkPaste = v;
					await this.plugin.saveSettings();
				})
			);
	}

	// ---------------- 图片 · 图库与附件清理 ----------------

	private renderTools(el: HTMLElement): void {
		const folder = attachmentFolder(this.app);
		new Setting(el)
			.setName("搜索范围")
			.setDesc("图库弹窗（斜杠 /tp 或命令「从图库多选插入」）里显示哪些图片")
			.addDropdown((d) =>
				d
					.addOption("all", "全部图片")
					.addOption("attachments", folder ? `仅附件目录（${folder}）` : "仅附件目录")
					.setValue(this.plugin.settings.pickerScope)
					.onChange(async (v) => {
						this.plugin.settings.pickerScope = v === "attachments" ? "attachments" : "all";
						await this.plugin.saveSettings();
					})
			);

		new Setting(el)
			.setName("排序")
			.setDesc("图库弹窗里图片的排列顺序")
			.addDropdown((d) =>
				d
					.addOption("newest", "最新优先")
					.addOption("oldest", "最旧优先")
					.addOption("name", "文件名 A→Z")
					.setValue(this.plugin.settings.pickerSort)
					.onChange(async (v) => {
						this.plugin.settings.pickerSort =
							v === "oldest" || v === "name" ? v : "newest";
						await this.plugin.saveSettings();
					})
			);

		el.createDiv({ cls: "fl-subtitle", text: "附件自动清理" });
		el.createEl("p", {
			text: "图床自动管家（全自动、无需管理）：启动后约 15 秒清理「全库无任何引用且超过 24 小时」的图片附件——只移入回收站（跟随 Obsidian「删除文件」设置），绝不直接抹除；此后每 24 小时复查一次。判定双保险：官方链接索引 + 全库文本兜底扫描。",
			cls: "setting-item-description fl-preview-cap",
		});

		new Setting(el)
			.setName("自动清理未引用附件")
			.setDesc("关闭后不再自动运行；命令「维护：清理未引用附件」仍可手动执行")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoCleanAttachments).onChange(async (v) => {
					this.plugin.settings.autoCleanAttachments = v;
					await this.plugin.saveSettings();
				})
			);
	}

	// ---------------- 维护 · 恢复默认 ----------------

	private renderReset(el: HTMLElement): void {
		const item = new Setting(el)
			.setName("恢复默认设置")
			.setDesc("需要连点两次确认，防止误触");
		item.addButton((b) => {
			let armed = false;
			let timer: number | null = null;
			if (requireApiVersion("1.13.0")) b.setDestructive();
			b.setButtonText("恢复默认").onClick(async () => {
				if (!armed) {
					armed = true;
					b.setButtonText("再点一次确认");
					timer = window.setTimeout(() => {
						armed = false;
						b.setButtonText("恢复默认");
					}, 4000);
					return;
				}
				if (timer !== null) window.clearTimeout(timer);
				Object.assign(this.plugin.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as FlSettings);
				clearReadPositions(); // 阅读位置表已换新引用：模块内 map 同步清空，防止旧记录被写回
				await this.plugin.saveSettings();
				syncToc(this.plugin); // 浮动目录可见性可能变化：立即生效
				this.refresh();
				new Notice("Feishu Lite：已恢复默认设置");
			});
		});
	}
}
