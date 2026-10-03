import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 编辑视图美化：分栏（img-N callout）进入源码编辑态时，
 * 光标不在的图片行用小缩略图代替 `![[文件名]]` 文本，避免露出 image-xxx.png 文件名。
 *
 * - 光标/选区落在某行 → 该行照常显示原文（可编辑文件名、尺寸）
 * - 纯源码模式（.is-source-mode）不生效，保持原始文本
 * - 块被渲染（未激活）时其行不在 visibleRanges 内，自然不受影响
 */

const IMG_LINE_RE = /^\s*>\s*!\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]\s*$/;
const CALLOUT_HEAD_RE = /^\s*>\s*\[!img-[2-4]\][+\-]?\s*$/;
const MAX_WALK = 80;

class GridThumbWidget extends WidgetType {
	constructor(private src: string, private name: string) {
		super();
	}

	eq(other: GridThumbWidget): boolean {
		return other.src === this.src;
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "fl-src-thumb";
		const img = document.createElement("img");
		img.src = this.src;
		img.alt = ""; // 即使加载失败也不显示文件名文字
		img.title = this.name; // 悬停可辨认是哪张图
		span.appendChild(img);
		return span;
	}

	ignoreEvent(): boolean {
		return false; // 点击交给编辑器：点到哪一行，哪一行切换回可编辑文字
	}
}

export function gridSourcePlugin(plugin: FeishuLitePlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildGridSourceDecorations(view, plugin);
			}

			update(update: ViewUpdate): void {
				// IME（双拼/拼音）组合期间不重建（与彩色高亮装饰相同的性能守卫）
				if (update.view.composing && !update.docChanged) return;
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildGridSourceDecorations(update.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

function buildGridSourceDecorations(view: EditorView, plugin: FeishuLitePlugin): DecorationSet {
	try {
		if (view.dom.closest(".is-source-mode")) return Decoration.none;
		if (!plugin.settings.gridSourceThumbs) return Decoration.none;

		const state = view.state;
		const info = state.field(editorInfoField, false);
		const sourcePath = info?.file?.path ?? "";
		const app = plugin.app;
		const ranges: { from: number; to: number; deco: Decoration }[] = [];

		for (const vrange of view.visibleRanges) {
			let pos = vrange.from;
			while (pos <= vrange.to) {
				const line = state.doc.lineAt(pos);
				pos = line.to + 1;
				const text = line.text;
				if (!text.includes("![[") || !text.includes(">")) continue;
				const m = IMG_LINE_RE.exec(text);
				if (!m) continue;

				// 光标/选区在该行 → 显示原文（允许编辑）
				let editing = false;
				for (const r of state.selection.ranges) {
					if (r.from <= line.to && r.to >= line.from) {
						editing = true;
						break;
					}
				}
				if (editing) continue;

				// 判定是否位于 img 分栏块内：向上找到引用块首行，检查是不是 [!img-N]
				let top = line.number;
				const lower = Math.max(1, line.number - MAX_WALK);
				for (let n = line.number - 1; n >= lower; n--) {
					if (/^\s*>/.test(state.doc.line(n).text)) top = n;
					else break;
				}
				if (top === line.number) continue;
				if (!CALLOUT_HEAD_RE.test(state.doc.line(top).text)) continue;

				// 解析文件 → 缩略图 URL（解析不到就保持原文，不冒险）
				const name = m[1].trim();
				const dest = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
				if (!dest) continue;
				const url = app.vault.getResourcePath(dest);

				const lb = text.indexOf("![[");
				const rb = lb >= 0 ? text.indexOf("]]", lb + 3) : -1;
				if (lb < 0 || rb < 0) continue;
				ranges.push({
					from: line.from + lb,
					to: line.from + rb + 2,
					deco: Decoration.replace({ widget: new GridThumbWidget(url, name) }),
				});
			}
		}

		if (!ranges.length) return Decoration.none;
		ranges.sort((a, b) => a.from - b.from || a.to - b.to);
		return Decoration.set(
			ranges.map((r) => r.deco.range(r.from, r.to)),
			true
		);
	} catch (err) {
		console.error("[feishu-lite] 分栏源码缩略图渲染失败", err);
		return Decoration.none;
	}
}
