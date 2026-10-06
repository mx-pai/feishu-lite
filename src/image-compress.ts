import type { FlSettings } from "./settings";

/**
 * 粘贴时图片压缩（炼化 image-converter 的常用切片）：
 * 走 canvas 重编码，支持 WebP / JPEG 与最长边等比缩小。
 * 任何失败、体积没变小、或不可压缩类型（GIF / SVG 等）一律返回 null → 调用方使用原图（P1 兜底）。
 * 动态图（APNG / 动画 WebP）与超大文件同样跳过：canvas 只画首帧，会把动效拍平。
 */

export interface CompressResult {
	buf: ArrayBuffer;
	ext: string;
}

const COMPRESSIBLE = ["png", "jpg", "jpeg", "webp", "bmp"];

/** 输入体积上限：再大就不值得解码 + 重编码（内存与耗时都失控）（E5） */
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
/** 画布边长安全上限：maxEdge 为 0（不限）时也不能生成浏览器扛不住的画布（E5） */
const MAX_CANVAS_EDGE = 16384;

export async function compressImage(file: File, s: FlSettings): Promise<CompressResult | null> {
	try {
		const srcExt = (file.name.split(".").pop() ?? "").toLowerCase();
		if (!COMPRESSIBLE.includes(srcExt)) return null;
		// 超大文件直接跳过压缩，保留原图（E5）
		if (file.size > MAX_INPUT_BYTES) return null;

		// 动态图（APNG / 动画 WebP）：canvas 只能画首帧，压缩会把动效拍平，直接放行原图（E4）
		const data = await file.arrayBuffer();
		if (isAnimatedImage(data)) return null;

		const source = await loadSource(file);
		if (!source) return null;
		try {
			const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
			const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
			if (!width || !height) return null;

			let w = width;
			let h = height;
			const maxEdge = Math.max(0, s.compressMaxEdge || 0);
			const limit = maxEdge > 0 ? Math.min(maxEdge, MAX_CANVAS_EDGE) : MAX_CANVAS_EDGE;
			if (Math.max(w, h) > limit) {
				const k = limit / Math.max(w, h);
				w = Math.max(1, Math.round(w * k));
				h = Math.max(1, Math.round(h * k));
			}

			const canvas = createEl("canvas");
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			ctx.drawImage(source, 0, 0, w, h);

			const mime = s.compressFormat === "jpeg" ? "image/jpeg" : "image/webp";
			const q = Math.min(100, Math.max(1, s.compressQuality || 80)) / 100;
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q));
			if (!blob) return null;

			// 没变小（或只小了一点点）：保留原图，别帮倒忙
			if (blob.size >= file.size * 0.98) return null;
			return { buf: await blob.arrayBuffer(), ext: s.compressFormat === "jpeg" ? "jpg" : "webp" };
		} finally {
			// ImageBitmap 不 close 会一直占着解码后的像素内存（E5）；老实现没有 close，能力检测兼容
			const closable = source as { close?: () => void };
			if (typeof closable.close === "function") {
				try {
					closable.close();
				} catch {
					/* 忽略 */
				}
			}
		}
	} catch (err) {
		console.error("[feishu-lite] 图片压缩失败，使用原图", err);
		return null;
	}
}

/**
 * 是否动态图（APNG / 动画 WebP）：按容器块表精确解析，不用脏扫描（不会把像素数据里的
 * 偶然字节当成 acTL / ANIM）。PNG 的 acTL 必须出现在 IDAT 之前；WebP 出现 ANIM 块即为动画。
 */
export function isAnimatedImage(buf: ArrayBuffer): boolean {
	const b = new Uint8Array(buf);
	// PNG：89 50 4E 47 0D 0A 1A 0A
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return pngAnimated(b);
	// WebP：RIFF....WEBP
	if (
		b.length >= 12 &&
		b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
		b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
	) {
		return webpAnimated(b);
	}
	return false;
}

/** PNG 块表：length(4, BE) + type(4) + data + crc(4) */
function pngAnimated(b: Uint8Array): boolean {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let p = 8;
	while (p + 8 <= b.length) {
		const len = view.getUint32(p);
		if (len > b.length) return false; // 长度离谱（截断 / 损坏）：块表不可信，不再往下解析
		const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
		if (type === "acTL") return true;
		if (type === "IDAT" || type === "IEND") return false; // acTL 只可能在这之前
		p += 12 + len;
	}
	return false;
}

/** WebP 块表：fourcc(4) + size(4, LE) + data + 奇数长度补 1 字节 */
function webpAnimated(b: Uint8Array): boolean {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let p = 12;
	while (p + 8 <= b.length) {
		const len = view.getUint32(p + 4, true);
		if (len > b.length) return false; // 长度离谱（截断 / 损坏）：块表不可信，不再往下解析
		const fourcc = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
		if (fourcc === "ANIM") return true;
		p += 8 + len + (len & 1);
	}
	return false;
}

async function loadSource(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
	try {
		if (typeof createImageBitmap === "function") return await createImageBitmap(file);
	} catch {
		/* createImageBitmap 失败则走 <img> 兜底 */
	}
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}
