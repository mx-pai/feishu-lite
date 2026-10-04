import { MarkdownView } from "obsidian";
import type { TFile } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 阅读位置记忆：按笔记记住「视口顶部行号」，重开时自动回到上次位置。
 * - 取/设位置都用 currentMode.getScroll()/applyScroll()：行号语义、阅读/编辑通用、
 *   不受阅读视图懒渲染影响（与浮动目录同一套机制）
 * - 只在阅读视图恢复：编辑视图的光标位置由 Obsidian 原生恢复，不抢
 * - 记录：滚动时实时进内存，1.2s 防抖落盘；切文件 / 退出时立即落盘
 */

const MAX_ENTRIES = 400;

let pluginRef: FeishuLitePlugin | null = null;
let map: Record<string, number> = {};
let boundView: MarkdownView | null = null;
let onScroll: (() => void) | null = null;
let flushTimer: number | null = null;

export function initReadPosition(plugin: FeishuLitePlugin): void {
	pluginRef = plugin;
	// 与设置共享同一引用（落盘即 saveData；注意防止引用到 DEFAULT_SETTINGS 的共享对象）
	map = { ...(plugin.settings.readPositions ?? {}) };
	plugin.settings.readPositions = map;

	plugin.registerEvent(
		plugin.app.workspace.on("file-open", (file) => {
			flush(0); // 切文件：把待写的位置立即落盘
			if (file) scheduleRestore(plugin, file);
		})
	);
	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => rebind(plugin)));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", () => rebind(plugin)));
	plugin.registerEvent(plugin.app.workspace.on("quit", () => flush(0)));

	// 停用 / 卸载插件：把待写位置立即落盘、解绑容器监听，避免残留监听继续记录写盘
	plugin.register(() => {
		flush(0);
		if (boundView && onScroll) boundView.containerEl.removeEventListener("scroll", onScroll, true);
		boundView = null;
		onScroll = null;
	});

	rebind(plugin);
}

/** 清空阅读位置记录（「恢复默认设置」调用）：同步换掉设置里的引用，防止旧记录被 flush 写回 */
export function clearReadPositions(): void {
	map = {};
	if (pluginRef) pluginRef.settings.readPositions = map;
}

// ---------------- 记录 ----------------

/** 绑定「当前 markdown 视图」容器上的捕获型 scroll 监听（焦点切到侧边栏时不解除） */
function rebind(plugin: FeishuLitePlugin): void {
	const picked = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	let view = picked ?? boundView;
	if (view && (!view.containerEl.isConnected || !view.file)) view = null;
	if (view === boundView) return;

	if (boundView && onScroll) boundView.containerEl.removeEventListener("scroll", onScroll, true);
	boundView = view;
	onScroll = view ? () => record(plugin) : null;
	if (view && onScroll) {
		view.containerEl.addEventListener("scroll", onScroll, { capture: true, passive: true });
	}
}

function record(plugin: FeishuLitePlugin): void {
	if (!plugin.settings.rememberScroll) return;
	const view = boundView;
	const file = view?.file;
	if (!view || !file || !view.containerEl.isConnected) return;
	const line = currentTopLine(view);
	if (line === null) return;
	if (map[file.path] === line) return;
	map[file.path] = line;
	prune();
	flush(); // 防抖落盘
}

/** 视口顶部行号；来源异常（非行号语义）时返回 null 弃用 */
function currentTopLine(view: MarkdownView): number | null {
	try {
		const v = view.currentMode.getScroll();
		if (typeof v !== "number" || !isFinite(v) || v < 0) return null;
		if (view.getMode() === "source") {
			const docLines = view.editor.lineCount();
			if (docLines && v > docLines + 50) return null;
		}
		return v;
	} catch {
		return null;
	}
}

function prune(): void {
	const keys = Object.keys(map);
	if (keys.length <= MAX_ENTRIES) return;
	for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
}

/** 落盘：delayMs 内再次调用会顺延（滚动中不写盘，停下来才写）；0 = 立即 */
function flush(delayMs = 1200): void {
	if (flushTimer !== null) window.clearTimeout(flushTimer);
	const write = (): void => {
		flushTimer = null;
		if (!pluginRef) return;
		pluginRef.settings.readPositions = map; // 以 map 为准（兼容「恢复默认设置」后引用变化）
		void pluginRef.saveSettings();
	};
	if (delayMs <= 0) {
		write();
		return;
	}
	flushTimer = window.setTimeout(write, delayMs);
}

// ---------------- 恢复 ----------------

function scheduleRestore(plugin: FeishuLitePlugin, file: TFile): void {
	if (!plugin.settings.rememberScroll) return;
	const target = map[file.path];
	if (!target || target <= 1) return;

	const tryOnce = (): boolean => {
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file || view.file.path !== file.path) return true;
		if (view.getMode() !== "preview") return true; // 编辑视图：光标位置交给 Obsidian 原生恢复
		const current = currentTopLine(view);
		if (current === null || current >= 2) return true; // 已在其它位置（原生恢复/用户已滚）→ 不抢
		try {
			view.currentMode.applyScroll(target);
		} catch {
			return true;
		}
		return false; // 再验证一次（长笔记懒渲染时首跳可能被校正）
	};

	// 等视图挂载渲染后再试；首次未生效则 220ms 后补一次
	window.requestAnimationFrame(() =>
		window.requestAnimationFrame(() => {
			if (tryOnce()) return;
			window.setTimeout(() => tryOnce(), 220);
		})
	);
}
