import type { FlSettings } from "./settings";

/**
 * 粘贴时图片压缩（炼化 image-converter 的常用切片）：
 * 走 canvas 重编码，支持 WebP / JPEG 与最长边等比缩小。
 * 任何失败、体积没变小、或不可压缩类型（GIF / SVG 等）一律返回 null → 调用方使用原图（P1 兜底）。
 */

export interface CompressResult {
	buf: ArrayBuffer;
	ext: string;
}

const COMPRESSIBLE = ["png", "jpg", "jpeg", "webp", "bmp"];

export async function compressImage(file: File, s: FlSettings): Promise<CompressResult | null> {
	try {
		const srcExt = (file.name.split(".").pop() ?? "").toLowerCase();
		if (!COMPRESSIBLE.includes(srcExt)) return null;

		const source = await loadSource(file);
		if (!source) return null;
		const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
		const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
		if (!width || !height) return null;

		let w = width;
		let h = height;
		const maxEdge = Math.max(0, s.compressMaxEdge || 0);
		if (maxEdge > 0 && Math.max(w, h) > maxEdge) {
			const k = maxEdge / Math.max(w, h);
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
	} catch (err) {
		console.error("[feishu-lite] 图片压缩失败，使用原图", err);
		return null;
	}
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
