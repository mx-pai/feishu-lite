/**
 * 链接卡片 —— 渲染 / 插入 / 刷新（`> [!link-card]` → 卡片）。
 *
 * - 渲染不联网：卡片数据物化在笔记里（字段行，见 link-card-core.ts），阅读视图离线可看
 * - 只有三个明确动作会请求目标网页：「链接卡片：插入 / 刷新 / 重新抓取」；配图下载随插入发生（可关）
 * - 纯逻辑（字段解析 / 构建 / 合并 / 版式 / 命名）都在 link-card-core.ts，本文件只管 Obsidian 层
 */
import { Editor, MarkdownPostProcessorContext, Notice, TFile, requestUrl } from "obsidian";
import type { App, EditorPosition, MarkdownFileInfo, MarkdownView } from "obsidian";
import type FeishuLitePlugin from "./main";
import { createAttachment } from "./image-paste";
import {
	buildCardLines,
	cardImageName,
	cardImageNameFromUrl,
	cleanMetaText,
	expandBlockReplacement,
	fieldOf,
	hostnameOf,
	isHttpUrl,
	mergeCardLines,
	normalizeUrlInput,
	parseCardLines,
	positionAfterInsert,
	resolveCardLayout,
	sniffImageExt,
	stripQuote,
	writeCardLines,
} from "./link-card-core";
import type { CardLine, CardMeta } from "./link-card-core";

const CARD_CALLOUT = "link-card";
const CARD_HEAD_RE = /^\s*>\s*\[!link-card\][+-]?\s*$/i;
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/* ================= 阅读视图渲染 ================= */

/** 阅读视图：把每个 > [!link-card] callout 渲染成卡片（没有可用 url 时保持 callout 原样，至少可读） */
export function linkCardPostProcessor(el: HTMLElement, _ctx: MarkdownPostProcessorContext, plugin: FeishuLitePlugin): void {
	if (!plugin.settings.linkCard) return;
	el.querySelectorAll<HTMLElement>(`.callout[data-callout="${CARD_CALLOUT}"]`).forEach((callout) => {
		const content = callout.querySelector<HTMLElement>(".callout-content");
		if (!content || content.querySelector(":scope > .fl-linkcard")) return; // 幂等保护
		const card = buildCardEl(plugin, parseCardLines(domLines(content)), _ctx.sourcePath);
		if (!card) return;
		content.empty();
		content.appendChild(card);
	});
}

/** DOM → 文本行：文本节点原样收集，<br> 还原为换行（阅读视图的软换行在 DOM 里就是 <br>） */
function domLines(root: HTMLElement): string[] {
	let text = "";
	const walk = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.nodeValue ?? "";
			return;
		}
		if (node instanceof HTMLElement && node.tagName === "BR") {
			text += "\n";
			return;
		}
		node.childNodes.forEach(walk);
	};
	walk(root);
	return text.split("\n");
}

/** 字段行 → 卡片 DOM；url 缺失 / 非法时返回 null */
function buildCardEl(plugin: FeishuLitePlugin, lines: CardLine[], sourcePath: string): HTMLElement | null {
	const url = normalizeUrlInput(fieldOf(lines, "url"));
	if (!url) return null;
	const site = fieldOf(lines, "site") || hostnameOf(url) || url;
	const title = fieldOf(lines, "title") || site;
	const desc = fieldOf(lines, "description");
	const imageValue = fieldOf(lines, "image");
	const imageSrc = imageValue ? resolveImageSrc(plugin, imageValue, sourcePath) : null;
	const layout = resolveCardLayout(fieldOf(lines, "layout"), !!imageSrc);

	const card = createDiv({ cls: "fl-linkcard" });
	card.dataset.layout = layout;
	const hit = card.createEl("a", { cls: "fl-linkcard-hit external-link" });
	hit.setAttr("href", url);
	hit.setAttr("target", "_blank");
	hit.setAttr("rel", "noopener noreferrer");

	if (layout === "large" && imageSrc) {
		const cover = hit.createDiv({ cls: "fl-linkcard-cover" });
		appendSafeImage(cover, imageSrc, () => cover.remove());
	}

	const main = hit.createDiv({ cls: "fl-linkcard-main" });
	main.createDiv({ cls: "fl-linkcard-title", text: title });
	if (desc) main.createDiv({ cls: "fl-linkcard-desc", text: desc });
	const foot = main.createDiv({ cls: "fl-linkcard-foot" });
	appendFavicon(foot, fieldOf(lines, "favicon"), site);
	foot.createSpan({ cls: "fl-linkcard-site", text: site });

	if (layout === "compact" && imageSrc) {
		const thumb = hit.createDiv({ cls: "fl-linkcard-thumb" });
		appendSafeImage(thumb, imageSrc, () => thumb.remove());
	}
	return card;
}

/** 图片字段 → 可显示的 src：http(s) 原样；库内路径解析成资源地址；无效返回 null */
function resolveImageSrc(plugin: FeishuLitePlugin, value: string, sourcePath: string): string | null {
	const v = value.trim();
	if (isHttpUrl(v)) return v;
	const dest = plugin.app.metadataCache.getFirstLinkpathDest(v, sourcePath) ?? plugin.app.vault.getAbstractFileByPath(v);
	if (dest instanceof TFile) return plugin.app.vault.getResourcePath(dest);
	return null;
}

/** 挂图片：加载失败就把宿主移除（永不出裂图） */
function appendSafeImage(host: HTMLElement, src: string, onFail: () => void): void {
	const img = host.createEl("img");
	img.src = src;
	img.alt = "";
	img.referrerPolicy = "no-referrer";
	img.onerror = () => onFail();
}

/** 站点图标：favicon 图 + 加载失败回落「首字母方块」；无 favicon 直接方块 */
function appendFavicon(foot: HTMLElement, favicon: string, site: string): void {
	const glyph = (): HTMLElement => foot.createSpan({ cls: "fl-linkcard-glyph", text: (site.trim()[0] ?? "?").toUpperCase() });
	if (!favicon || !isHttpUrl(favicon)) {
		glyph();
		return;
	}
	const img = foot.createEl("img", { cls: "fl-linkcard-favicon" });
	img.src = favicon;
	img.alt = "";
	img.referrerPolicy = "no-referrer";
	img.onerror = () => {
		img.remove();
		glyph();
	};
}

/* ================= 抓取（只在插入 / 刷新时发生） ================= */

/** 抓网页 → 卡片元数据：requestUrl + charset 解码 + DOMParser，og / twitter / html 三级回落（标题链接选项也复用） */
export async function fetchLinkCardMeta(url: string): Promise<CardMeta> {
	const res = await requestUrl({
		url,
		throw: false,
		headers: {
			"User-Agent": UA,
			Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
			"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
		},
	});
	if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
	let html = res.text;
	// 响应头 / 页面 meta 里的 charset（gbk 等中文站不乱码，与剪藏同一套处理）
	const ct = String(res.headers?.["content-type"] ?? "");
	const cs =
		/charset=["']?([\w-]+)/i.exec(ct)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(html.slice(0, 4096))?.[1];
	if (cs && !/^utf-?8$/i.test(cs)) {
		try {
			html = new TextDecoder(cs).decode(res.arrayBuffer);
		} catch {
			/* 不支持的编码名：保持 requestUrl 解出的文本 */
		}
	}
	const doc = new DOMParser().parseFromString(html, "text/html");
	const q = (selector: string): string => doc.querySelector(selector)?.getAttribute("content") ?? "";
	const pick = (...values: string[]): string => values.find((v) => v.trim()) ?? "";
	const title = cleanMetaText(
		pick(
			q('meta[property="og:title"]'),
			q('meta[name="og:title"]'),
			q('meta[name="twitter:title"]'),
			doc.querySelector("title")?.textContent ?? ""
		),
		160
	);
	const description = cleanMetaText(
		pick(
			q('meta[property="og:description"]'),
			q('meta[name="og:description"]'),
			q('meta[name="twitter:description"]'),
			q('meta[name="description"]')
		),
		400
	);
	const site = cleanMetaText(pick(q('meta[property="og:site_name"]'), q('meta[name="og:site_name"]'))) || hostnameOf(url);
	const image = absUrl(
		pick(
			q('meta[property="og:image"]'),
			q('meta[name="og:image"]'),
			q('meta[name="twitter:image"]'),
			q('meta[name="twitter:image:src"]'),
			doc.querySelector('link[rel="image_src"]')?.getAttribute("href") ?? ""
		),
		url
	);
	const favicon = absUrl(
		pick(
			doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ?? "",
			doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? ""
		) || "/favicon.ico",
		url
	);
	return { title, description, site, image, favicon };
}

/** 相对地址 → 绝对 http(s)；解析失败 / 非 http(s) 返回空串 */
function absUrl(href: string, base: string): string {
	const h = (href ?? "").trim();
	if (!h) return "";
	try {
		const u = new URL(h, base);
		return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
	} catch {
		return "";
	}
}

/** 下载卡片配图进附件目录；失败返回 null（调用方保留远程地址兜底） */
async function downloadCardImage(app: App, imageUrl: string, pageUrl: string, sourcePath: string): Promise<string | null> {
	// 同图重复刷新 / 重复插入：URL 能推出确定性文件名且附件已存在 → 直接复用，不重复下载
	const knownName = cardImageNameFromUrl(imageUrl);
	if (knownName) {
		const existing =
			app.metadataCache.getFirstLinkpathDest(knownName, sourcePath) ?? app.vault.getAbstractFileByPath(knownName);
		if (existing instanceof TFile) return existing.path;
	}
	let referer = "";
	try {
		referer = `${new URL(pageUrl).origin}/`;
	} catch {
		/* 不带 Referer */
	}
	const tries: Array<Record<string, string>> = referer
		? [
				{ "User-Agent": UA, Referer: referer },
				{ "User-Agent": UA },
			]
		: [{ "User-Agent": UA }];
	let res = null;
	for (const headers of tries) {
		try {
			res = await requestUrl({ url: imageUrl, headers, throw: false });
		} catch {
			res = null;
		}
		if (res && res.status < 400) break;
	}
	if (!res || res.status >= 400) return null;
	const buf = res.arrayBuffer;
	const ct = String(res.headers?.["content-type"] ?? "");
	if (!/^image\//i.test(ct) && !sniffImageExt(new Uint8Array(buf))) return null; // 返回的不是图片（多为错误页）
	try {
		return (await createAttachment(app, cardImageName(imageUrl, new Uint8Array(buf), ct), sourcePath, buf)).path;
	} catch {
		return null;
	}
}

/* ================= 插入 / 刷新 ================= */

/** URL 来源：选中文本 → 剪贴板（都要求是单独的一条链接） */
async function pickUrl(editor: Editor): Promise<{ url: string; fromSelection: boolean } | null> {
	const fromSelection = normalizeUrlInput(editor.getSelection());
	if (fromSelection) return { url: fromSelection, fromSelection: true };
	let clip = "";
	try {
		clip = (await navigator.clipboard.readText()) ?? "";
	} catch {
		clip = "";
	}
	const url = normalizeUrlInput(clip);
	return url ? { url, fromSelection: false } : null;
}

/** 抓取 + 配图本地化 → 卡片字段行（命令与粘贴选择共用）；抓取失败抛错，由调用方兜底 */
async function fetchCardEntries(plugin: FeishuLitePlugin, url: string, sourcePath: string): Promise<CardLine[]> {
	const meta = await fetchLinkCardMeta(url);
	const data: { url: string } & CardMeta = { url };
	data.title = meta.title;
	data.description = meta.description;
	data.site = meta.site;
	data.favicon = meta.favicon;
	if (meta.image) {
		const local = plugin.settings.linkCardLocalizeImage
			? await downloadCardImage(plugin.app, meta.image, url, sourcePath)
			: null;
		data.image = local ?? meta.image;
	}
	return buildCardLines(data);
}

/** 卡片块文本（callout 首行 + 字段行） */
function cardBlockText(entries: CardLine[]): string {
	return ["> [!link-card]", ...writeCardLines(entries)].join("\n");
}

/** 在指定区间插入链接卡片（粘贴选择菜单用）；抓取失败兜底插入基础卡片，粘贴内容永不被吞 */
export async function insertCardAt(
	plugin: FeishuLitePlugin,
	editor: Editor,
	url: string,
	sourcePath: string,
	from: EditorPosition,
	to: EditorPosition
): Promise<void> {
	const notice = new Notice("链接卡片：正在抓取页面信息…", 0);
	let entries: CardLine[];
	let fetchFailed = "";
	try {
		entries = await fetchCardEntries(plugin, url, sourcePath);
	} catch (e) {
		fetchFailed = errText(e);
		entries = buildCardLines({ url });
	}
	notice.hide();
	replaceWithCardBlock(editor, from, to, cardBlockText(entries));
	if (fetchFailed) {
		new Notice(`链接卡片：抓取失败（${fetchFailed}）；已插入基础卡片，可用命令「链接卡片：刷新」补全`);
	}
}

/** 卡片块替换 [from,to)：单行时整行替换（行内转换拆出句首句尾——callout 必须从行首开始才能渲染）；跨行选区直接换块 */
function replaceWithCardBlock(editor: Editor, from: EditorPosition, to: EditorPosition, block: string): void {
	if (from.line === to.line) {
		const lineText = editor.getLine(from.line);
		const lineStart: EditorPosition = { line: from.line, ch: 0 };
		const text = expandBlockReplacement(lineText, from.ch, to.ch, block);
		editor.replaceRange(text, lineStart, { line: from.line, ch: lineText.length });
		editor.setCursor(positionAfterInsert(lineStart, text));
		return;
	}
	editor.replaceRange(block, from, to);
	editor.setCursor(positionAfterInsert(from, block));
}

async function insertLinkCard(plugin: FeishuLitePlugin, editor: Editor, sourcePath: string): Promise<void> {
	const pick = await pickUrl(editor);
	if (!pick) {
		new Notice("链接卡片：先选中一条 http(s) 链接，或把链接复制到剪贴板");
		return;
	}
	const selFrom = pick.fromSelection ? editor.getCursor("from") : null;
	const selTo = pick.fromSelection ? editor.getCursor("to") : null;
	const notice = new Notice("链接卡片：正在抓取页面信息…", 0);
	let entries: CardLine[];
	let fetchFailed = "";
	try {
		entries = await fetchCardEntries(plugin, pick.url, sourcePath);
	} catch (e) {
		fetchFailed = errText(e);
		entries = buildCardLines({ url: pick.url });
	}
	notice.hide();
	if (selFrom && selTo) replaceWithCardBlock(editor, selFrom, selTo, cardBlockText(entries));
	else insertCardBlock(editor, entries);
	if (fetchFailed) {
		new Notice(`链接卡片：抓取失败（${fetchFailed}）；已插入基础卡片，可用命令「链接卡片：刷新」补全`);
	}
}

/** 插入卡片块（剪贴板路径）：光标行有内容就另起一行，空行直接落块 */
function insertCardBlock(editor: Editor, entries: CardLine[]): void {
	const block = cardBlockText(entries);
	const line = editor.getLine(editor.getCursor().line);
	editor.replaceSelection(line.trim() ? `\n${block}\n` : `${block}\n`);
}

/** 光标所在卡片块（首行 > [!link-card]，向下吃到连续引用行） */
function findCardBlockAtCursor(editor: Editor): { start: number; end: number; lines: string[] } | null {
	const last = editor.lastLine();
	const cursorLine = editor.getCursor().line;
	let start = -1;
	for (let i = cursorLine; i >= 0; i--) {
		const t = editor.getLine(i);
		if (CARD_HEAD_RE.test(t)) {
			start = i;
			break;
		}
		if (!/^\s*>/.test(t)) break;
	}
	if (start < 0) return null;
	let end = start;
	while (end < last && /^\s*>/.test(editor.getLine(end + 1))) end++;
	const lines: string[] = [];
	for (let i = start + 1; i <= end; i++) lines.push(stripQuote(editor.getLine(i)));
	return { start, end, lines };
}

async function refreshLinkCard(plugin: FeishuLitePlugin, editor: Editor, sourcePath: string, mode: "fill" | "refetch"): Promise<void> {
	const block = findCardBlockAtCursor(editor);
	if (!block) {
		new Notice("链接卡片：光标不在某张链接卡片内（卡片首行是 > [!link-card]）");
		return;
	}
	const lines = parseCardLines(block.lines);
	const url = normalizeUrlInput(fieldOf(lines, "url"));
	if (!url) {
		new Notice("链接卡片：这张卡片没有可用的 url 字段，无法刷新");
		return;
	}
	const notice = new Notice("链接卡片：正在抓取最新信息…", 0);
	let meta: CardMeta;
	try {
		meta = await fetchLinkCardMeta(url);
	} catch (e) {
		notice.hide();
		new Notice(`链接卡片：刷新失败（${errText(e)}）`);
		return;
	}
	// 配图本地化：本次合并将写入 image（fill 补空缺 / refetch 覆盖远程）且开启下载时，先存附件目录（失败保留远程）
	const curImage = fieldOf(lines, "image");
	if (
		meta.image &&
		plugin.settings.linkCardLocalizeImage &&
		(mode === "fill" ? !curImage : !curImage || isHttpUrl(curImage))
	) {
		const local = await downloadCardImage(plugin.app, meta.image, url, sourcePath);
		if (local) meta.image = local;
	}
	notice.hide();
	const merged = mergeCardLines(lines, meta, mode);
	const head = editor.getLine(block.start);
	const indent = /^\s*/.exec(head)?.[0] ?? "";
	const text = [head, ...writeCardLines(merged, `${indent}> `)].join("\n");
	editor.replaceRange(text, { line: block.start, ch: 0 }, { line: block.end, ch: editor.getLine(block.end).length });
	editor.setCursor({ line: block.start, ch: 0 });
	new Notice(mode === "fill" ? "链接卡片：已刷新（补齐缺失字段）" : "链接卡片：已重新抓取（本地配图保留）");
}

/* ================= 注册 ================= */

export function registerLinkCard(plugin: FeishuLitePlugin): void {
	plugin.registerMarkdownPostProcessor((el, ctx) => linkCardPostProcessor(el, ctx, plugin));

	const guard =
		(fn: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => Promise<void>) =>
		(editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
			if (!plugin.settings.linkCard) {
				new Notice("链接卡片功能已在设置里关闭（设置 → Feishu Lite → 阅读 · 链接卡片）");
				return;
			}
			fn(editor, info).catch((e) => {
				console.error("feishu-lite: link card failed", e);
				new Notice(`链接卡片出错：${errText(e)}`);
			});
		};

	plugin.addCommand({
		id: "link-card-insert",
		name: "链接卡片：插入（选中 / 剪贴板链接）",
		editorCallback: guard((editor, info) => insertLinkCard(plugin, editor, info.file?.path ?? "")),
	});
	plugin.addCommand({
		id: "link-card-refresh",
		name: "链接卡片：刷新（补齐缺失字段）",
		editorCallback: guard((editor, info) => refreshLinkCard(plugin, editor, info.file?.path ?? "", "fill")),
	});
	plugin.addCommand({
		id: "link-card-refetch",
		name: "链接卡片：重新抓取（覆盖字段，本地配图保留）",
		editorCallback: guard((editor, info) => refreshLinkCard(plugin, editor, info.file?.path ?? "", "refetch")),
	});
}
