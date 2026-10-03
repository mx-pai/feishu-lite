import type { Editor, TFile } from "obsidian";
import type FeishuLitePlugin from "./main";
import type { ListOption } from "./util";
import type { SlashItem } from "./slash-items";

/**
 * 级联选项菜单（飞书式）：
 * - openCascade：单栏（命令面板入口用），选项展开在原菜单位置右侧
 * - openSlashCascade：双栏（斜杠菜单入口用），一级菜单保留在左、参数展开在右，
 *   ← 返回上一级，Esc 整体收起
 * 键盘：↑↓ 移动 · Enter 确定 · Esc 取消；其它按键关闭并放行
 * 鼠标：点击外部 / 滚动自动关闭；“选中菜单”那一次点击的尾巴（mouseup/click）
 *   会落在刚展开的菜单上，因此展开后 200ms 内忽略鼠标事件（键盘不受影响）
 * IME 组合期间不拦截任何按键。
 */

let closeCurrent: (() => void) | null = null;

function runGuarded(fn: () => void | Promise<void>): void {
	Promise.resolve()
		.then(fn)
		.catch((err) => console.error("[feishu-lite] 级联菜单执行失败", err));
}

interface CmLike {
	state: { doc: { line(n: number): { from: number } } };
	coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
}

/** 光标在屏幕上的锚点（拿不到则 null）；供级联菜单与表格选择器等弹层复用 */
export function anchorRect(editor: Editor): { left: number; bottom: number } | null {
	const cm = (editor as unknown as { cm?: CmLike }).cm;
	if (!cm) return null;
	try {
		const cur = editor.getCursor();
		const offset = cm.state.doc.line(cur.line + 1).from + cur.ch;
		const rect = cm.coordsAtPos(offset);
		return rect ? { left: rect.left, bottom: rect.bottom } : null;
	} catch {
		return null;
	}
}

/** 组装一行选项（label + hint） */
function buildRow(
	listEl: HTMLElement,
	label: string,
	hint: string | undefined,
	onActivate: () => void,
	onClick: () => void
): HTMLElement {
	const row = listEl.createDiv({ cls: "fl-cascade-item" });
	row.createDiv({ cls: "fl-cascade-name", text: label });
	if (hint) row.createDiv({ cls: "fl-cascade-hint", text: hint });
	row.onmouseenter = onActivate;
	row.onclick = onClick;
	return row;
}

/** 单栏级联（命令面板等无一级菜单的场景） */
export function openCascade<T>(
	editor: Editor,
	title: string,
	options: ListOption<T>[],
	onPick: (value: T) => void
): void {
	if (!options.length) return;
	closeCurrent?.();

	const openedAt = Date.now();
	const guardMouse = () => Date.now() - openedAt < 200;

	const root = document.body.createDiv({ cls: "fl-cascade" });
	const panel = root.createDiv({ cls: "fl-cascade-panel" });
	panel.createDiv({ cls: "fl-cascade-title", text: title });
	const listEl = panel.createDiv({ cls: "fl-cascade-list" });
	panel.createDiv({ cls: "fl-cascade-foot", text: "↑↓ 选择 · Enter 确定 · Esc 取消" });

	const rows: HTMLElement[] = [];
	let active = 0;
	let closed = false;

	function setActive(i: number): void {
		const len = options.length;
		active = ((i % len) + len) % len;
		rows.forEach((row, idx) => row.toggleClass("is-active", idx === active));
		rows[active]?.scrollIntoView({ block: "nearest" });
	}

	function close(): void {
		if (closed) return;
		closed = true;
		if (closeCurrent === close) closeCurrent = null;
		document.removeEventListener("keydown", onKey, true);
		document.removeEventListener("mousedown", onMouseDown, true);
		window.removeEventListener("scroll", onScroll, true);
		root.remove();
	}

	function pick(i: number): void {
		if (closed) return;
		const value = options[i]?.value as T;
		close();
		runGuarded(() => onPick(value));
	}

	function onKey(e: KeyboardEvent): void {
		if (e.isComposing || e.keyCode === 229) return; // IME 组合中不拦截
		if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			setActive(active + 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			setActive(active - 1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			pick(active);
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else {
			close(); // 其它按键：关闭并放行
		}
	}

	function onMouseDown(e: MouseEvent): void {
		if (e.target instanceof Node && root.contains(e.target)) {
			// 点在选项上：阻止默认聚焦，保持编辑器焦点不丢（滚动条不受影响）
			if (e.target instanceof HTMLElement && e.target.closest(".fl-cascade-item")) e.preventDefault();
			return;
		}
		close();
	}

	function onScroll(e: Event): void {
		if (e.target instanceof Node && root.contains(e.target)) return;
		close();
	}

	options.forEach((o, i) => {
		rows.push(
			buildRow(
				listEl,
				o.label,
				o.hint,
				() => {
					if (!guardMouse()) setActive(i);
				},
				() => {
					if (!guardMouse()) pick(i);
				}
			)
		);
	});
	setActive(0);

	// 定位：光标右侧；右缘放不下则翻到左侧
	const rect = anchorRect(editor);
	let left = rect ? rect.left + 320 : Math.round(window.innerWidth / 2 - 110);
	let top = rect ? rect.bottom + 4 : Math.round(window.innerHeight / 3);
	root.style.left = `${left}px`;
	root.style.top = `${top}px`;
	const w = root.offsetWidth;
	const h = root.offsetHeight;
	if (left + w > window.innerWidth - 8) {
		left = rect ? rect.left - w - 24 : window.innerWidth - w - 8;
		root.style.left = `${Math.max(8, left)}px`;
	}
	if (top + h > window.innerHeight - 8) {
		root.style.top = `${Math.max(8, window.innerHeight - h - 8)}px`;
	}

	document.addEventListener("keydown", onKey, true);
	document.addEventListener("mousedown", onMouseDown, true);
	window.addEventListener("scroll", onScroll, true);
	closeCurrent = close;
}

/** 双栏级联：左 = 斜杠菜单（保持不消失），右 = 当前项的参数 */
export function openSlashCascade(
	plugin: FeishuLitePlugin,
	editor: Editor,
	file: TFile | null,
	items: SlashItem[],
	entry: SlashItem
): void {
	if (!items.length) return;
	closeCurrent?.();

	const openedAt = Date.now();
	const guardMouse = () => Date.now() - openedAt < 200;

	const root = document.body.createDiv({ cls: "fl-cascade" });
	const leftPanel = root.createDiv({ cls: "fl-cascade-panel is-parent" });
	const leftList = leftPanel.createDiv({ cls: "fl-cascade-list" });
	const rightPanel = root.createDiv({ cls: "fl-cascade-panel is-child" });
	const rightTitle = rightPanel.createDiv({ cls: "fl-cascade-title" });
	const rightList = rightPanel.createDiv({ cls: "fl-cascade-list" });
	const foot = rightPanel.createDiv({ cls: "fl-cascade-foot" });

	let leftIdx = Math.max(0, items.indexOf(entry));
	let rightIdx = 0;
	let focus: "left" | "right" = "right";
	let options: ListOption<unknown>[] = [];
	let optionRows: HTMLElement[] = [];
	let closed = false;

	// 左栏：一级菜单
	const leftRows: HTMLElement[] = items.map((it, i) =>
		buildRow(
			leftList,
			it.name,
			it.hint,
			() => {
				if (focus === "left" && !guardMouse()) setLeft(i);
			},
			() => {
				if (guardMouse()) return;
				setLeft(i);
				focus = "left";
				refreshFocus();
				if (!it.params) runItem(i); // 无参数项：点击即执行
			}
		)
	);

	function setRight(i: number): void {
		if (!options.length) return;
		const len = options.length;
		rightIdx = ((i % len) + len) % len;
		optionRows.forEach((row, idx) => row.toggleClass("is-active", idx === rightIdx));
		optionRows[rightIdx]?.scrollIntoView({ block: "nearest" });
	}

	/** 左栏高亮移动：右侧面板实时换成该项的参数 */
	function setLeft(i: number): void {
		const len = items.length;
		leftIdx = ((i % len) + len) % len;
		const it = items[leftIdx];
		leftRows.forEach((row, idx) => row.toggleClass("is-active", idx === leftIdx));
		leftRows[leftIdx]?.scrollIntoView({ block: "nearest" });

		options = it?.params ? it.params.options : [];
		rightTitle.setText(it?.params ? it.params.title : (it?.name ?? ""));
		rightList.empty();
		optionRows = [];
		if (it?.params) {
			options.forEach((o, oi) => {
				optionRows.push(
					buildRow(
						rightList,
						o.label,
						o.hint,
						() => {
							if (!guardMouse()) setRight(oi);
						},
						() => {
							if (!guardMouse()) pickOption(oi);
						}
					)
				);
			});
			setRight(0);
		} else {
			rightList.createDiv({ cls: "fl-cascade-empty", text: "回车直接执行" });
		}
	}

	function refreshFocus(): void {
		leftPanel.toggleClass("is-focused", focus === "left");
		rightPanel.toggleClass("is-focused", focus === "right");
		const cur = items[leftIdx];
		foot.setText(
			focus === "left"
				? cur?.params
					? "↑↓ 选择 · → / Enter 进入参数 · Esc 取消"
					: "↑↓ 选择 · Enter 执行 · Esc 取消"
				: "↑↓ 选择 · Enter 确定 · ← 返回 · Esc 取消"
		);
	}

	function close(): void {
		if (closed) return;
		closed = true;
		if (closeCurrent === close) closeCurrent = null;
		document.removeEventListener("keydown", onKey, true);
		document.removeEventListener("mousedown", onMouseDown, true);
		window.removeEventListener("scroll", onScroll, true);
		root.remove();
	}

	function pickOption(i: number): void {
		if (closed) return;
		const spec = items[leftIdx]?.params;
		if (!spec) return;
		const value = spec.options[i]?.value;
		close();
		runGuarded(() => spec.run(plugin, editor, file, value));
	}

	function runItem(i: number): void {
		if (closed) return;
		const it = items[i];
		if (!it) return;
		close();
		runGuarded(() => it.run(plugin, editor, file));
	}

	function onKey(e: KeyboardEvent): void {
		if (e.isComposing || e.keyCode === 229) return; // IME 组合中不拦截
		if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			if (focus === "left") {
				setLeft(leftIdx + 1);
				refreshFocus();
			} else {
				setRight(rightIdx + 1);
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			if (focus === "left") {
				setLeft(leftIdx - 1);
				refreshFocus();
			} else {
				setRight(rightIdx - 1);
			}
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			e.stopPropagation();
			if (focus === "left" && items[leftIdx]?.params) {
				focus = "right";
				refreshFocus();
			}
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			e.stopPropagation();
			if (focus === "right") {
				focus = "left";
				refreshFocus();
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			if (focus === "right") pickOption(rightIdx);
			else if (items[leftIdx]?.params) {
				focus = "right";
				refreshFocus();
			} else runItem(leftIdx);
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else {
			close(); // 其它按键：关闭并放行
		}
	}

	function onMouseDown(e: MouseEvent): void {
		if (e.target instanceof Node && root.contains(e.target)) {
			if (e.target instanceof HTMLElement && e.target.closest(".fl-cascade-item")) e.preventDefault();
			return;
		}
		close();
	}

	function onScroll(e: Event): void {
		if (e.target instanceof Node && root.contains(e.target)) return;
		close();
	}

	setLeft(leftIdx);
	focus = entry.params ? "right" : "left";
	refreshFocus();

	// 定位：左栏贴在原菜单位置（光标下方），两栏整体不越出视口
	const rect = anchorRect(editor);
	let left = rect ? rect.left : Math.round(window.innerWidth / 2 - 240);
	let top = rect ? rect.bottom + 4 : Math.round(window.innerHeight / 3);
	root.style.left = `${left}px`;
	root.style.top = `${top}px`;
	const totalW = leftPanel.offsetWidth + rightPanel.offsetWidth + 6;
	if (left + totalW > window.innerWidth - 8) {
		left = Math.max(8, window.innerWidth - 8 - totalW);
		root.style.left = `${left}px`;
	}
	const h = Math.max(leftPanel.offsetHeight, rightPanel.offsetHeight);
	if (top + h > window.innerHeight - 8) {
		root.style.top = `${Math.max(8, window.innerHeight - h - 8)}px`;
	}

	document.addEventListener("keydown", onKey, true);
	document.addEventListener("mousedown", onMouseDown, true);
	window.addEventListener("scroll", onScroll, true);
	closeCurrent = close;
}
