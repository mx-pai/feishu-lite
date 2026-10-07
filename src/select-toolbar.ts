import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { buildWrapSpec, currentWrapOpen, lineInFence } from "./wrap-core";
import { HL_COLORS } from "./highlight";
import type FeishuLitePlugin from "./main";
import { editorInfoField } from "obsidian";

/**
 * 划词工具条：编辑视图选中文字时浮现的小工具条。
 * - 只放「没有快捷键可替代」的动作：7 色高亮 / 直接换色（黄点 = 默认 ==文字==）+ 行内代码 + 删除线
 * - Feishu 式切换：已生效的样式（按钮点亮）再点一次 = 取消；不同样式之间直接互转、不叠加
 * - 单行选区提供格式工具，跨行选区提供批注；代码块内不显示；点击保留选区
 * - 包裹 / 换色逻辑在 wrap-core（纯计算）：标记内选区直接换标记、覆盖标记的选区先剥壳
 * - 位置跟随选区（拖动 / 滚动实时更新）；Esc 或选区消失后隐藏
 */

interface BarRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** 与 CM6 requestMeasure 的测量请求等价的最小结构类型（MeasureRequest 未公开导出，按结构兼容） */
interface MeasureReq<T> {
	key?: unknown;
	read: (view: EditorView) => T;
	write?: (measure: T, view: EditorView) => void;
}

/** 跨行选区是否显示工具条：批注在 → 可（批注本就为跨行设计）；外部划词动作里有 multiLine → 可 */
function multiLineOk(plugin: FeishuLitePlugin): boolean {
	return plugin.settings.commentsEnabled || plugin.externalSelectionActions.some((a) => a.multiLine);
}

/** 应用或取消包裹：选区已包着同一标记 → 剥壳（再次点击 = 取消）；否则包裹 / 换色 / 互转 */
function toggleWrap(view: EditorView, open: string, close: string): void {
	const selection = view.state.selection.main;
	if (view.state.doc.lineAt(selection.from).number !== view.state.doc.lineAt(selection.to).number) return;
	const spec =
		currentWrapOpen(view.state) === open
			? buildWrapSpec(view.state, "", "")
			: buildWrapSpec(view.state, open, close);
	if (spec) view.dispatch(spec);
}

export function selectToolbarExtension(plugin: FeishuLitePlugin) {
	return ViewPlugin.fromClass(
		class {
			private view: EditorView;
			private dom: HTMLElement | null = null;
			private shown = false;
			/** Esc 主动收起后不立即重弹；选区再次变化时复位 */
			private dismissed = false;
			private destroyed = false;
			private onKeyDown: (e: KeyboardEvent) => void;
			/** 常驻测量请求（同一对象复用，requestMeasure 内部按 key 去重，连发只测一次） */
			private measureReq: MeasureReq<{ a: BarRect; b: BarRect } | null>;
			/** 工具条按钮：开标记 ↔ 元素，用于同步「当前已生效样式」的点亮态 */
			private buttons: { open: string; el: HTMLElement }[] = [];
			/** 外部划词动作按钮（含分隔线）；按 id 签名重建，不参与 is-active 同步 */
			private extEls: HTMLElement[] = [];
			private extSig = "";

			constructor(view: EditorView) {
				this.view = view;
				this.measureReq = {
					key: this,
					read: () => this.readCoords(),
					write: (coords) => this.writeBar(coords),
				};
				this.onKeyDown = (e: KeyboardEvent) => {
					if (e.isComposing || e.key === "Process") return; // IME 组合中的 Esc 只取消候选，不收起工具条
					if (e.key === "Escape" && this.shown) {
						this.dismissed = true;
						this.hide();
					}
				};
				view.contentDOM.addEventListener("keydown", this.onKeyDown, true);
			}

			update(update: ViewUpdate): void {
				if (update.selectionSet) this.dismissed = false;
				if (update.view.composing) return; // IME 组合期不做无谓测量
				this.sync();
			}

			destroy(): void {
				this.destroyed = true;
				this.view.contentDOM.removeEventListener("keydown", this.onKeyDown, true);
				this.dom?.remove();
				this.dom = null;
				this.buttons = [];
				this.extEls = [];
				this.extSig = "";
			}

			private sync(): void {
				const view = this.view;
				const sel = view.state.selection.main;
				if (sel.empty || this.dismissed || !plugin.settings.selectToolbar || !view.hasFocus) {
					if (this.shown) this.hide();
					return;
				}
				const fromLine = view.state.doc.lineAt(sel.from);
				const toLine = view.state.doc.lineAt(sel.to);
				if ((fromLine.number !== toLine.number && !multiLineOk(plugin)) || lineInFence(view.state, fromLine.number)) {
					if (this.shown) this.hide();
					return;
				}
				// 坐标读取必须等出 update 周期：CM6 在 Updating 阶段禁止读布局
				// （coordsAtPos → readMeasured 直接抛错且被 CM6 吞掉 → 工具条完全不出现）。
				// 统一交给 requestMeasure：read 阶段量坐标（Measuring 阶段合法），write 阶段摆 DOM。
				view.requestMeasure(this.measureReq);
			}

			/** measure read 阶段（Measuring，允许读布局）：状态可能已再次变化，重新完整校验 */
			private readCoords(): { a: BarRect; b: BarRect } | null {
				if (this.destroyed) return null;
				const view = this.view;
				const sel = view.state.selection.main;
				if (sel.empty || this.dismissed || !plugin.settings.selectToolbar || !view.hasFocus) return null;
				const fromLine = view.state.doc.lineAt(sel.from);
				const toLine = view.state.doc.lineAt(sel.to);
				if ((fromLine.number !== toLine.number && !multiLineOk(plugin)) || lineInFence(view.state, fromLine.number)) return null;
				const a = view.coordsAtPos(sel.from);
				const b = view.coordsAtPos(sel.to);
				return a && b ? { a, b } : null;
			}

			/** measure write 阶段：只做 DOM 写入 */
			private writeBar(coords: { a: BarRect; b: BarRect } | null): void {
				if (this.destroyed) return;
				if (!coords) {
					if (this.shown) this.hide();
					return;
				}
				this.show(coords.a, coords.b);
			}

			private show(a: BarRect, b: BarRect): void {
				const dom = this.ensureDom();
				this.syncExternal(dom);
				dom.classList.add("is-on");
				this.syncActive();
				const w = dom.offsetWidth;
				const h = dom.offsetHeight;
				const win = dom.ownerDocument.defaultView ?? window;
				let left = (a.left + b.right) / 2 - w / 2;
				left = Math.max(8, Math.min(left, win.innerWidth - w - 8));
				let top = a.top - h - 8;
				if (top < 8) top = b.bottom + 8; // 顶部放不下就放选区下方
				dom.style.left = `${Math.round(left)}px`;
				dom.style.top = `${Math.round(top)}px`;
				this.shown = true;
			}

			private hide(): void {
				this.dom?.classList.remove("is-on");
				this.shown = false;
			}

			/** 外部划词动作按钮：按 id 签名重建（注册表变化时才动 DOM；按钮不参与 is-active 同步） */
			private syncExternal(dom: HTMLElement): void {
				const items = plugin.externalSelectionActions;
				const sig = items.map((a) => a.id).join(",");
				if (sig === this.extSig) return;
				this.extSig = sig;
				for (const el of this.extEls) el.remove();
				this.extEls = [];
				if (!items.length) return;
				const sep = dom.createSpan({ cls: "fl-selbar-sep" });
				this.extEls.push(sep);
				for (const a of items) {
					// 与内置「批注」同款按钮观感（span 式纯文字会与阅读条里的按钮形态不一致）
					const btn = dom.createEl("button", { cls: "fl-selbar-ext", text: a.label });
					if (a.title) btn.title = a.title;
					btn.addEventListener("click", () => {
						const info = this.view.state.field(editorInfoField, false);
						void Promise.resolve()
							.then(() => a.run(info?.editor ?? null))
							.catch((err) => console.error("[feishu-lite] 划词动作执行失败", err));
					});
					this.extEls.push(btn);
				}
			}

			/** 同步「当前选区已生效样式」到按钮点亮态（Feishu 式：点亮的按钮再点一次 = 取消） */
			private syncActive(): void {
				const selection = this.view.state.selection.main;
				const single = this.view.state.doc.lineAt(selection.from).number === this.view.state.doc.lineAt(selection.to).number;
				const cur = currentWrapOpen(this.view.state);
				for (const b of this.buttons) { b.el.classList.toggle("is-active", cur === b.open); b.el.classList.toggle("is-disabled", !single); b.el.setAttribute("aria-disabled", String(!single)); }
				const comment = this.dom?.querySelector<HTMLElement>(".fl-selbar-comment");
				if (comment) { comment.hidden = !plugin.settings.commentsEnabled; comment.setText(plugin.comments?.pending ? "关联批注" : "批注"); }
			}

			private ensureDom(): HTMLElement {
				if (this.dom) return this.dom;
				const doc = this.view.dom.ownerDocument; // 兼容弹出窗口（独立 document）
				// Obsidian createDiv/createSpan 会自动挂到调用者上。
				// Document 已有 html 根节点，必须在 body / 工具条内创建。
				const dom = doc.body.createDiv({ cls: "fl-selbar" });
				// 公开协调标记：其他划词浮层（如翻译）以此判断「点在 feishu-lite 划词条上」并避让
				dom.setAttribute("data-fl-ui", "selbar");
				// 保住编辑器焦点与选区：按在工具条上不触发编辑器失焦
				dom.addEventListener("mousedown", (e) => e.preventDefault());
				dom.addEventListener("pointerdown", (e) => e.preventDefault());
				for (const c of HL_COLORS) {
					const isDefault = c.value === "yellow";
					const open = isDefault ? "==" : `=={${c.value}}`;
					// 复用高亮配色类：色点背景即该色，跟随用户自定义颜色
					const dot = dom.createSpan({ cls: `fl-selbar-dot fl-hl-${c.value}` });
					dot.title = isDefault ? "黄色高亮 ==文字==（再次点击取消）" : `${c.label}高亮（再次点击取消）`;
					dot.addEventListener("click", () => {
						toggleWrap(this.view, open, "==");
					});
					this.buttons.push({ open, el: dot });
				}
				dom.createSpan({ cls: "fl-selbar-sep" });
				const code = dom.createSpan({ cls: "fl-selbar-code", text: "</>" });
				code.title = "行内代码 `文字`（再次点击取消）";
				code.addEventListener("click", () => {
					toggleWrap(this.view, "`", "`");
				});
				this.buttons.push({ open: "`", el: code });
				const strike = dom.createSpan({ cls: "fl-selbar-strike", text: "S" });
				strike.title = "删除线 ~~文字~~（再次点击取消）";
				strike.addEventListener("click", () => {
					toggleWrap(this.view, "~~", "~~");
				});
				this.buttons.push({ open: "~~", el: strike });
				const comment = dom.createEl("button", { cls: "fl-selbar-comment", text: "批注", attr: { "aria-label": "为选中文字添加批注" } });
				comment.addEventListener("click", () => {
					const info = this.view.state.field(editorInfoField, false);
					if (info?.file && info.editor) { plugin.comments.createFromEditor(info.editor, info.file); this.dismissed = true; this.hide(); }
				});
				this.dom = dom;
				return dom;
			}
		}
	);
}
