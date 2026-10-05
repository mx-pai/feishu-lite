import { App, FuzzySuggestModal, Modal, Notice, TFile } from "obsidian";

export const reportError = (err: unknown) => { console.error("[feishu-lite]", err); new Notice(err instanceof Error ? err.message : String(err)); };
export function action(parent: HTMLElement, label: string, run: () => void | Promise<void>, cls = ""): HTMLButtonElement {
	const b = parent.createEl("button", { text: label, cls });
	b.onclick = async () => { b.disabled = true; try { await run(); } catch (err) { reportError(err); } finally { b.disabled = false; } };
	return b;
}
export class TextDialog extends Modal {
	constructor(app: App, private title: string, private value: string, private submit: (text: string) => Promise<void> | void, private multiline = true, private allowEmpty = false, private trim = true) { super(app); }
	onOpen(): void {
		this.titleEl.setText(this.title);
		const input = this.multiline ? this.contentEl.createEl("textarea", { cls: "fl-dialog-input" }) : this.contentEl.createEl("input", { type: "text", cls: "fl-dialog-input" });
		input.value = this.value;
		const footer = this.contentEl.createDiv({ cls: "fl-dialog-actions" });
		action(footer, "取消", () => this.close());
		const save = action(footer, "保存", async () => { if (!this.allowEmpty && !input.value.trim()) throw new Error("内容不能为空"); await this.submit(this.trim ? input.value.trim() : input.value); this.close(); }, "mod-cta");
		input.onkeydown = e => { if (!e.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey || !this.multiline)) { e.preventDefault(); save.click(); } };
		input.focus();
	}
	onClose(): void { this.contentEl.empty(); }
}
export class ConfirmDialog extends Modal {
	constructor(app: App, private title: string, private message: string, private submit: () => void | Promise<void>) { super(app); }
	onOpen(): void { this.titleEl.setText(this.title); this.contentEl.createEl("p", { text: this.message }); const footer = this.contentEl.createDiv({ cls: "fl-dialog-actions" }); action(footer, "取消", () => this.close()); action(footer, "确认", async () => { await this.submit(); this.close(); }, "mod-warning"); }
	onClose(): void { this.contentEl.empty(); }
}
export class FileDialog extends FuzzySuggestModal<TFile> {
	constructor(app: App, private filter: (f: TFile) => boolean, private submit: (file: TFile) => void | Promise<void>, title: string) { super(app); this.setPlaceholder(title); }
	getItems(): TFile[] { return this.app.vault.getFiles().filter(this.filter); }
	getItemText(file: TFile): string { return file.path; }
	onChooseItem(file: TFile): void { Promise.resolve().then(() => this.submit(file)).catch(reportError); }
}
export class ChoiceDialog<T> extends FuzzySuggestModal<{ label: string; value: T }> {
	constructor(app: App, private choices: { label: string; value: T }[], private submit: (value: T) => void | Promise<void>, title: string) { super(app); this.setPlaceholder(title); }
	getItems(): { label: string; value: T }[] { return this.choices; }
	getItemText(item: { label: string }): string { return item.label; }
	onChooseItem(item: { value: T }): void { Promise.resolve().then(() => this.submit(item.value)).catch(reportError); }
}
