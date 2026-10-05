import { formatTime, isImagePath, sanitizeFileName } from "./util";

export type DateStyle = "compact" | "dash" | "short";

/** {date} 变量的日期写法：compact=20261003 · dash=2026-10-03 · short=261003 */
export function formatDateStyle(d: Date, style: DateStyle): string {
	const p = (n: number) => (n < 10 ? "0" + n : String(n));
	if (style === "dash") return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	if (style === "short") return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export interface ParsedImage {
	/** 归一化后的嵌入（去掉尺寸，保留 alt） */
	embed: string;
}

const WIKI_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/;
const MD_RE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const SIZE_RE = /^\d+(?:x\d+)?$/;
const HTTP_RE = /^https?:\/\//i;

/** 按模板生成图片文件名（不含扩展名） */
export function buildImageName(
	pattern: string,
	note: string,
	index: number,
	ext: string,
	dateStyle: DateStyle = "compact"
): string {
	const now = new Date();
	const base = pattern
		.replace(/\{note\}/gi, sanitizeFileName(note || "image"))
		.replace(/\{date\}/gi, formatDateStyle(now, dateStyle))
		.replace(/\{time\}/gi, formatTime(now))
		.replace(/\{i\}/gi, String(index));
	return `${sanitizeFileName(base)}.${ext}`;
}

/**
 * 判断一行是否“恰好是一个图片嵌入”，是则返回去掉尺寸后的标准嵌入。
 * 支持：![[图.png|alt|300x200]]、![[图.png|300]]、![alt](path)
 */
export function parseImageLine(line: string): ParsedImage | null {
	const metadata = /\s*%%fl-image:.*?%%\s*$/.exec(line)?.[0] ?? "";
	if (metadata) line = line.slice(0, line.length - metadata.length);
	const wiki = WIKI_RE.exec(line);
	if (wiki) {
		const parts = wiki[1].split("|");
		const target = (parts.shift() ?? "").trim();
		if (!target) return null;
		if (!HTTP_RE.test(target) && !isImagePath(target)) return null;
		if (parts.length && SIZE_RE.test((parts[parts.length - 1] ?? "").trim())) {
			parts.pop();
		}
		const alt = parts.join("|").trim();
		return { embed: (alt ? `![[${target}|${alt}]]` : `![[${target}]]`) + metadata };
	}
	const md = MD_RE.exec(line);
	if (md) {
		const alt = (md[1] ?? "").trim();
		const path = (md[2] ?? "").trim();
		return { embed: `![${alt}](${path})` + metadata };
	}
	return null;
}

/** 生成图片分栏 callout 文本块 */
export function toGridBlock(embeds: string[], cols: number): string {
	const c = Math.min(Math.max(cols, 2), 4);
	return [`> [!img-${c}]`, ...embeds.map((e) => `> ${e}`)].join("\n");
}
