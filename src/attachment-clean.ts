import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type FeishuLitePlugin from "./main";
import { validateProject } from "./image-core";

/**
 * 图片附件自动清理（图床管家，全自动、无面板）：
 * - 候选：「全库无任何引用」且「mtime 超过 24 小时」的图片附件
 * - 引用判定双保险：
 *   1) metadataCache.resolvedLinks（Obsidian 官方索引：md / canvas / frontmatter 链接全覆盖）
 *   2) 文本级兜底：候选存在时把全库文本文件（md / canvas / html / base / txt，含隐藏文件）读一遍，
 *      任意一处出现文件名（含去扩展名写法）都算被引用——代码块里的文字也覆盖
 * - 清理动作走 fileManager.trashFile，实际结果由 Obsidian「删除文件」设置决定：
 *   · 系统回收站 / 库内 .trash → 可找回
 *   · 永久删除（trashOption=none）→ 自动清理整体跳过（绝不自动永久删除文件）；手动命令先弹窗确认，删除不可找回
 * - 触发：启动后约 15 秒一次 + 每 24 小时一次（可设置关闭）；命令「维护：清理未引用附件」手动
 */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const TEXT_EXTS = new Set(["md", "canvas", "html", "base", "txt"]);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isHiddenPath(path: string): boolean {
	return path.startsWith(".") || path.includes("/.");
}

/** Obsidian「删除文件」设置是否为「永久删除」：此时 fileManager.trashFile 会直接抹除文件（不进任何回收站） */
function isPermanentDelete(app: App): boolean {
	try {
		const option = (app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.("trashOption");
		return option === "none";
	} catch {
		return false;
	}
}

function lowerBasename(name: string): string {
	const i = name.lastIndexOf(".");
	return (i > 0 ? name.slice(0, i) : name).toLowerCase();
}

/** 扫一遍并清理；返回被删除的路径列表（未做任何事则返回空数组） */
export async function sweepUnusedAttachments(plugin: FeishuLitePlugin): Promise<string[]> {
	return trashAttachments(plugin, await collectUnusedAttachments(plugin));
}

/** 扫描全库，返回「无任何引用且超过 24 小时」的图片附件（只读，不删除任何东西） */
export async function collectUnusedAttachments(plugin: FeishuLitePlugin): Promise<TFile[]> {
	const { vault, metadataCache } = plugin.app;

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
	// Image edit projects own their original, including originals no longer embedded.
	try {
		for (const project of vault.getFiles().filter(f => f.path.endsWith(".fl-edit.json"))) {
			const data = validateProject(JSON.parse(await vault.read(project)));
			resolved.add(data.original);
		}
	} catch (err) {
		console.error("[feishu-lite] 图片项目读取失败，跳过附件清理", err);
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
	//    含隐藏文件（. 开头）：只被隐藏笔记引用的图同样算被引用，不能被清掉
	const sources = vault
		.getFiles()
		.filter((f) => TEXT_EXTS.has(f.extension.toLowerCase()));
	const texts: string[] = [];
	try {
		for (const f of sources) texts.push((await vault.cachedRead(f)).toLowerCase());
	} catch (err) {
		console.error("[feishu-lite] 文本兜底扫描失败，跳过本次清理", err);
		return [];
	}

	// 4) 连文本里都没出现过的，才算真正无引用
	return candidates.filter((f) => {
		const full = f.name.toLowerCase();
		const bare = lowerBasename(f.name);
		return !texts.some((t) => t.includes(full) || t.includes(bare));
	});
}

/** 清理清单里的附件（trashFile 行为由 Obsidian「删除文件」设置决定，见文件头注释） */
export async function trashAttachments(plugin: FeishuLitePlugin, files: TFile[]): Promise<string[]> {
	const { vault, fileManager } = plugin.app;
	const trashed: string[] = [];
	for (const f of files) {
		// 扫描（永久删除模式下还夹着用户确认）可能耗时很久：删除前按路径重取，不是同一个文件就跳过
		// （原文件已被删除 / 重命名后又有同路径新文件时，绝不误删新文件）
		if (vault.getAbstractFileByPath(f.path) !== f) {
			console.warn(`[feishu-lite] 候选附件已发生变化，跳过：${f.path}`);
			continue;
		}
		try {
			await fileManager.trashFile(f);
			trashed.push(f.path);
		} catch (err) {
			console.error(`[feishu-lite] 附件清理失败：${f.path}`, err);
		}
	}
	return trashed;
}

export function registerCleaner(plugin: FeishuLitePlugin): void {
	let sweeping = false;

	const run = async (force: boolean): Promise<void> => {
		if (sweeping) return;
		if (!force && !plugin.settings.autoCleanAttachments) return;
		const permanent = isPermanentDelete(plugin.app);
		if (permanent && !force) {
			// 「永久删除」设置下 trashFile 会真·抹除文件：自动清理整体跳过，绝不自动永久删除
			console.warn(
				"[feishu-lite] Obsidian「删除文件」设置为「永久删除」，已跳过附件自动清理（避免自动永久删除文件）；如需清理请手动执行命令「维护：清理未引用附件」，会先弹窗确认"
			);
			return;
		}
		sweeping = true;
		try {
			const files = await collectUnusedAttachments(plugin);
			if (files.length === 0) {
				if (force) new Notice("Feishu Lite：没有需要清理的附件");
				return;
			}
			if (permanent) {
				const warnNames = files.slice(0, 3).map((f) => f.name).join("、");
				const warnMore = files.length > 3 ? " 等" : "";
				const ok = await plugin.confirmAction(
					"清理未引用附件",
					`Obsidian「删除文件」当前设置为「永久删除」：本次将永久删除 ${files.length} 个无引用附件（${warnNames}${warnMore}），不进回收站、无法找回。确定继续？`
				);
				if (!ok) return;
			}
			const trashed = await trashAttachments(plugin, files);
			if (trashed.length === 0) {
				if (force) new Notice("Feishu Lite：没有需要清理的附件");
				return;
			}
			const names = trashed
				.slice(0, 3)
				.map((p) => p.split("/").pop() ?? p)
				.join("、");
			const more = trashed.length > 3 ? " 等" : "";
			new Notice(
				permanent
					? `Feishu Lite：已永久删除 ${trashed.length} 个无引用附件（${names}${more}），不进回收站、无法找回`
					: `Feishu Lite：已清理 ${trashed.length} 个无引用附件（${names}${more}），可在回收站找回`
			);
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
