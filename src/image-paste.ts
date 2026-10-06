import { App, Editor, MarkdownFileInfo, MarkdownView, Notice, TFile, editorInfoField } from "obsidian";
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

/** 保存批次队列（模块级）：两批图片同时保存会互相插队（笔记内顺序 ≠ 粘贴顺序）、
 *  模板不含 {i} 时会算出同一路径导致 createBinary 撞名抛错中断整批（E2 / E3）。 */
let pasteQueue: Promise<unknown> = Promise.resolve();
function serializePaste<T>(task: () => Promise<T>): Promise<T> {
	const run = pasteQueue.then(task, task); // 前一批无论成败都接着跑，队列不会卡死
	pasteQueue = run.catch(() => undefined);
	return run;
}

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

/** 编辑器此刻所属的笔记文件（在 await 之后复查，判断笔记是否已被切走）；读不到返回 null */
function currentEditorFile(editor: Editor): TFile | null {
	try {
		const cm = (editor as unknown as { cm?: EditorView }).cm;
		const info = cm?.state.field(editorInfoField, false);
		return info?.file ?? null;
	} catch {
		return null;
	}
}

/** 保存中途编辑器是否已被切到别的笔记（切走了就绝不能用旧坐标往新笔记里插链接） */
function switchedAway(start: TFile | null, editor: Editor): boolean {
	const now = currentEditorFile(editor);
	return !!start && !!now && now.path !== start.path;
}

/**
 * 保存附件：模板不含 {i}（或多批同时粘贴）时 getAvailablePathForAttachment 可能给出同一个路径，
 * createBinary 会直接抛错、整批中断并留下孤儿附件。撞名就重新取一次可用路径，有限次重试（E2）。
 */
async function createAttachment(app: App, name: string, sourcePath: string, buf: ArrayBuffer): Promise<TFile> {
	let path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
	for (let attempt = 0; ; attempt++) {
		try {
			return await app.vault.createBinary(path, buf);
		} catch (err) {
			if (attempt >= 3) throw err;
			const next = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
			if (next === path) throw err; // 不是撞名（目录 / 权限等）：不空转，交给上层兜底
			path = next;
		}
	}
}

/** 核心：保存文件并插入内容（两条通道共用），失败自动兜底提示；同一时刻只允许一批在跑（E2） */
function insertImages(
	plugin: FeishuLitePlugin,
	files: File[],
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo
): Promise<void> {
	return serializePaste(() => insertImagesCore(plugin, files, editor, info));
}

async function insertImagesCore(
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

		// 批次锚点 = 粘贴 / 拖入时刻的光标，之后每张都从锚点往后推进着插：
		// 不再取「插入时刻」的光标（保存耗时里挪了光标也不会把后续图片插到别处）（E3）
		const anchor = editor.getCursor();
		const anchorLine = editor.getLine(anchor.line);
		const inQuote = /^\s*>/.test(anchorLine);
		const emptyQuoteLine = inQuote && anchorLine.replace(/^\s*>\s*/, "") === "";
		// 多图分栏是整体块，只能全部保存完再插；其余情况一张保存完立刻插一张
		const grid = files.length >= 2 && plugin.settings.autoGridOnMultiPaste && !inQuote;
		let offset = editor.posToOffset(anchor);
		let first = true;

		const embeds: string[] = [];
		let i = 1;
		for (const f of files) {
			// 可选：先压缩再保存（失败 / 转后更大 / 动态图 / GIF·SVG 自动回退原图）
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
			const tfile = await createAttachment(app, name, sourcePath, buf);
			embeds.push("!" + app.fileManager.generateMarkdownLink(tfile, sourcePath));
			i++;

			// 多图 + 压缩时保存可能持续数秒；期间若切走了笔记，链接不插入（已保存的图片留在附件里）
			if (switchedAway(file, editor)) {
				new Notice(`Feishu Lite：图片已保存到附件；已切换到其它笔记，链接未自动插入（原笔记：${file?.basename ?? ""}）`);
				return;
			}
			if (grid) continue;

			// 逐张插入：笔记内顺序 = 粘贴顺序，用户也能即时看到结果（E3）
			if (first && emptyQuoteLine) {
				// 光标正停在空的引用/分栏内容行：整行替换，图片直接落入该块（不产生空单元格）
				const text = "> " + embeds[embeds.length - 1];
				editor.replaceRange(text, { line: anchor.line, ch: 0 }, { line: anchor.line, ch: anchorLine.length });
				offset = editor.posToOffset({ line: anchor.line, ch: 0 }) + text.length;
				editor.setCursor(editor.offsetToPos(offset));
			} else if (first) {
				// 首张仍走 replaceSelection：与既有行为一致（有选区时先替换选区），之后按批内偏移推进
				// 光标已在 callout / 分栏内时加引用前缀（换行 + 「> 」），避免嵌套
				const text = (inQuote ? "\n> " : "") + embeds[embeds.length - 1];
				editor.replaceSelection(text);
				offset = editor.posToOffset(editor.getCursor());
			} else {
				const text = (inQuote ? "\n> " : "\n") + embeds[embeds.length - 1];
				editor.replaceRange(text, editor.offsetToPos(offset));
				offset += text.length;
				editor.setCursor(editor.offsetToPos(offset));
			}
			first = false;
		}
		if (!grid) return;

		// 网格块整体插入，落点仍是粘贴时刻的锚点，而不是「插入时刻」的光标（E3）
		const cols = Math.min(Math.max(plugin.settings.defaultColumns, 2), 4);
		const block = "\n" + toGridBlock(embeds, cols) + "\n";
		editor.replaceRange(block, editor.offsetToPos(offset));
		editor.setCursor(editor.offsetToPos(offset + block.length));
	} catch (err) {
		console.error("[feishu-lite] 图片保存失败", err);
		new Notice("Feishu Lite：图片保存失败，请检查控制台");
	}
}
