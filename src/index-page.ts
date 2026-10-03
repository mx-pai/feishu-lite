import { Notice, TFile, TFolder } from "obsidian";
import type { Editor } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 目录页自动化：
 * - 在目录页笔记（如 00-目录.md）里执行命令 → 每个 H2 章节 = 同名同级子文件夹
 * - 把子文件夹里「章节正文还没链接过」的笔记，按文件名排序补到章节末尾
 * - 链接格式跟随库内惯例：- [[完整路径.md|文件名]]
 * - 判定「已收录」要求路径或文件名在章节文本里出现过（不重复添加、不误伤手动分组）
 * - 全部改动一次事务提交（Cmd+Z 一步撤销）；已齐全则只提示、不动笔
 */

export function updateIndexPage(plugin: FeishuLitePlugin, editor: Editor, filePath: string): void {
	const file = plugin.app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile) || file.extension !== "md") {
		new Notice("Feishu Lite：请把光标放在目录页（Markdown 笔记）里");
		return;
	}
	const headings = plugin.app.metadataCache.getFileCache(file)?.headings ?? [];
	if (!headings.some((h) => h.level === 2)) {
		new Notice("Feishu Lite：这篇笔记没有 H2（##）章节，无法对目录");
		return;
	}

	const dir = file.parent && file.parent.path !== "/" ? file.parent.path : "";
	const total = editor.lineCount();
	const changes: { from: { line: number; ch: number }; text: string }[] = [];
	let added = 0;

	for (let i = 0; i < headings.length; i++) {
		const h = headings[i];
		if (!h || h.level !== 2) continue;
		const title = h.heading.trim();
		if (!title) continue;

		const folderPath = dir ? `${dir}/${title}` : title;
		const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) continue; // 没有同名子文件夹 → 这节不对

		// 本节范围：标题行之后，到下一个 ≤2 级标题（或文末）之前
		const startLine = h.position.start.line;
		let endLine = total;
		for (let j = i + 1; j < headings.length; j++) {
			const nxt = headings[j];
			if (nxt && nxt.level <= 2) {
				endLine = nxt.position.start.line;
				break;
			}
		}
		const sectionLines: string[] = [];
		for (let l = startLine + 1; l <= Math.min(endLine - 1, total - 1); l++) sectionLines.push(editor.getLine(l));
		const sectionText = sectionLines.join("\n");

		const missing = folder.children
			.filter((c): c is TFile => c instanceof TFile && c.extension === "md")
			.filter((c) => c.path !== file.path)
			.filter((c) => !sectionText.includes(c.path) && !sectionText.includes(c.basename))
			.sort((a, b) => a.name.localeCompare(b.name, "zh"));
		if (!missing.length) continue;

		// 插入点：本节最后一个非空行之后（空节则紧贴标题）
		let insertLine = startLine;
		for (let l = Math.min(endLine - 1, total - 1); l > startLine; l--) {
			if (editor.getLine(l).trim() !== "") {
				insertLine = l;
				break;
			}
		}
		changes.push({
			from: { line: insertLine + 1, ch: 0 },
			text: missing.map((n) => `- [[${n.path}|${n.basename}]]`).join("\n") + "\n",
		});
		added += missing.length;
	}

	if (!changes.length) {
		new Notice("Feishu Lite：目录已是最新，没有缺失条目");
		return;
	}
	changes.sort((a, b) => a.from.line - b.from.line);
	editor.transaction({ changes }, "feishu-lite");
	new Notice(`Feishu Lite：已补 ${added} 条目录链接（Cmd+Z 可撤销）`);
}
