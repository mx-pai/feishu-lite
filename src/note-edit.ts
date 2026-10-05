import { Editor, MarkdownView, TFile } from "obsidian";
import type { App } from "obsidian";

/** Open buffers take precedence over disk, including non-active panes. */
export function noteEditor(app: App, file: TFile): Editor | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active?.file?.path === file.path && active.getMode() === "source") return active.editor;
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path && view.getMode() === "source") return view.editor;
	}
	return null;
}

export async function readNote(app: App, file: TFile): Promise<string> {
	return noteEditor(app, file)?.getValue() ?? await app.vault.read(file);
}

/** A single undoable editor change, trimmed to its common prefix/suffix. */
export function replaceEditorText(editor: Editor, next: string): void {
	const prev = editor.getValue();
	if (prev === next) return;
	let from = 0;
	while (from < prev.length && from < next.length && prev[from] === next[from]) from++;
	let end = prev.length, nextEnd = next.length;
	while (end > from && nextEnd > from && prev[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
	editor.replaceRange(next.slice(from, nextEnd), editor.offsetToPos(from), editor.offsetToPos(end));
}

export async function editNote(app: App, file: TFile, edit: (current: string) => string): Promise<void> {
	const editor = noteEditor(app, file);
	if (editor) replaceEditorText(editor, edit(editor.getValue()));
	else await app.vault.process(file, edit);
}

export function assertSnapshot(current: string, expected: string): void {
	if (current !== expected) throw new Error("笔记内容已变化，请重新选中后操作");
}

export interface NoteTransfer {
	version: 1; id: string; sourcePath: string; targetPath: string;
	sourceBefore: string; targetBefore: string; sourceAfter: string; targetAfter: string;
}
const JOURNALS = ".feishu-lite/operations";
/** Durable, idempotent two-file operation. Mismatching snapshots remain for recovery. */
export async function commitTransfer(app: App, plan: NoteTransfer, existingJournal?: string): Promise<void> {
	const adapter = app.vault.adapter;
	for (const folder of [".feishu-lite", JOURNALS]) if (!await adapter.exists(folder)) await adapter.mkdir(folder);
	const journal = existingJournal ?? `${JOURNALS}/${plan.id}.json`;
	if (!existingJournal) await adapter.write(journal, JSON.stringify(plan));
	const source = app.vault.getAbstractFileByPath(plan.sourcePath), target = app.vault.getAbstractFileByPath(plan.targetPath);
	if (!(source instanceof TFile) || !(target instanceof TFile) || source.path === target.path) throw new Error("迁移笔记已改名或删除，恢复记录已保留");
	const apply = async (file: TFile, before: string, after: string) => editNote(app, file, current => {
		if (current === after) return current;
		if (current !== before) throw new Error("迁移遇到并发修改，正文和恢复记录已保留，请运行「批注：恢复中断迁移」");
		return after;
	});
	await apply(target, plan.targetBefore, plan.targetAfter);
	if (await readNote(app, target) !== plan.targetAfter) throw new Error("目标笔记已变化，迁移记录已保留");
	await apply(source, plan.sourceBefore, plan.sourceAfter);
	// Flush open editors before removing the recovery record.
	await app.vault.process(target, current => { if (noteEditor(app, target)?.getValue() !== undefined && noteEditor(app, target)!.getValue() !== plan.targetAfter || current !== plan.targetBefore && current !== plan.targetAfter) throw new Error("目标文件已变化，恢复记录已保留"); return plan.targetAfter; });
	await app.vault.process(source, current => { if (noteEditor(app, source)?.getValue() !== undefined && noteEditor(app, source)!.getValue() !== plan.sourceAfter || current !== plan.sourceBefore && current !== plan.sourceAfter) throw new Error("来源文件已变化，恢复记录已保留"); return plan.sourceAfter; });
	await adapter.remove(journal);
}
export async function recoverTransfers(app: App): Promise<number> {
	if (!await app.vault.adapter.exists(JOURNALS)) return 0;
	const entries = await app.vault.adapter.list(JOURNALS); let count = 0;
	for (const path of entries.files.filter(p => p.endsWith(".json"))) {
		const p = JSON.parse(await app.vault.adapter.read(path)) as NoteTransfer;
		if (p.version !== 1 || !/^[a-z0-9-]+$/.test(p.id) || [p.sourcePath, p.targetPath].some(s => typeof s !== "string" || !s.endsWith(".md") || s.startsWith(".") || s.includes("..")) || [p.sourceBefore, p.targetBefore, p.sourceAfter, p.targetAfter].some(s => typeof s !== "string")) throw new Error("迁移恢复记录无效，已保留原文件");
		await commitTransfer(app, p, path); count++;
	}
	return count;
}
