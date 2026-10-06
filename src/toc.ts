import { MarkdownView, Platform, TFile } from "obsidian";
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
 * - 多级折叠：有子级的条目前带 ▸ / ▾ 箭头（点箭头只折叠这一支，不跳转）；折叠状态按
 *   「标题稳定签名」（层级 + 文本，不含行号）记在内存 —— 编辑正文触发列表重建时不丢，
 *   切换笔记 / 重开 Obsidian 重置；正文滚动进被折叠的分支时自动展开该分支并高亮
 *   —— 折叠只是收起「不看的」，不会把「当前读到哪」藏起来
 * - 移动端（Platform.isMobile）：收起态 = 右缘圆形悬浮按钮（触摸目标 40px），点按展开
 *   完整卡片。触摸端没有真 hover —— tap 会补发 mouseenter→click 事件序列，旧逻辑会
 *   「点一下直接跳转、面板还挂在那儿」，所以移动端完全不走悬停路径；点面板外、点条目
 *   跳转后都会自动收起
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
	/** 树结构：每个标题的直接父级索引（-1 = 顶层）；与 headings / items 同序 */
	parents: number[];
	/** 每个标题的「折叠签名」（层级|清洗后文本[#重复序]）：折叠状态跨列表重建的稳定锚点 */
	keys: string[];
	/** 已折叠分支的签名集合（会话内记忆）；切换笔记 / 停用时清空 */
	collapsed: Set<string>;
	/** 折叠状态当前所属的笔记路径：切文件时清掉上一本的折叠状态 */
	filePath: string | null;
	/** 移动端：点面板外收起用的 document 级 pointerdown 监听（teardown 必须移除） */
	docPointerHandler: ((ev: PointerEvent) => void) | null;
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
		parents: [],
		keys: [],
		collapsed: new Set<string>(),
		filePath: null,
		docPointerHandler: null,
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
	// 展开瞬间把列表定位到当前章节：收起态列表不可见时 scrollIntoView 不生效（移动端隐藏 /
	// 桌面横杠态），这里补一次，展开即看到高亮所在位置
	if (open) st.items[st.activeIdx]?.scrollIntoView({ block: "nearest" });
}

// ---------------- 面板 DOM ----------------

function ensurePanel(plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st || !st.view || st.panel) return;
	// 保险：清掉历史版本泄漏的残留面板（旧版卸载时未清理的 DOM），避免出现两个目录
	st.view.containerEl.querySelectorAll(":scope > .fl-toc").forEach((el) => el.remove());
	const panel = st.view.containerEl.createDiv({ cls: "fl-toc" });

	// 移动端收起态 = 圆形悬浮按钮（触摸目标 40px，形态由 CSS 控制）：点按展开完整卡片。
	// 桌面保持悬停窄轨，不渲染这个按钮
	if (Platform.isMobile) {
		const fab = panel.createEl("button", { cls: "fl-toc-fab" });
		fab.setAttribute("aria-label", "展开目录");
		fab.onclick = (ev) => {
			ev.stopPropagation();
			setPanelOpen(true);
		};
	}

	const head = panel.createDiv({ cls: "fl-toc-head" });
	head.addEventListener("mousedown", (ev) => ev.preventDefault()); // 点标题栏不抢编辑焦点
	head.createSpan({ cls: "fl-toc-title", text: "目录" });
	// 收起按钮固定在标题栏右端，箭头朝右（面板贴屏幕右缘，「收起」= 收回右缘窄轨）
	// 点击只「收起」为右缘窄轨（悬停自动再展开），不写 tocVisible=false 彻底关闭 ——
	// 避免「点一下浮层整个消失」的误操作；彻底关闭请走设置页开关
	const hideBtn = head.createEl("button", { cls: "fl-toc-hide", text: "»" });
	hideBtn.setAttribute("aria-label", "收起目录");
	hideBtn.onclick = (ev) => {
		ev.stopPropagation();
		setPanelOpen(false);
	};

	const listEl = panel.createDiv({ cls: "fl-toc-list" });
	// 点条目时保住编辑焦点；列表空白/滚动条不拦截（同级联菜单的做法）
	listEl.addEventListener("mousedown", (ev) => {
		const target = ev.target as HTMLElement;
		if (target.closest(".fl-toc-item")) ev.preventDefault();
	});
	listEl.addEventListener("click", (ev) => {
		const target = ev.target as HTMLElement;
		const item = target.closest<HTMLElement>(".fl-toc-item");
		if (!item) return;
		const idx = parseInt(item.dataset.idx ?? "", 10);
		// 点箭头 = 只折叠 / 展开这一支，不跳转（点条目其余部分才跳转）
		if (target.closest(".fl-toc-fold")) {
			toggleFold(idx);
			return;
		}
		jumpTo(idx);
		// 移动端：跳转后自动收起，把正文让出来（面板挡着小屏正文）
		if (Platform.isMobile) setPanelOpen(false);
	});

	// 桌面：收起态悬停一小会儿（150ms）再展开，避免鼠标路过误触发。
	// 移动端：触摸没有真 hover —— tap 会「补发」mouseenter→click 事件序列（点横杠直接
	// 跳转、面板随后自己弹开），所以完全不挂悬停事件；改由悬浮按钮点按 + 点面板外收起
	if (Platform.isMobile) {
		st.docPointerHandler = (ev: PointerEvent) => {
			const el = st.panel;
			if (!el || !el.hasClass("is-open")) return;
			if (ev.target instanceof Node && el.contains(ev.target)) return;
			setPanelOpen(false);
		};
		document.addEventListener("pointerdown", st.docPointerHandler, true);
	} else {
		panel.addEventListener("mouseenter", () => {
			if (st.hoverTimer !== null) window.clearTimeout(st.hoverTimer);
			st.hoverTimer = window.setTimeout(() => {
				st.hoverTimer = null;
				setPanelOpen(true);
			}, 150);
		});
		panel.addEventListener("mouseleave", () => {
			setPanelOpen(false);
		});
	}

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
	if (st.docPointerHandler) {
		document.removeEventListener("pointerdown", st.docPointerHandler, true);
		st.docPointerHandler = null;
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
	st.parents = [];
	st.keys = [];
	st.collapsed.clear();
	st.filePath = null;
	st.scrollBound = null;
	st.onScroll = null;
}

// ---------------- 标题列表 ----------------

function refreshHeadings(plugin: FeishuLitePlugin): void {
	const st = state;
	if (!st?.listEl || !st.view?.file) return;
	const file = st.view.file;
	// 切换笔记：折叠状态属于上一本，清掉（同一本内编辑正文导致的重建则保留）
	if (st.filePath !== file.path) {
		st.filePath = file.path;
		st.collapsed.clear();
	}
	const headings = plugin.app.metadataCache.getFileCache(file)?.headings ?? [];
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

	// 树结构与折叠签名：parents[i] = i 的直接父级；keys[i] 不含行号 —— 编辑正文让行号
	// 漂移时折叠状态依然对得上；同名同层级标题加 #n 序区分
	st.parents = computeParents(headings.map((h) => h.level));
	const occ = new Map<string, number>();
	st.keys = headings.map((h) => {
		const base = `${h.level}|${cleanHeading(h.heading)}`;
		const n = occ.get(base) ?? 0;
		occ.set(base, n + 1);
		return n === 0 ? base : `${base}#${n}`;
	});
	const childCount = new Array<number>(headings.length).fill(0);
	for (const p of st.parents) if (p >= 0) childCount[p] = (childCount[p] ?? 0) + 1;

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
		// 折叠箭头：有子级才渲染成 ▸ / ▾（由 .has-children + .is-folded 经 CSS 驱动）；
		// 无子级渲染隐身占位，让所有条目的文本列对齐
		const foldEl = item.createSpan({ cls: "fl-toc-fold" });
		if ((childCount[i] ?? 0) > 0) item.addClass("has-children");
		else foldEl.addClass("is-leaf");
		const text = cleanHeading(h.heading) || "（无标题）";
		item.appendText(text);
		item.setAttribute("title", text);
		st.items.push(item);
	}
	applyFoldVisibility();
	scheduleUpdate();
}

/** 标题文本去掉常见行内标记，只留纯文字（裸 ==...== 不处理：可能只是普通文字里的等号） */
export function cleanHeading(raw: string): string {
	return raw
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2") // [[链接|别名]] → 别名
		.replace(/[*_`~]/g, "")
		.replace(/==\{[a-z]+\}([\s\S]*?)==/g, "$1") // =={red}文字== → 文字（成对时连闭标记一起去掉）
		.replace(/==\{[a-z]+\}/g, "") // 未闭合的 =={red} 只去开标记
		.trim();
}

// ---------------- 多级折叠 ----------------

/**
 * 目录树构造：返回每个标题的直接父级索引（-1 = 顶层）。
 * 栈里保存「层级严格递增」的祖先链：新标题先把层级 >= 自己的全部弹出，栈顶即父级。
 */
export function computeParents(levels: number[]): number[] {
	const parents: number[] = [];
	const stack: number[] = [];
	for (let i = 0; i < levels.length; i++) {
		const level = levels[i] ?? 0;
		while (stack.length && (levels[stack[stack.length - 1] ?? 0] ?? 0) >= level) stack.pop();
		parents.push(stack.length ? stack[stack.length - 1] ?? -1 : -1);
		stack.push(i);
	}
	return parents;
}

/**
 * 折叠隐藏传播：hidden[i] = 任一严格祖先被折叠。
 * parents[i] < i 恒成立（父级必然在前），单遍 DP 即可。
 */
export function computeHidden(parents: number[], folded: boolean[]): boolean[] {
	const hidden: boolean[] = [];
	for (let i = 0; i < parents.length; i++) {
		const p = parents[i] ?? -1;
		hidden.push(p >= 0 ? (hidden[p] ?? false) || (folded[p] ?? false) : false);
	}
	return hidden;
}

/** 点箭头：切换某支的折叠状态（不重建列表，只更新显隐与箭头方向） */
function toggleFold(idx: number): void {
	const st = state;
	const key = st?.keys[idx];
	if (!st || key === undefined) return;
	if (st.collapsed.has(key)) st.collapsed.delete(key);
	else st.collapsed.add(key);
	applyFoldVisibility();
}

/** 把 collapsed 状态铺到 DOM：条目显隐 + 箭头方向（class 驱动，箭头字符由 CSS 画） */
function applyFoldVisibility(): void {
	const st = state;
	if (!st) return;
	const folded = st.keys.map((k) => st.collapsed.has(k));
	const hidden = computeHidden(st.parents, folded);
	for (let i = 0; i < st.items.length; i++) {
		st.items[i]?.toggleClass("is-hidden", hidden[i] === true);
		st.items[i]?.toggleClass("is-folded", folded[i] === true);
	}
}

/** 章节变化时：若新章节在被折叠的分支里，自动展开该分支 —— 折叠不遮挡「当前读到哪」 */
function ensureBranchExpanded(idx: number): void {
	const st = state;
	if (!st) return;
	let changed = false;
	for (let p = st.parents[idx] ?? -1; p >= 0; p = st.parents[p] ?? -1) {
		const key = st.keys[p];
		if (key !== undefined && st.collapsed.has(key)) {
			st.collapsed.delete(key);
			changed = true;
		}
	}
	if (changed) applyFoldVisibility();
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
	// 先保证这一支可见（在被折叠的分支里则自动展开），再上高亮 / 定位
	ensureBranchExpanded(idx);
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
