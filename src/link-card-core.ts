/**
 * 链接卡片 —— 纯逻辑层（零 obsidian 依赖，node 直接可测；测试见 tests/link-card.test.mjs）。
 *
 * 卡片语法：`> [!link-card]` callout + 字段行（可手改；只有 url 是必填）：
 *
 *   > [!link-card]
 *   > url: https://www.investor.gov/
 *   > title: Investor.gov
 *   > description: 美国 SEC 的投资者教育门户
 *   > site: investor.gov
 *   > image: 附件/link-card-1a2b3c4d.png
 *   > favicon: https://www.investor.gov/favicon.ico
 *   > layout: large
 *
 * 数据物化在笔记里（阅读离线可看）；只有「插入 / 刷新」动作才联网抓取。
 * 字段行以外的行原样保留（刷新时不丢手写说明）；未知字段同样保留、忽略。
 */

/** 卡片版式：large 顶部大图 / compact 右侧缩略图 / text 纯文字（favicon + 标题 + 站点） */
export type LinkCardLayout = "large" | "compact" | "text";

/** 抓取到的元数据（各字段可缺省） */
export interface CardMeta {
	title?: string;
	description?: string;
	site?: string;
	image?: string;
	favicon?: string;
}

/** 完整卡片数据：url 必填 */
export interface CardData extends CardMeta {
	url: string;
}

/** 解析后的一行：字段行（key: value）或原样保留的行（手写说明等） */
export type CardLine = { key: string; value: string } | { raw: string };

const FIELD_RE = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/;

/** 文案清洗：控制符转空格、连续空白折叠；max > 0 时截断加省略号 */
export function cleanMetaText(value: string, max = 0): string {
	const t = (value ?? "")
		.replace(/[\u0000-\u001f\u007f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return max > 0 && t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** 引用前缀（"> "）→ 原文（无前缀时原样返回） */
export function stripQuote(line: string): string {
	return line.replace(/^\s*>\s?/, "");
}

/** 字段行文本（不含引用前缀）→ 行模型 */
export function parseCardLines(lines: string[]): CardLine[] {
	return lines.map((line) => {
		const t = line.trim();
		const m = t ? FIELD_RE.exec(t) : null;
		return m && m[1] ? { key: m[1], value: m[2] ?? "" } : { raw: line };
	});
}

/** 取字段值（键名不区分大小写；缺省 / 空值都返回空串） */
export function fieldOf(lines: CardLine[], key: string): string {
	const k = key.toLowerCase();
	for (const line of lines) {
		if ("key" in line && line.key.toLowerCase() === k) return line.value.trim();
	}
	return "";
}

/** 构建卡片字段行：固定顺序 url / title / description / site / image / favicon / layout；空值省略，layout 仅在显式指定时写入 */
export function buildCardLines(data: CardData, layout = ""): CardLine[] {
	const out: CardLine[] = [];
	const push = (key: string, value: string | undefined): void => {
		const v = (value ?? "").trim();
		if (v) out.push({ key, value: v });
	};
	push("url", data.url);
	push("title", data.title);
	push("description", data.description);
	push("site", data.site);
	push("image", data.image);
	push("favicon", data.favicon);
	const l = layout.trim().toLowerCase();
	if (l === "large" || l === "compact" || l === "text") out.push({ key: "layout", value: l });
	return out;
}

/** 行模型 → 引用块文本行（quotePrefix 兼容列表内缩进；空行输出裸 ">"） */
export function writeCardLines(lines: CardLine[], quotePrefix = "> "): string[] {
	return lines.map((line) => {
		if (!("key" in line)) return line.raw.trim() ? `${quotePrefix}${line.raw.trim()}` : quotePrefix.trimEnd();
		return `${quotePrefix}${line.key}: ${line.value}`;
	});
}

const MERGE_KEYS = ["title", "description", "site", "image", "favicon"] as const;

/**
 * 合并抓取结果进现有行模型：
 * - fill：只补缺失 / 空的字段（保留手改）
 * - refetch：覆盖已有字段；但页面没给该字段时保留现值，image 已是本地路径时也不覆盖（防重复下载）
 */
export function mergeCardLines(lines: CardLine[], fresh: CardMeta, mode: "fill" | "refetch"): CardLine[] {
	const out: CardLine[] = lines.map((line) => ({ ...line }));
	for (const key of MERGE_KEYS) {
		const v = (fresh[key] ?? "").trim();
		if (!v) continue;
		const idx = out.findIndex((line) => "key" in line && line.key.toLowerCase() === key);
		if (idx < 0) {
			out.push({ key, value: v });
			continue;
		}
		const cur = out[idx];
		if (!("key" in cur)) continue;
		if (mode === "fill" && cur.value.trim()) continue;
		if (key === "image" && mode === "refetch" && cur.value.trim() && !/^https?:/i.test(cur.value.trim())) continue;
		out[idx] = { key: cur.key, value: v };
	}
	return out;
}

/** 版式解析：显式合法值优先；auto / 缺省 = 有图紧凑、无图纯文字 */
export function resolveCardLayout(layout: string, hasImage: boolean): LinkCardLayout {
	const v = (layout ?? "").trim().toLowerCase();
	if (v === "large" || v === "compact" || v === "text") return v;
	return hasImage ? "compact" : "text";
}

/** 单独一条链接（选中 / 剪贴板输入）→ 规范化 URL；不是「单独的一条 http(s) 链接」时返回 null */
export function normalizeUrlInput(input: string): string | null {
	let t = (input ?? "").trim();
	const wrapped = /^<(.+)>$/.exec(t);
	if (wrapped) t = wrapped[1].trim();
	if (!t || /\s/.test(t)) return null;
	try {
		const u = new URL(t);
		if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
	} catch {
		/* 非法地址 */
	}
	return null;
}

/** 显示用主机名（去掉 www.；解析失败返回空串） */
export function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, "");
	} catch {
		return "";
	}
}

/** 是否为 http(s) 地址 */
export function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test((value ?? "").trim());
}

/** FNV-1a 双种子短哈希（8 位十六进制；图片命名用） */
export function shortHash(s: string): string {
	const fnv = (seed: number): number => {
		let h = seed;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
		return h >>> 0;
	};
	const a = fnv(0x811c9dc5).toString(16).padStart(8, "0");
	const b = fnv(0x9e3779b9 ^ s.length).toString(16).padStart(8, "0");
	return a.slice(0, 4) + b.slice(0, 4);
}

/** 图片魔数嗅探（URL 无扩展名时的兜底） */
export function sniffImageExt(buf: Uint8Array): string | null {
	const at = (i: number): number => buf[i] ?? 0;
	if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return ".png";
	if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return ".jpg";
	if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return ".gif";
	if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) {
		return ".webp";
	}
	if (at(0) === 0x42 && at(1) === 0x4d) return ".bmp";
	if (at(0) === 0x3c) return ".svg"; // "<"：多为 SVG（上层还有 content-type 检查兜错误页）
	return null;
}

function byContentType(ct: string): string | null {
	const c = (ct ?? "").toLowerCase();
	if (/image\/png/.test(c)) return ".png";
	if (/image\/jpe?g/.test(c)) return ".jpg";
	if (/image\/webp/.test(c)) return ".webp";
	if (/image\/gif/.test(c)) return ".gif";
	if (/image\/avif/.test(c)) return ".avif";
	if (/image\/svg/.test(c)) return ".svg";
	if (/image\/bmp/.test(c)) return ".bmp";
	return null;
}

/** 从 URL 路径提取图片扩展名（无 / 非法时 null） */
function imageExtFromUrl(url: string): string | null {
	try {
		const m = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.exec(new URL(url).pathname);
		if (m?.[1]) {
			const e = m[1].toLowerCase();
			return e === "jpeg" ? ".jpg" : `.${e}`;
		}
	} catch {
		/* 非法地址：走嗅探 */
	}
	return null;
}

/** URL 已带扩展名时的确定性文件名（用于「同图重复刷新直接复用附件」的查找；无扩展名返回 null） */
export function cardImageNameFromUrl(url: string): string | null {
	const ext = imageExtFromUrl(url);
	return ext ? `link-card-${shortHash(url)}${ext}` : null;
}

/** 卡片配图文件名：link-card-<hash8><ext>（哈希取自图片地址；同址重下撞名由附件层自动让位） */
export function cardImageName(url: string, buf: Uint8Array, contentType: string): string {
	const ext = imageExtFromUrl(url) ?? sniffImageExt(buf) ?? byContentType(contentType) ?? ".png";
	return `link-card-${shortHash(url)}${ext}`;
}
