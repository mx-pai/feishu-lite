import { MarkdownView, Modal, Plugin } from "obsidian";
import type { App } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { FlSettingTab, applyCssVars, normalizeSettings } from "./settings";
import type { FlSettings } from "./settings";
import { SlashSuggest } from "./slash";
import { closeCascade } from "./cascade";
import { registerImagePaste } from "./image-paste";
import { imageGridPostProcessor, insertGridSkeleton, openImagePicker, unwrapGrid, wrapSelectionIntoGrid } from "./image-grid";
import { highlightPostProcessor, highlightViewPlugin, pickColorAndHighlight } from "./highlight";
import { colPostProcessor } from "./column";
import { codePrettyPostProcessor } from "./code-pretty";
import { lightboxEditorExtension, registerLightbox } from "./lightbox";
import { initToc, showTocPanel, toggleTocPanel } from "./toc";
import { gridSourcePlugin } from "./grid-source";
import { cycleColumnAlign, editTableAtCursor, formatTableAtCursor, tableEnhanceExtension } from "./table-enhance";
import { listEnhanceExtension } from "./list-enhance";
import { formatCjkSpacing, registerCjkPaste } from "./cjk-space";
import { initReadPosition } from "./read-position";
import { selectToolbarExtension } from "./select-toolbar";
import { insertMermaid } from "./mermaid-snippets";
import { registerCleaner } from "./attachment-clean";
import { updateIndexPage } from "./index-page";
import {
	insertCallout,
	insertCodeBlock,
	insertDivider,
	insertQuote,
	insertTodo,
	openDatePicker,
} from "./slash-items";
import { closeTablePicker, openTablePicker } from "./table-picker";
import { CommentsController } from "./comments";
import { ImageToolsController } from "./image-tools";
import { adaptFlSlashItem, validateFlSlashItem } from "./slash-ext";
import type { FlSlashItem } from "./slash-ext";
import { adaptFlSelectionAction, validateFlSelectionAction } from "./selection-ext";
import type { FlSelectionAction, SelectionAction } from "./selection-ext";
import type { SlashItem } from "./slash-items";

/** 二选一确认弹窗（不可撤销操作二次确认用，如「永久删除」模式下的附件清理） */
class ConfirmActionModal extends Modal {
	private confirmed = false;
	constructor(app: App, private title: string, private message: string, private done: (ok: boolean) => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createEl("p", { text: this.message });
		const footer = this.contentEl.createDiv({ cls: "fl-dialog-actions" });
		const cancel = footer.createEl("button", { text: "取消" });
		cancel.onclick = () => this.close();
		const ok = footer.createEl("button", { text: "确认", cls: "mod-warning" });
		ok.onclick = () => {
			this.confirmed = true;
			this.close();
		};
	}
	onClose(): void {
		this.contentEl.empty();
		this.done(this.confirmed); // 关闭回调只走一次（取消 / 直接关闭都算不确认）
	}
}

export default class FeishuLitePlugin extends Plugin {
	settings!: FlSettings;
	comments!: CommentsController;
	imageTools!: ImageToolsController;

	/** 第三方插件注册的斜杠菜单项（公开扩展点：`slashMenu.register`；与内置项一起参与 `/` 匹配） */
	readonly externalSlashItems: SlashItem[] = [];

	/** 斜杠菜单扩展 API（外部插件：`app.plugins.plugins["feishu-lite"].slashMenu.register(item)`，返回注销函数） */
	readonly slashMenu = {
		register: (item: FlSlashItem): (() => void) => this.registerSlashItem(item),
	};

	/** 注册外部斜杠项：校验不过抛错；同 id 重复注册 = 覆盖；返回注销函数 */
	registerSlashItem(item: FlSlashItem): () => void {
		const err = validateFlSlashItem(item);
		if (err) throw new Error(`[feishu-lite] 斜杠项注册失败：${err}`);
		const adapted = adaptFlSlashItem(item);
		const prev = this.externalSlashItems.findIndex((it) => it.id === adapted.id);
		if (prev >= 0) this.externalSlashItems.splice(prev, 1, adapted);
		else this.externalSlashItems.push(adapted);
		return () => {
			const i = this.externalSlashItems.indexOf(adapted);
			if (i >= 0) this.externalSlashItems.splice(i, 1);
		};
	}

	/** 第三方插件注册的划词动作（公开扩展点：`selectionActions.register`；编辑器划词工具条 + 阅读批注条共用） */
	readonly externalSelectionActions: SelectionAction[] = [];

	/** 划词动作扩展 API（外部插件：`app.plugins.plugins["feishu-lite"].selectionActions.register(item)`，返回注销函数） */
	readonly selectionActions = {
		register: (item: FlSelectionAction): (() => void) => this.registerSelectionAction(item),
	};

	/** 注册外部划词动作：校验不过抛错；同 id 重复注册 = 覆盖；返回注销函数 */
	registerSelectionAction(item: FlSelectionAction): () => void {
		const err = validateFlSelectionAction(item);
		if (err) throw new Error(`[feishu-lite] 划词动作注册失败：${err}`);
		const adapted = adaptFlSelectionAction(item);
		const prev = this.externalSelectionActions.findIndex((it) => it.id === adapted.id);
		if (prev >= 0) this.externalSelectionActions.splice(prev, 1, adapted);
		else this.externalSelectionActions.push(adapted);
		return () => {
			const i = this.externalSelectionActions.indexOf(adapted);
			if (i >= 0) this.externalSelectionActions.splice(i, 1);
		};
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		applyCssVars(this.settings);

		this.addSettingTab(new FlSettingTab(this.app, this));
		this.comments = new CommentsController(this);
		this.imageTools = new ImageToolsController(this);

		// 斜杠菜单（行首 / 唤起）
		this.registerEditorSuggest(new SlashSuggest(this));

		// 图片粘贴 / 拖入接管
		registerImagePaste(this);

		// 彩色高亮渲染（阅读视图 + 编辑视图）
		this.registerMarkdownPostProcessor(highlightPostProcessor);
		this.registerEditorExtension(highlightViewPlugin(this));

		// 文字分栏（> [!col-N]）：阅读视图把 --- 分隔的内容拆成并排的栏
		this.registerMarkdownPostProcessor(colPostProcessor);

		// 阅读视图美化：代码块语言徽标 / 一键复制 / 行号
		this.registerMarkdownPostProcessor((el, ctx) => codePrettyPostProcessor(el, ctx, this));

		// 图片查看器：阅读视图点击图片 → 悬浮灯箱（滚轮缩放 / 拖拽平移 / Esc 关闭）
		registerLightbox(this);

		// 编辑视图（Live Preview）：点击渲染出的图片同样悬浮查看
		this.registerEditorExtension(lightboxEditorExtension(this));

		// 编辑视图：分栏源码态下用缩略图代替文件名文字
		this.registerEditorExtension(gridSourcePlugin(this));

		// 图片分栏：共享网格布局 + 异步嵌入的空状态同步
		this.registerMarkdownPostProcessor(imageGridPostProcessor);

		// 表格增强：Tab/Shift+Tab/Enter 跳格 + 自动对齐（Advanced Tables 启用时自动让位）
		this.registerEditorExtension(tableEnhanceExtension(this));

		// 列表增强：Cmd+Shift+↑/↓ 整棵子树移动（Outliner 启用时自动让位）
		this.registerEditorExtension(listEnhanceExtension(this));

		// 划词工具条：选中单行文字浮现（高亮换色 / 行内代码）
		this.registerEditorExtension(selectToolbarExtension(this));

		// 浮动目录（Feishu 式右侧悬浮大纲，数据源为 metadataCache）
		initToc(this);

		// 中英混排：粘贴时自动补空格（设置项开关）+ 命令手动执行
		registerCjkPaste(this);

		// 阅读位置记忆：重开笔记回到上次读到的位置（阅读视图）
		initReadPosition(this);

		// 图片附件自动清理（图床管家）：启动 + 每 24h 扫一遍无引用旧图
		registerCleaner(this);

		// 停用 / 卸载时收起可能开着的浮层（级联菜单 / 表格选择器）
		this.register(() => {
			closeCascade();
			closeTablePicker();
		});

		this.registerCommands();
	}

	private registerCommands(): void {
		this.addCommand({ id: "insert-callout", name: "插入：高亮块", editorCallback: (e) => insertCallout(this, e, false) });
		this.addCommand({ id: "insert-fold", name: "插入：折叠高亮块", editorCallback: (e) => insertCallout(this, e, true) });
		this.addCommand({ id: "insert-code", name: "插入：代码块", editorCallback: (e) => insertCodeBlock(this, e) });
		this.addCommand({ id: "insert-todo", name: "插入：待办", editorCallback: (e) => insertTodo(e) });
		this.addCommand({ id: "insert-quote", name: "插入：引用", editorCallback: (e) => insertQuote(e) });
		this.addCommand({ id: "insert-divider", name: "插入：分割线", editorCallback: (e) => insertDivider(e) });
		this.addCommand({ id: "insert-table", name: "插入：表格", editorCallback: (e) => openTablePicker(e) });
		this.addCommand({ id: "insert-date", name: "插入：日期", editorCallback: (e) => openDatePicker(e) });
		this.addCommand({ id: "insert-image-grid", name: "图片：插入分栏网格", editorCallback: (e) => insertGridSkeleton(this, e) });
		this.addCommand({
			id: "pick-images",
			name: "图片：从图库多选插入",
			editorCallback: (e, ctx) => openImagePicker(this, e, ctx.file?.path ?? ""),
		});
		this.addCommand({ id: "wrap-image-grid", name: "图片：选中包成多栏", editorCallback: (e) => wrapSelectionIntoGrid(this, e) });
		this.addCommand({ id: "unwrap-image-grid", name: "图片：取消分栏", editorCallback: (e) => unwrapGrid(this, e) });
		this.addCommand({ id: "color-highlight", name: "格式：高亮", editorCallback: (e) => pickColorAndHighlight(this, e) });
		this.addCommand({ id: "cjk-spacing", name: "格式：中英混排美化（加空格）", editorCallback: (e) => formatCjkSpacing(e) });
		this.addCommand({ id: "insert-mermaid", name: "插入：Mermaid 图", editorCallback: (e) => insertMermaid(this, e) });
		this.addCommand({ id: "format-table", name: "表格：格式化当前表格", editorCallback: (e) => formatTableAtCursor(e) });
		this.addCommand({
			id: "cycle-col-align",
			name: "表格：切换列对齐（左/中/右）",
			editorCallback: (e) => cycleColumnAlign(e),
		});
		this.addCommand({ id: "table-row-above", name: "表格：向上插入行", editorCallback: (e) => editTableAtCursor(e, "rowAbove") });
		this.addCommand({ id: "table-row-below", name: "表格：向下插入行", editorCallback: (e) => editTableAtCursor(e, "rowBelow") });
		this.addCommand({ id: "table-col-left", name: "表格：向左插入列", editorCallback: (e) => editTableAtCursor(e, "colLeft") });
		this.addCommand({ id: "table-col-right", name: "表格：向右插入列", editorCallback: (e) => editTableAtCursor(e, "colRight") });
		this.addCommand({ id: "table-row-delete", name: "表格：删除当前行", editorCallback: (e) => editTableAtCursor(e, "rowDelete") });
		this.addCommand({ id: "table-col-delete", name: "表格：删除当前列", editorCallback: (e) => editTableAtCursor(e, "colDelete") });
		this.addCommand({
			id: "update-index-page",
			name: "目录：自动补全当前目录页",
			editorCallback: (e, ctx) => updateIndexPage(this, e, ctx.file?.path ?? ""),
		});
		this.addCommand({
			id: "toggle-toc",
			name: "视图：显示 / 展开浮动目录",
			callback: async () => {
				// 关闭 → 开启并直接展开；已开启 → 只切换展开 / 窄轨，不会整体隐藏
				// （整体关闭走设置页开关；面板「»」只收窄轨，避免误触把浮层整个关掉）
				if (!this.settings.tocVisible) {
					this.settings.tocVisible = true;
					await this.saveSettings();
					showTocPanel(this);
				} else {
					toggleTocPanel(this);
				}
			},
		});
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<FlSettings> | null;
		this.settings = normalizeSettings(data);
	}

	/** 只落盘、不触发任何重渲染：高频路径（阅读位置滚动落盘 / 取色器拖动）走这里 */
	async persistSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 落盘 + 立即重渲染（注入 CSS 变量 + 让编辑器重画）：需要即时反映到界面的设置项走这里 */
	async saveSettings(): Promise<void> {
		await this.persistSettings();
		applyCssVars(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
			if (cm && !cm.composing) cm.dispatch({ selection: cm.state.selection });
		}
	}

	/** 不可撤销操作（如「永久删除」模式下的附件清理）的二次确认；返回用户是否确认 */
	confirmAction(title: string, message: string): Promise<boolean> {
		return new Promise((resolve) => new ConfirmActionModal(this.app, title, message, resolve).open());
	}
}
