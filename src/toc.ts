import { MarkdownView, TFile } from "obsidian";
import type { HeadingCache } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 浮动目录（Feishu 式）：当前笔记右侧悬浮大纲卡片。
 *
 * 性能设计（显隐 / 性能两条线）：
 * - 数据源 = metadataCache.getFileCache().headings —— Obsidian 自己维护的增量缓存，本插件零解析
 * - 列表按「标题签名」去重重建：打字时 metadataCache 频繁触发，签名没变就完全不动 DOM
 * - 滚动跟随：仅面板可见时挂 1 个捕获型 scroll 监听（rAF 节流）；用 currentMode.getScroll()
 *   取「视口顶部行号」再二分查找 —— 阅读视图对长笔记是懒渲染（只渲染视口附近区块），
 *   数已渲染的标题 DOM 会整体错位，取行号则完全不受影响；
 *   只有「当前章节」变化才改一次 DOM，其余滚动帧零写入
 * - 隐藏时：面板 DOM、滚动监听全部拆除 —— 零监听、零观察器、零开销
 * - 点击跳转用 currentMode.applyScroll(line)：阅读 / 编辑视图通用（Obsidian 双视图同步同款 API，
 *   且对未渲染的远处标题也能精确定位）；跳转后高亮「钉」在点击项上，用户真正滚动才交还跟随
 *   —— 文档滚到底、目标标题顶不到最上时，点击也有明确反馈
 * - 收起态 = 右缘窄轨（每条标题一根小横杠、当前章节点亮）：常驻也不遮正文；
 *   悬停 150ms 展开成完整卡片（延时避免鼠标路过误触），鼠标移开自动收起
 */

interface CmLike {
	posAtCoords?: (coords: { x: number; y: number }) => number | null;
	state?: { doc: { lineAt: (pos: number) => { number: number } } };
}

interface TocState {
	plugin: FeishuLitePlugin;
	view: MarkdownView | null;
	panel: HTMLElement | null;
	listEl: HTMLElement | null;
	headings: HeadingCache[];
	minLevel: number;
	/** 标题签名：level:line:text 连接串，没变就不重建列表 */
	sig: string;
	activeIdx: number;
	/** 点击跳转后「钉住」的条目：落位期间不许滚动跟随抢走高亮；用户真正滚动时解除 */
	pinnedIdx: number;
	/** 钉住后首次采样到的顶部行号；null = 还没采样 */
	pinnedTop: number | null;
	items: HTMLElement[];
	scrollBound: HTMLElement | null;
	onScroll: (() => void) | null;
	rafPending: boolean;
	/** 悬停展开的延时器（收起态悬停 150ms 才展开） */
	hoverTimer: number | null;
}

let state: TocState | null = null;

export function initToc(plugin: FeishuLitePlugin): void {
	if (state) return;
	state = {
		plugin,
		view: null,
		panel: null,
		listEl: null,
		headings: [],
		minLevel: 6,
		sig: "",
		activeIdx: -1,
		pinnedIdx: -1,
		pinnedTop: null,
		items: [],
		scrollBound: null,
		onScroll: null,
		rafPending: false,
		hoverTimer: null,
	};

	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => syncToc(plugin)));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", () => syncToc(plugin)));
	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", (file: TFile) => {
			const view = state?.view;
			if (view?.file && file.path === view.file.path) syncToc(plugin);
		})
	);

	// 停用 / 卸载插件时拆掉面板与滚动监听。否则残留的 .fl-toc DOM 会在样式表
	// 被撤销后以裸列表的形态出现在正文下方（state 置空，重新启用时干净初始化）
	plugin.register(() => {
		teardown();
		state = null;
	});

	syncToc(plugin);
}

/** 按当前设置 / 激活笔记，显示、刷新或拆除浮动目录（幂等，可高频调用） */
export function syncToc(plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st) return;
	// 记住「最近一个 markdown 视图」：焦点切到侧边栏（文件树等）时面板不应消失
	const picked = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	let view = picked ?? st.view;
	if (view && (!view.containerEl.isConnected || !view.file)) view = null;
	if (!plugin.settings.tocVisible || !view) {
		teardown();
		return;
	}
	if (st.view !== view) {
		teardown();
		st.view = view;
	}
	ensurePanel(plugin);
	refreshHeadings(plugin);
	bindTracking(plugin);
}

/** 显式开启（命令 / 设置页开关）时调用：确保面板可见并直接展开，给出明确反馈。
 *  鼠标不在面板上时展开态会保持，直到下一次「悬停后移开」再回到常态收起 */
export function showTocPanel(plugin: FeishuLitePlugin): void {
	syncToc(plugin);
	setPanelOpen(true);
}

/** 已开启状态下调用：在「展开卡片 ↔ 收起窄轨」间切换，永不整体隐藏（专题：避免热键误关浮层） */
export function toggleTocPanel(plugin: FeishuLitePlugin): void {
	syncToc(plugin);
	const panel = state?.panel;
	if (!panel) return;
	setPanelOpen(!panel.hasClass("is-open"));
}

function setPanelOpen(open: boolean): void {
	const st = state;
	if (!st?.panel) return;
	if (st.hoverTimer !== null) {
		window.clearTimeout(st.hoverTimer);
		st.hoverTimer = null;
	}
	st.panel.toggleClass("is-open", open);
}

// ---------------- 面板 DOM ----------------

function ensurePanel(plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st || !st.view || st.panel) return;
	// 保险：清掉历史版本泄漏的残留面板（旧版卸载时未清理的 DOM），避免出现两个目录
	st.view.containerEl.querySelectorAll(":scope > .fl-toc").forEach((el) => el.remove());
	const panel = st.view.containerEl.createDiv({ cls: "fl-toc" });

	const head = panel.createDiv({ cls: "fl-toc-head" });
	head.addEventListener("mousedown", (ev) => ev.preventDefault()); // 点标题栏不抢编辑焦点
	head.createSpan({ cls: "fl-toc-title", text: "目录" });
	// 收起按钮固定在标题栏右端，箭头朝右（面板贴屏幕右缘，「收起」= 向右收）
	const hideBtn = head.createEl("button", { cls: "fl-toc-hide", text: "»" });
	hideBtn.setAttribute("aria-label", "收起目录");
	hideBtn.onclick = async (ev) => {
		ev.stopPropagation();
		plugin.settings.tocVisible = false;
		await plugin.saveSettings();
		syncToc(plugin);
	};

	const listEl = panel.createDiv({ cls: "fl-toc-list" });
	// 点条目时保住编辑焦点；列表空白/滚动条不拦截（同级联菜单的做法）
	listEl.addEventListener("mousedown", (ev) => {
		const target = ev.target as HTMLElement;
		if (target.closest(".fl-toc-item")) ev.preventDefault();
	});
	listEl.addEventListener("click", (ev) => {
		const item = (ev.target as HTMLElement).closest<HTMLElement>(".fl-toc-item");
		if (!item) return;
		jumpTo(parseInt(item.dataset.idx ?? "", 10));
	});

	// 收起态 = 右缘一条窄轨；悬停一小会儿（150ms）再展开，避免鼠标路过误触发
	panel.addEventListener("mouseenter", () => {
		if (st.hoverTimer !== null) window.clearTimeout(st.hoverTimer);
		st.hoverTimer = window.setTimeout(() => {
			st.hoverTimer = null;
			panel.addClass("is-open");
		}, 150);
	});
	panel.addEventListener("mouseleave", () => {
		if (st.hoverTimer !== null) {
			window.clearTimeout(st.hoverTimer);
			st.hoverTimer = null;
		}
		panel.removeClass("is-open");
	});

	st.panel = panel;
	st.listEl = listEl;
}

function teardown(): void {
	const st = state;
	if (!st) return;
	if (st.scrollBound && st.onScroll) {
		st.scrollBound.removeEventListener("scroll", st.onScroll, true);
	}
	if (st.hoverTimer !== null) {
		window.clearTimeout(st.hoverTimer);
		st.hoverTimer = null;
	}
	st.panel?.remove();
	st.view = null;
	st.panel = null;
	st.listEl = null;
	st.headings = [];
	st.minLevel = 6;
	st.sig = "";
	st.activeIdx = -1;
	st.pinnedIdx = -1;
	st.pinnedTop = null;
	st.items = [];
	st.scrollBound = null;
	st.onScroll = null;
}

// ---------------- 标题列表 ----------------

function refreshHeadings(plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st?.listEl || !st.view?.file) return;
	const headings = plugin.app.metadataCache.getFileCache(st.view.file)?.headings ?? [];
	// 注意：空列表也要给出可区分的签名，否则无标题笔记会因 "" === 初始 sig 而跳过渲染
	const sig = headings.length
		? headings.map((h) => `${h.level}:${h.position.start.line}:${h.heading}`).join("|")
		: "(empty)";
	if (sig === st.sig) return; // 标题没变：不重建（打字时 metadataCache 高频触发也几乎零成本）
	st.sig = sig;
	st.headings = headings;
	st.minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 6;
	st.items = [];
	st.activeIdx = -1;
	st.pinnedIdx = -1;
	st.pinnedTop = null;

	st.listEl.empty();
	if (!headings.length) {
		st.listEl.createDiv({ cls: "fl-toc-empty", text: "（本篇没有标题）" });
		return;
	}
	for (let i = 0; i < headings.length; i++) {
		const h = headings[i];
		if (!h) continue;
		const item = st.listEl.createDiv({ cls: "fl-toc-item" });
		item.dataset.idx = String(i);
		item.style.setProperty("--fl-item-indent", `${(h.level - st.minLevel) * 12}px`);
		const text = cleanHeading(h.heading) || "（无标题）";
		item.setText(text);
		item.setAttribute("title", text);
		st.items.push(item);
	}
	scheduleUpdate();
}

/** 标题文本去掉常见行内标记，只留纯文字 */
function cleanHeading(raw: string): string {
	return raw
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2") // [[链接|别名]] → 别名
		.replace(/[*_`~]/g, "")
		.replace(/==\{?[a-z]*\}?/g, "")
		.trim();
}

// ---------------- 滚动跟随 ----------------

function bindTracking(_plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st?.view || !st.panel) return;
	const container = st.view.containerEl;

	if (st.scrollBound !== container) {
		if (st.scrollBound && st.onScroll) st.scrollBound.removeEventListener("scroll", st.onScroll, true);
		st.onScroll = () => scheduleUpdate();
		// 捕获型：CM 编辑区 / 阅读视图的滚动容器都在 container 内部，一个监听全兜住
		container.addEventListener("scroll", st.onScroll, { capture: true, passive: true });
		st.scrollBound = container;
	}

	scheduleUpdate();
}

function scheduleUpdate(): void {
	const st = state;
	if (!st || st.rafPending) return;
	st.rafPending = true;
	window.requestAnimationFrame(() => {
		if (!state) return;
		state.rafPending = false;
		updateActive();
	});
}

function updateActive(): void {
	const st = state;
	if (!st?.view || !st.panel || !st.headings.length) return;
	const line = lineFromGetScroll(st) ?? lineFromPosAtCoords(st);
	if (line === null) return;
	if (st.pinnedIdx >= 0 && applyPinned(st, line)) return;
	setActive(lastAtOrBefore(st.headings, line));
}

/**
 * 点击跳转后的「钉住」判定：返回 true = 本轮高亮仍归点击项。
 *
 * 背景：点击靠文档末尾的标题时，可能已经滚到底 —— 目标标题顶不到视口顶部，
 * 此时若按「视口顶部行号」反推章节，高亮会弹回上一节，看起来像"点了没反应"。
 * 规则：① 顶部行号未变 → 保持钉住（含滚不动的场景）；
 * ② 顶部行号在朝目标靠近（平滑滚动途中）→ 继续钉住；
 * ③ 朝远离目标方向移动 → 是用户自己滚了，解除钉住，交还滚动跟随。
 */
function applyPinned(st: TocState, line: number): boolean {
	const target = st.headings[st.pinnedIdx]?.position.start.line ?? 0;
	if (st.pinnedTop === null) {
		st.pinnedTop = line; // 跳转落位后的第一帧
		setActive(st.pinnedIdx);
		return true;
	}
	if (Math.abs(line - st.pinnedTop) < 1) {
		setActive(st.pinnedIdx);
		return true;
	}
	if (Math.abs(line - target) < Math.abs(st.pinnedTop - target)) {
		st.pinnedTop = line;
		setActive(st.pinnedIdx);
		return true;
	}
	st.pinnedIdx = -1;
	st.pinnedTop = null;
	return false;
}

/**
 * currentMode.getScroll() = 视口顶部对应的行号（阅读 / 编辑通用，applyScroll 的逆运算）。
 * 阅读视图懒渲染（长笔记只渲染视口附近区块）不影响它取到的行号。
 */
function lineFromGetScroll(st: TocState): number | null {
	try {
		if (!st.view) return null;
		const scroll = st.view.currentMode.getScroll();
		if (typeof scroll !== "number" || !isFinite(scroll) || scroll < 0) return null;
		// 编辑视图防御：万一某些版本返回的是像素值（远大于正文行数）则弃用，走兜底
		if (st.view.getMode() === "source") {
			const docLines = st.view.editor.lineCount();
			if (docLines && scroll > docLines + 50) return null;
		}
		return scroll;
	} catch {
		return null;
	}
}

/** 兜底（主要服务编辑视图）：视口左上角坐标对应的行号 */
function lineFromPosAtCoords(st: TocState): number | null {
	try {
		const cm = (st.view?.editor as unknown as { cm?: CmLike }).cm;
		const pos = cm?.posAtCoords?.({ x: 5, y: 5 });
		if (typeof pos === "number" && cm?.state) return cm.state.doc.lineAt(pos).number - 1;
	} catch {
		/* 忽略：保留上一次高亮 */
	}
	return null;
}

/** 二分：最后一个 start.line <= line 的标题 */
function lastAtOrBefore(headings: HeadingCache[], line: number): number {
	let lo = 0;
	let hi = headings.length - 1;
	let ans = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if ((headings[mid]?.position.start.line ?? 0) <= line) {
			ans = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return ans;
}

function setActive(idx: number): void {
	const st = state;
	if (!st || idx === st.activeIdx) return; // 章节没变：不动 DOM
	st.activeIdx = idx;
	for (let i = 0; i < st.items.length; i++) {
		st.items[i]?.toggleClass("is-active", i === idx);
	}
	st.items[idx]?.scrollIntoView({ block: "nearest" });
}

// ---------------- 跳转 ----------------

function jumpTo(idx: number): void {
	const st = state;
	if (!st?.view || !Number.isFinite(idx)) return;
	const heading = st.headings[idx];
	if (!heading) return;
	const line = heading.position.start.line;
	// 钉住点击项：落位后直到用户真正滚动前，高亮都留在这一条
	st.pinnedIdx = idx;
	st.pinnedTop = null;
	try {
		st.view.currentMode.applyScroll(line);
	} catch {
		try {
			// 兜底：编辑视图的编辑器 API（居中滚动）
			st.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
		} catch {
			/* 两条路径都不可用：保持当前滚动位置 */
		}
	}
	setActive(idx);
	scheduleUpdate(); // 采样落位后的顶部行号，判定钉住是否继续保持
}
