/**
 * 链接交互 —— 粘贴选择菜单 + 悬浮快捷转换条。
 *
 * 两个触发共用同一套转换动作（链接卡片 / 标题链接 / 普通链接）：
 * 1. 粘贴「单独一条纯文本链接」时弹菜单；Esc / 点空白关闭 = 普通链接（粘贴永不丢）
 * 2. 鼠标停在链接文字上时浮现小转换条（卡片 / 标题链接，点一下原地转换；仅桌面端有鼠标）
 *
 * 让位规则（与 image-paste / cjk-space 同口径）：
 * - 剪贴板带文件 → 图片粘贴模块接管；带 text/html（富文本复制）→ 让位 Obsidian 原生转 Markdown
 * - 内容不是「单独一条 http(s) 链接」→ 不处理；光标 / 悬浮行在代码块内 → 不处理
 * 双通道与 image-paste 同构：CM6 最高优先级（Prec.highest）+ workspace editor-paste 兜底。
 */
import { Menu, Notice, editorInfoField } from "obsidian";
import type { Editor, EditorPosition, MarkdownFileInfo, MarkdownView, MenuItem } from "obsidian";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type FeishuLitePlugin from "./main";
import { anchorRect } from "./cascade";
import { cursorInFence } from "./cjk-space";
import { escapeLinkText, findUrlAtInLine, normalizeUrlInput, positionAfterInsert } from "./link-card-core";
import { fetchLinkCardMeta, insertCardAt } from "./link-card";

export function registerLinkPaste(plugin: FeishuLitePlugin): void {
	// 通道一：workspace 兜底（CM6 通道未接管的场景）
	plugin.registerEvent(
		plugin.app.workspace.on("editor-paste", (evt, editor, info) => {
			if (evt.defaultPrevented) return; // 已被本插件 CM6 通道或其它插件处理
			const url = claimableUrlPaste(plugin, evt, editor);
			if (!url) return;
			evt.preventDefault();
			openPasteMenu(plugin, editor, info, url);
		})
	);
	// 通道二：CM6 最高优先级（抢在其它插件之前接管；与 image-paste 同构）
	plugin.registerEditorExtension(
		Prec.highest(
			EditorView.domEventHandlers({
				paste: (evt, view) => {
					try {
						if (evt.defaultPrevented) return false;
						const info = view.state.field(editorInfoField, false);
						const editor = info?.editor;
						if (!info || !editor) return false;
						const url = claimableUrlPaste(plugin, evt, editor);
						if (!url) return false;
						evt.preventDefault();
						evt.stopPropagation();
						openPasteMenu(plugin, editor, info, url);
						return true;
					} catch (err) {
						console.error("[feishu-lite] 链接粘贴接管失败，回退默认行为", err);
						return false;
					}
				},
			})
		)
	);

	// 悬浮快捷转换条（桌面端鼠标）
	plugin.registerEditorExtension(linkHoverExtension(plugin));
	plugin.register(() => hideHoverBar());
}

/* ================= 粘贴选择菜单 ================= */

/** 是否接管这次粘贴：开关开 + 剪贴板是「单独一条纯文本 http(s) 链接」+ 不在代码块内；是则返回规范化 URL */
function claimableUrlPaste(plugin: FeishuLitePlugin, evt: ClipboardEvent, editor: Editor): string | null {
	if (!plugin.settings.linkCard || !plugin.settings.linkPasteMenu) return null;
	const cd = evt.clipboardData;
	if (!cd) return null;
	if (cd.files && cd.files.length > 0) return null; // 文件粘贴交给图片模块
	if (Array.from(cd.types ?? []).includes("text/html")) return null; // 富文本让位 Obsidian 原生（转 Markdown 链接）
	const url = normalizeUrlInput(cd.getData("text/plain"));
	if (!url) return null;
	if (cursorInFence(editor)) return null; // 代码块内保持原样
	return url;
}

/** 菜单锚点：优先光标坐标；读不到时退回编辑器容器一角（个别视图拿不到光标坐标也不丢菜单） */
function menuAnchor(editor: Editor): { left: number; bottom: number } | null {
	const anchor = anchorRect(editor);
	if (anchor) return anchor;
	const cm = (editor as unknown as { cm?: { dom?: HTMLElement } }).cm;
	const rect = cm?.dom?.getBoundingClientRect?.();
	return rect ? { left: rect.left + 56, bottom: rect.top + 56 } : null;
}

/** 菜单项说明行（setSubtitle 在部分 API 版本不存在：探测调用，不报错） */
function menuHint(item: MenuItem, text: string): void {
	const set = (item as unknown as { setSubtitle?: (s: string) => unknown }).setSubtitle;
	if (typeof set !== "function") return;
	try {
		set.call(item, text);
	} catch {
		/* 老版本不吃说明行，忽略 */
	}
}

function runGuarded(task: () => Promise<void>): void {
	task().catch((e) => {
		console.error("[feishu-lite] 链接转换失败", e);
		new Notice(`链接卡片出错：${e instanceof Error ? e.message : String(e)}`);
	});
}

/** 弹「链接展示方式」菜单（应用内 DOM 菜单；关闭 = 普通链接，粘贴内容永不丢） */
function openPasteMenu(plugin: FeishuLitePlugin, editor: Editor, info: MarkdownView | MarkdownFileInfo, url: string): void {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	const insertPlain = (): void => {
		try {
			editor.replaceRange(url, from, to);
			editor.setCursor(positionAfterInsert(from, url));
		} catch (e) {
			console.error("[feishu-lite] 链接粘贴回退失败", e);
		}
	};

	const anchor = menuAnchor(editor);
	if (!anchor) {
		insertPlain(); // 拿不到锚点就退回普通链接，不弹菜单
		return;
	}

	let chosen = false;
	const run = (task: () => Promise<void>): void => {
		chosen = true;
		runGuarded(task);
	};

	const menu = new Menu();
	menu.setUseNativeMenu(false);
	menu.onHide(() => {
		if (!chosen) insertPlain(); // Esc / 点空白关闭 = 普通链接
	});
	menu.addItem((item) => {
		item.setTitle("链接卡片")
			.setIcon("link")
			.onClick(() => run(() => insertCardAt(plugin, editor, url, info.file?.path ?? "", from, to)));
		menuHint(item, "抓取标题 / 摘要 / 配图，写进这篇笔记（离线可看）");
	});
	menu.addItem((item) => {
		item.setTitle("标题链接")
			.setIcon("heading")
			.onClick(() => run(() => insertTitleLink(editor, url, from, to)));
		menuHint(item, "用网页标题做链接文字");
	});
	menu.addItem((item) => {
		item.setTitle("普通链接")
			.setIcon("text")
			.onClick(() => {
				chosen = true;
				insertPlain();
			});
		menuHint(item, "原样保留链接文本");
	});
	menu.showAtPosition({ x: anchor.left, y: anchor.bottom });
}

/** 标题链接：抓页面标题 → `[标题](url)`；抓不到就退回普通链接 */
async function insertTitleLink(editor: Editor, url: string, from: EditorPosition, to: EditorPosition): Promise<void> {
	const notice = new Notice("链接卡片：正在抓取页面标题…", 0);
	let title = "";
	try {
		title = (await fetchLinkCardMeta(url)).title ?? "";
	} catch {
		title = "";
	}
	notice.hide();
	if (!title) {
		new Notice("链接卡片：没抓到标题，已插入普通链接");
		editor.replaceRange(url, from, to);
		editor.setCursor(positionAfterInsert(from, url));
		return;
	}
	const link = `[${escapeLinkText(title)}](${url})`;
	editor.replaceRange(link, from, to);
	editor.setCursor(positionAfterInsert(from, link));
}

/* ================= 悬浮快捷转换条 ================= */

interface HoverState {
	el: HTMLElement;
	/** 同一链接的稳定键：只为它保留同一个悬浮条（换链接即重建） */
	key: string;
	url: string;
	from: EditorPosition;
	to: EditorPosition;
	editor: Editor;
	sourcePath: string;
}

let hoverBar: HoverState | null = null;
let hoverTimer: number | null = null;

function cancelHoverHide(): void {
	if (hoverTimer !== null) {
		window.clearTimeout(hoverTimer);
		hoverTimer = null;
	}
}

function scheduleHoverHide(): void {
	cancelHoverHide();
	hoverTimer = window.setTimeout(() => {
		hoverTimer = null;
		hideHoverBar();
	}, 220);
}

function hideHoverBar(): void {
	cancelHoverHide();
	if (hoverBar) {
		hoverBar.el.remove();
		hoverBar = null;
	}
}

/** 悬浮条永远贴着鼠标（视口内钳制，不越界） */
function moveHoverBar(evt: MouseEvent): void {
	if (!hoverBar) return;
	const w = hoverBar.el.offsetWidth || 150;
	const x = Math.max(8, Math.min(evt.clientX + 12, window.innerWidth - w - 8));
	const y = Math.max(8, Math.min(evt.clientY + 18, window.innerHeight - 40));
	hoverBar.el.style.left = `${x}px`;
	hoverBar.el.style.top = `${y}px`;
}

/** 编辑器悬浮处理：命中裸链接就浮现转换条，离开即收起（拖拽 / 选区 / 代码块内都不打扰） */
function linkHoverExtension(plugin: FeishuLitePlugin): Extension {
	return [
		EditorView.domEventHandlers({
			mousemove: (evt, view) => {
				try {
					hoverMove(plugin, evt, view);
				} catch (err) {
					console.error("[feishu-lite] 链接悬浮条失败", err);
					hideHoverBar();
				}
				return false;
			},
			mouseleave: () => {
				scheduleHoverHide();
				return false;
			},
		}),
		EditorView.updateListener.of((u) => {
			// 文档 / 选区一变就收起（保证 from / to 在点击时永远指向同一段文本）
			if (u.docChanged || u.selectionSet) hideHoverBar();
		}),
	];
}

function hoverMove(plugin: FeishuLitePlugin, evt: MouseEvent, view: EditorView): void {
	if (!plugin.settings.linkCard || !plugin.settings.linkHoverBar) {
		hideHoverBar();
		return;
	}
	cancelHoverHide();
	const target = evt.target as HTMLElement | null;
	if (target?.closest?.("[data-fl-ui]")) return; // 悬浮条自身：保持显示
	if (evt.buttons !== 0) {
		hideHoverBar(); // 拖拽选区时不打扰
		return;
	}
	if (!view.state.selection.main.empty) {
		scheduleHoverHide(); // 已有选区：让位划词工具条
		return;
	}
	const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
	if (pos == null) {
		scheduleHoverHide();
		return;
	}
	const line = view.state.doc.lineAt(pos);
	const found = findUrlAtInLine(line.text, pos - line.from);
	const info = view.state.field(editorInfoField, false);
	const editor = info?.editor;
	if (!found || !editor || cursorInFence(editor, line.number - 1)) {
		scheduleHoverHide();
		return;
	}
	showHoverBar(
		plugin,
		editor,
		info?.file?.path ?? "",
		found.url,
		{ line: line.number - 1, ch: found.start },
		{ line: line.number - 1, ch: found.end },
		evt
	);
}

function showHoverBar(
	plugin: FeishuLitePlugin,
	editor: Editor,
	sourcePath: string,
	url: string,
	from: EditorPosition,
	to: EditorPosition,
	evt: MouseEvent
): void {
	const key = `${sourcePath}:${from.line}:${from.ch}:${url}`;
	if (hoverBar && hoverBar.key === key) {
		moveHoverBar(evt);
		return;
	}
	hideHoverBar();

	const el = document.createElement("div");
	el.addClass("fl-linkhover");
	el.setAttr("data-fl-ui", "1");
	const mk = (label: string, act: string): void => {
		const btn = el.createSpan({ cls: "fl-linkhover-btn", text: label });
		btn.setAttr("data-act", act);
		btn.setAttr("aria-label", act === "card" ? "转换为链接卡片" : "转换为标题链接");
	};
	mk("卡片", "card");
	mk("标题链接", "title");
	el.addEventListener("mouseenter", cancelHoverHide);
	el.addEventListener("mouseleave", scheduleHoverHide);
	el.addEventListener("mousedown", (e) => e.preventDefault()); // 不抢编辑器焦点、不改变选区
	el.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(".fl-linkhover-btn");
		const act = btn?.getAttribute("data-act");
		const st = hoverBar;
		if (!act || !st) return;
		e.preventDefault();
		e.stopPropagation();
		hideHoverBar();
		if (act === "card") runGuarded(() => insertCardAt(plugin, st.editor, st.url, st.sourcePath, st.from, st.to));
		else if (act === "title") runGuarded(() => insertTitleLink(st.editor, st.url, st.from, st.to));
	});
	document.body.appendChild(el);
	hoverBar = { el, key, url, from, to, editor, sourcePath };
	moveHoverBar(evt);
}
