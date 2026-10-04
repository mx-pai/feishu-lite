import { Editor, MarkdownFileInfo, MarkdownView, Notice, editorInfoField } from "obsidian";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type FeishuLitePlugin from "./main";
import { buildImageName, toGridBlock } from "./naming";
import { compressImage } from "./image-compress";

/**
 * 粘贴 / 拖入图片时接管保存流程：
 * 按模板重命名 → 存入附件目录（图床）→ 插入链接；多图自动包成网格。
 *
 * 两条通道：
 * 1. CM6 最高优先级（Prec.highest domEventHandlers）——抢在其它插件（如 image-converter）
 *    之前接管图片粘贴；接管成功后 preventDefault + stopPropagation，避免重复处理。
 * 2. workspace editor-paste / editor-drop ——兜底通道（CM6 通道未接管的场景）。
 *
 * 任何异常都记录并放行，绝不破坏默认粘贴行为（P1 兜底）。
 * 注：设置里关掉「粘贴自动命名」= 两条通道都让位，恢复其它插件的既有行为。
 */
export function registerImagePaste(plugin: FeishuLitePlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on("editor-paste", (evt, editor, info) => {
			if (evt.defaultPrevented) return;
			if (!claimable(plugin, evt)) return;
			evt.preventDefault();
			void handleFiles(plugin, evt, editor, info);
		})
	);
	plugin.registerEvent(
		plugin.app.workspace.on("editor-drop", (evt, editor, info) => {
			if (evt.defaultPrevented) return;
			if (!claimable(plugin, evt)) return;
			evt.preventDefault();
			void handleFiles(plugin, evt, editor, info);
		})
	);
	plugin.registerEditorExtension(
		Prec.highest(
			EditorView.domEventHandlers({
				paste: (evt, view) => tryClaim(plugin, evt, view),
				drop: (evt, view) => tryClaim(plugin, evt, view),
			})
		)
	);
}

/** CM6 高优先级通道：能处理就接管并返回 true，阻断其它插件对同一事件的抢先处理 */
function tryClaim(
	plugin: FeishuLitePlugin,
	evt: ClipboardEvent | DragEvent,
	view: EditorView
): boolean {
	try {
		if (!plugin.settings.renameOnPaste) return false;
		if (evt.defaultPrevented) return false;
		const files = extractImageFiles(evt);
		if (!files.length) return false;
		const info = view.state.field(editorInfoField, false);
		const editor = info?.editor;
		if (!info || !editor) return false;

		evt.preventDefault();
		evt.stopPropagation();

		// 拖入时以落点为准（直接走 CM6 的坐标解析）
		const drag = evt as DragEvent;
		if (drag.dataTransfer && typeof drag.clientX === "number") {
			const offset = view.posAtCoords({ x: drag.clientX, y: drag.clientY });
			if (offset != null) {
				try {
					editor.setCursor(editor.offsetToPos(offset));
				} catch {
					/* 落点解析失败则使用当前光标 */
				}
			}
		}

		void insertImages(plugin, files, editor, info);
		return true;
	} catch (err) {
		console.error("[feishu-lite] 图片粘贴接管失败，回退默认行为", err);
		return false;
	}
}

/** 兜底通道的「要不要接管」判定（与 CM6 通道同口径） */
function claimable(plugin: FeishuLitePlugin, evt: ClipboardEvent | DragEvent): boolean {
	return plugin.settings.renameOnPaste && extractImageFiles(evt).length > 0;
}

/** workspace 兜底通道（预检 + preventDefault 已在注册处完成，这里只负责后续插入） */
async function handleFiles(
	plugin: FeishuLitePlugin,
	evt: ClipboardEvent | DragEvent,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo
): Promise<void> {
	try {
		const files = extractImageFiles(evt);
		if (!files.length) return;

		// 拖入时以落点为准（经 CM6 EditorView 解析坐标，失败则退回当前光标）
		const drag = evt as DragEvent;
		if (drag.dataTransfer && typeof drag.clientX === "number") {
			const cm = (editor as unknown as {
				cm?: { posAtCoords(coords: { x: number; y: number }): number | null };
			}).cm;
			const offset = cm?.posAtCoords({ x: drag.clientX, y: drag.clientY });
			if (offset != null) {
				try {
					editor.setCursor(editor.offsetToPos(offset));
				} catch {
					/* 落点解析失败则使用当前光标 */
				}
			}
		}

		await insertImages(plugin, files, editor, info);
	} catch (err) {
		console.error("[feishu-lite] 图片粘贴处理失败", err);
		new Notice("Feishu Lite：图片保存失败，请检查控制台");
	}
}

function extractImageFiles(evt: ClipboardEvent | DragEvent): File[] {
	const dt = (evt as ClipboardEvent).clipboardData ?? (evt as DragEvent).dataTransfer;
	if (!dt) return [];
	const out: File[] = [];
	const push = (f: File | null) => {
		if (f && f.type.startsWith("image/")) out.push(f);
	};
	if (dt.files && dt.files.length > 0) {
		Array.from(dt.files).forEach((f) => push(f));
	} else if (dt.items) {
		Array.from(dt.items).forEach((item) => {
			if (item.kind === "file") push(item.getAsFile());
		});
	}
	return out;
}

function extFromFile(f: File): string {
	const m = /\.([a-zA-Z0-9]+)$/.exec(f.name ?? "");
	if (m) return m[1].toLowerCase();
	const t = f.type.split("/")[1] ?? "png";
	return t === "jpeg" ? "jpg" : t;
}

/** 核心：保存文件并插入内容（两条通道共用），失败自动兜底提示 */
async function insertImages(
	plugin: FeishuLitePlugin,
	files: File[],
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo
): Promise<void> {
	try {
		const file = info.file;
		const sourcePath = file?.path ?? "";
		const noteName = file?.basename ?? "image";
		const app = plugin.app;

		const embeds: string[] = [];
		let i = 1;
		for (const f of files) {
			// 可选：先压缩再保存（失败 / 转后更大 / GIF·SVG 自动回退原图）
			let buf: ArrayBuffer | null = null;
			let ext = extFromFile(f);
			if (plugin.settings.compressOnPaste) {
				const done = await compressImage(f, plugin.settings);
				if (done) {
					buf = done.buf;
					ext = done.ext;
				}
			}
			if (!buf) buf = await f.arrayBuffer();
			const name = buildImageName(plugin.settings.namePattern, noteName, i, ext, plugin.settings.datePattern);
			const path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
			const tfile = await app.vault.createBinary(path, buf);
			embeds.push("!" + app.fileManager.generateMarkdownLink(tfile, sourcePath));
			i++;
		}

		const cur = editor.getCursor();
		const lineText = editor.getLine(cur.line);
		const inQuote = /^\s*>/.test(lineText);
		const emptyQuoteLine = inQuote && lineText.replace(/^\s*>\s*/, "") === "";

		let text: string;
		if (emptyQuoteLine) {
			// 光标正停在空的引用/分栏内容行：整行替换，图片直接落入该块（不产生空单元格）
			text = embeds.map((e) => "> " + e).join("\n");
			editor.replaceRange(text, { line: cur.line, ch: 0 }, { line: cur.line, ch: lineText.length });
			return;
		}
		if (embeds.length >= 2 && plugin.settings.autoGridOnMultiPaste && !inQuote) {
			const cols = Math.min(Math.max(plugin.settings.defaultColumns, 2), 4);
			text = "\n" + toGridBlock(embeds, cols) + "\n";
		} else if (inQuote) {
			// 光标已在 callout / 分栏内：只加引用前缀，避免嵌套
			text = "\n" + embeds.map((e) => "> " + e).join("\n");
		} else {
			text = embeds.join("\n");
		}
		editor.replaceSelection(text);
	} catch (err) {
		console.error("[feishu-lite] 图片保存失败", err);
		new Notice("Feishu Lite：图片保存失败，请检查控制台");
	}
}
