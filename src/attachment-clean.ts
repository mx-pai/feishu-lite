import { Notice } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 图片附件自动清理（图床管家，全自动、无面板）：
 * - 候选：「全库无任何引用」且「mtime 超过 24 小时」的图片附件
 * - 引用判定双保险：
 *   1) metadataCache.resolvedLinks（Obsidian 官方索引：md / canvas / frontmatter 链接全覆盖）
 *   2) 文本级兜底：候选存在时把全库文本文件（md / canvas / html / base / txt）读一遍，
 *      任意一处出现文件名（含去扩展名写法）都算被引用——代码块里的文字也覆盖
 * - 清理动作只用 fileManager.trashFile（回收站，跟随 Obsidian「删除文件」设置，绝不直接抹除）
 * - 触发：启动后约 15 秒一次 + 每 24 小时一次（可设置关闭）；命令「维护：清理未引用附件」手动
 */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const TEXT_EXTS = new Set(["md", "canvas", "html", "base", "txt"]);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isHiddenPath(path: string): boolean {
	return path.startsWith(".") || path.includes("/.");
}

function lowerBasename(name: string): string {
	const i = name.lastIndexOf(".");
	return (i > 0 ? name.slice(0, i) : name).toLowerCase();
}

/** 扫一遍并清理；返回被移入回收站的路径列表（未做任何事则返回空数组） */
export async function sweepUnusedAttachments(plugin: FeishuLitePlugin): Promise<string[]> {
	const { vault, fileManager, metadataCache } = plugin.app;

	// 1) 官方链接索引：任一来源（md / canvas / frontmatter）引用过的文件
	const resolved = new Set<string>();
	try {
		for (const links of Object.values(metadataCache.resolvedLinks)) {
			for (const dest of Object.keys(links)) resolved.add(dest);
		}
	} catch (err) {
		console.error("[feishu-lite] resolvedLinks 读取失败，跳过本次清理", err);
		return [];
	}

	// 2) 候选：够老、且不在索引引用里
	const now = Date.now();
	const candidates = vault
		.getFiles()
		.filter((f) => IMAGE_EXTS.has(f.extension.toLowerCase()))
		.filter((f) => !isHiddenPath(f.path))
		.filter((f) => now - f.stat.mtime > MAX_AGE_MS)
		.filter((f) => !resolved.has(f.path));
	if (!candidates.length) return [];

	// 3) 文本级兜底（仅在有候选时才读全库）：读不出任何一篇就整体放弃，绝不冒险
	const sources = vault
		.getFiles()
		.filter((f) => TEXT_EXTS.has(f.extension.toLowerCase()))
		.filter((f) => !isHiddenPath(f.path));
	const texts: string[] = [];
	try {
		for (const f of sources) texts.push((await vault.cachedRead(f)).toLowerCase());
	} catch (err) {
		console.error("[feishu-lite] 文本兜底扫描失败，跳过本次清理", err);
		return [];
	}

	// 4) 连文本里都没出现过的，才算真正无引用
	const toTrash = candidates.filter((f) => {
		const full = f.name.toLowerCase();
		const bare = lowerBasename(f.name);
		return !texts.some((t) => t.includes(full) || t.includes(bare));
	});

	// 5) 移入回收站（trashFile 跟随 Obsidian「删除文件」设置，不做永久删除）
	const trashed: string[] = [];
	for (const f of toTrash) {
		try {
			await fileManager.trashFile(f);
			trashed.push(f.path);
		} catch (err) {
			console.error(`[feishu-lite] 移入回收站失败：${f.path}`, err);
		}
	}
	return trashed;
}

export function registerCleaner(plugin: FeishuLitePlugin): void {
	let sweeping = false;

	const run = async (force: boolean): Promise<void> => {
		if (sweeping) return;
		if (!force && !plugin.settings.autoCleanAttachments) return;
		sweeping = true;
		try {
			const trashed = await sweepUnusedAttachments(plugin);
			if (trashed.length > 0) {
				const names = trashed
					.slice(0, 3)
					.map((p) => p.split("/").pop() ?? p)
					.join("、");
				const more = trashed.length > 3 ? " 等" : "";
				new Notice(`Feishu Lite：已清理 ${trashed.length} 个无引用附件（${names}${more}），可在回收站找回`);
			} else if (force) {
				new Notice("Feishu Lite：没有需要清理的附件");
			}
		} catch (err) {
			console.error("[feishu-lite] 附件清理失败", err);
			if (force) new Notice("Feishu Lite：附件清理失败（详见控制台）");
		} finally {
			sweeping = false;
		}
	};

	plugin.addCommand({
		id: "clean-attachments",
		name: "维护：清理未引用附件",
		callback: () => void run(true),
	});

	// 启动后约 15 秒一次（等库索引就绪），此后每 24 小时复查一次
	plugin.app.workspace.onLayoutReady(() => {
		plugin.registerInterval(window.setTimeout(() => void run(false), 15_000));
	});
	plugin.registerInterval(window.setInterval(() => void run(false), MAX_AGE_MS));
}
