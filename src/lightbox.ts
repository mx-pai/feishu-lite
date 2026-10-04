import { EditorView, ViewPlugin } from "@codemirror/view";
import type FeishuLitePlugin from "./main";

/**
 * 图片查看器（灯箱）：
 * - 阅读视图 / 编辑视图（Live Preview）点击图片 → 全屏浮层：滚轮缩放（以光标为锚点）、拖拽平移、Esc / 点击空白关闭
 * - 编辑视图用原生捕获监听接管 mousedown（CM6 会把渲染态 callout 等 widget 内的事件判为「不属于编辑器」，
 *   扩展事件处理器收不到；原生监听不受此限制）：光标不跳、图片不翻源码，其余事件原样放行
 * - 图片外层有链接时放行链接；源码行缩略图（.fl-src-thumb）点击仍回源码；画布不受影响
 * - 设置项「图片查看器」可整体关闭；oz-image-plugin 只做编辑器内渲染、无查看器，二者不冲突
 * - 设置项「图片查看器」可整体关闭
 */

let closeCurrent: (() => void) | null = null;

function openLightbox(src: string, alt: string): void {
	closeCurrent?.();

	const doc = document;
	const overlay = doc.body.createDiv({ cls: "fl-lightbox" });
	const img = overlay.createEl("img", { cls: "fl-lightbox-img" });
	img.src = src;
	if (alt) img.alt = alt;
	overlay.createDiv({ cls: "fl-lightbox-hint", text: "滚轮缩放 · 拖拽平移 · 点击空白或 Esc 关闭" });

	let baseW = 800;
	let baseH = 600;
	let scale = 1;
	let closed = false;
	let down: { x: number; y: number; sl: number; st: number } | null = null;
	let moved = false;

	function apply(): void {
		img.style.width = `${Math.max(40, Math.round(baseW * scale))}px`;
	}

	function fitToView(): void {
		const vw = overlay.clientWidth;
		const vh = overlay.clientHeight;
		// 默认铺到视口 70%（留出边距，避免一开就占满整屏）；小图不放大：min(1, ...)
		let fit = Math.min(1, (vw * 0.7) / baseW, (vh * 0.7) / baseH);
		if (!isFinite(fit) || fit <= 0) fit = 1;
		scale = fit;
		apply();
	}

	function initSize(): void {
		baseW = img.naturalWidth || 800;
		baseH = img.naturalHeight || 600;
		fitToView();
	}
	if (img.complete && img.naturalWidth > 0) initSize();
	else img.onload = initSize;

	function close(): void {
		if (closed) return;
		closed = true;
		if (closeCurrent === close) closeCurrent = null;
		doc.removeEventListener("keydown", onKey, true);
		doc.removeEventListener("mousemove", onMove);
		doc.removeEventListener("mouseup", onUp);
		overlay.remove();
	}

	function onKey(e: KeyboardEvent): void {
		if (e.isComposing || e.key === "Process") return;
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}

	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		if (!baseW) return;
		const before = img.getBoundingClientRect();
		if (before.width <= 0 || before.height <= 0) return;
		const relX = (e.clientX - before.left) / before.width;
		const relY = (e.clientY - before.top) / before.height;
		const next = Math.min(10, Math.max(0.05, scale * Math.exp(-e.deltaY * 0.0018)));
		if (Math.abs(next - scale) < 1e-4) return;
		scale = next;
		apply();
		// 让光标下那个点在缩放后仍停在原处
		const after = img.getBoundingClientRect();
		overlay.scrollLeft += after.left + relX * after.width - e.clientX;
		overlay.scrollTop += after.top + relY * after.height - e.clientY;
	}

	function onDown(e: MouseEvent): void {
		if (e.button !== 0) return;
		down = { x: e.clientX, y: e.clientY, sl: overlay.scrollLeft, st: overlay.scrollTop };
		moved = false;
		e.preventDefault(); // 禁掉图片原生拖拽
	}

	function onMove(e: MouseEvent): void {
		if (!down) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
		overlay.scrollLeft = down.sl - dx;
		overlay.scrollTop = down.st - dy;
	}

	function onUp(): void {
		down = null;
	}

	overlay.addEventListener("wheel", onWheel, { passive: false });
	overlay.addEventListener("mousedown", onDown);
	overlay.addEventListener("click", () => {
		if (moved) {
			moved = false; // 这一下是拖拽收尾，不当作关闭点击
			return;
		}
		close();
	});
	doc.addEventListener("keydown", onKey, true);
	doc.addEventListener("mousemove", onMove);
	doc.addEventListener("mouseup", onUp);
	closeCurrent = close;
}

export function registerLightbox(plugin: FeishuLitePlugin): void {
	plugin.registerDomEvent(
		document,
		"click",
		(e) => {
			if (!plugin.settings.imageLightbox) return;
			const t = e.target;
			if (!(t instanceof HTMLElement)) return;
			const img = t.closest("img");
			if (!img) return;
			if (img.closest(".fl-lightbox")) return;
			if (img.closest("a")) return; // 图片外还有链接 → 放行链接
			if (!img.closest(".markdown-preview-view, .markdown-reading-view")) return; // 只在阅读视图接管
			e.preventDefault();
			e.stopPropagation();
			openLightbox(img.src, img.alt);
		},
		true
	);

	// 停用 / 卸载插件时收起灯箱：清掉浮层与挂在 document 上的监听，避免残留
	plugin.register(() => closeCurrent?.());
}

/** 编辑视图（Live Preview）通道：点击渲染出的图片 → 灯箱（源码行缩略图除外，点击它仍回源码编辑） */
export function lightboxEditorExtension(plugin: FeishuLitePlugin) {
	return ViewPlugin.fromClass(
		class {
			private view: EditorView;
			private onMouseDown: (e: MouseEvent) => void;

			constructor(view: EditorView) {
				this.view = view;
				this.onMouseDown = (e: MouseEvent) => {
					if (e.button !== 0) return;
					if (e.defaultPrevented) return; // 已有其它处理（如灯箱自身）
					if (!plugin.settings.imageLightbox) return;
					const t = e.target;
					if (!(t instanceof HTMLElement)) return;
					const img = t.closest("img");
					if (!img) return; // 只拦图片点击，其余事件原样放行
					if (img.closest(".fl-src-thumb")) return;
					if (img.closest("a")) return;
					e.preventDefault();
					e.stopPropagation(); // CM6 收不到这次 mousedown：光标不动、图片不翻源码
					openLightbox(img.src, img.alt);
				};
				// 原生捕获监听：渲染态 callout 等 widget 内的事件会被 CM6 判为「不属于编辑器」、
				// 扩展事件处理器收不到；原生监听绕开该判定，分栏里的图片也能点开
				view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
			}

			destroy(): void {
				this.view.contentDOM.removeEventListener("mousedown", this.onMouseDown, true);
			}
		}
	);
}
