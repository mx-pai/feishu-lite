import { App, Modal, TFile } from "obsidian";
import { IMAGE_EXTS } from "./util";

/** 图库弹窗的行为选项（来自插件设置） */
export interface PickerOptions {
	/** all = 全库图片；attachments = 仅附件目录 */
	scope: "all" | "attachments";
	/** newest = 最新优先；oldest = 最旧优先；name = 文件名 A→Z */
	sort: "newest" | "oldest" | "name";
}

/**
 * 图库多选插入器：搜索 + 缩略图 + 空格多选 + 回车插入。
 * 解决「图床几百张图，找图全靠预览」的痛点。
 */
export class ImagePickerModal extends Modal {
	private onDone: (files: TFile[]) => void;
	private opts: PickerOptions;
	private all: TFile[] = [];
	private filtered: TFile[] = [];
	private rowEls: HTMLElement[] = [];
	private selected = new Set<TFile>();
	private active = 0;
	private query = "";
	private inputEl!: HTMLInputElement;
	private listEl!: HTMLElement;
	private countEl!: HTMLElement;

	constructor(app: App, onDone: (files: TFile[]) => void, opts: PickerOptions) {
		super(app);
		this.onDone = onDone;
		this.opts = opts;
	}

	onOpen(): void {
		this.modalEl.addClass("fl-picker-modal");
		this.titleEl.setText("插入图片（空格多选 · 回车插入）");

		this.all = this.app.vault
			.getFiles()
			.filter((f) => IMAGE_EXTS.includes(f.extension.toLowerCase()));

		// 搜索范围：仅附件目录（跟随库设置；目录未配置时回退全库）
		const folder = this.opts.scope === "attachments" ? this.attachmentFolder() : "";
		if (folder) this.all = this.all.filter((f) => f.path.startsWith(folder + "/"));

		// 排序
		if (this.opts.sort === "name") this.all.sort((a, b) => a.path.localeCompare(b.path, "zh"));
		else if (this.opts.sort === "oldest") this.all.sort((a, b) => a.stat.mtime - b.stat.mtime);
		else this.all.sort((a, b) => b.stat.mtime - a.stat.mtime);

		this.inputEl = this.contentEl.createEl("input", {
			type: "text",
			cls: "fl-picker-input",
			attr: { placeholder: "搜索文件名 / 路径…" },
		});

		this.listEl = this.contentEl.createDiv({ cls: "fl-picker-list" });

		const footer = this.contentEl.createDiv({ cls: "fl-picker-footer" });
		this.countEl = footer.createDiv({ cls: "fl-picker-count", text: "0 张已选" });
		const insertBtn = footer.createEl("button", { text: "插入", cls: "mod-cta" });
		insertBtn.onclick = () => this.confirm();

		this.inputEl.addEventListener("input", () => {
			this.query = this.inputEl.value;
			this.active = 0;
			this.render();
		});
		this.inputEl.addEventListener("keydown", (e) => this.onKey(e));

		this.render();
		this.inputEl.focus();
	}

	private onKey(e: KeyboardEvent): void {
		if (e.isComposing || e.key === "Process") return; // IME 组合中不拦截：候选窗的上下键 / 空格 / 回车都放行
		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.move(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.move(-1);
		} else if (e.key === " ") {
			e.preventDefault();
			this.toggleActive();
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (this.selected.size) {
				this.confirm();
			} else {
				const f = this.filtered[this.active];
				if (f) {
					this.onDone([f]);
					this.close();
				}
			}
		}
	}

	private move(dir: number): void {
		const len = this.filtered.length;
		if (!len) return;
		this.active = (this.active + dir + len) % len;
		this.refreshRowStates();
	}

	private toggleActive(): void {
		const f = this.filtered[this.active];
		if (!f) return;
		if (this.selected.has(f)) this.selected.delete(f);
		else this.selected.add(f);
		this.refreshRowStates();
	}

	private confirm(): void {
		if (!this.selected.size) return;
		this.onDone([...this.selected]);
		this.close();
	}

	private render(): void {
		const q = this.query.trim().toLowerCase();
		this.filtered = (q ? this.all.filter((f) => f.path.toLowerCase().includes(q)) : this.all).slice(0, 200);
		this.active = Math.min(this.active, Math.max(0, this.filtered.length - 1));
		this.listEl.empty();
		this.rowEls = [];

		this.filtered.forEach((f, i) => {
			const row = this.listEl.createDiv({ cls: "fl-picker-row" });
			row.createDiv({ cls: "fl-picker-check", text: "☐" });
			row.createEl("img", { attr: { loading: "lazy", src: this.app.vault.getResourcePath(f) } });
			row.createDiv({ cls: "fl-picker-name", text: f.name });
			row.createDiv({ cls: "fl-picker-dir", text: f.parent?.path ?? "" });
			row.onclick = () => {
				this.active = i;
				this.toggleActive();
			};
			this.rowEls.push(row);
		});

		this.refreshRowStates();
	}

	private refreshRowStates(): void {
		this.rowEls.forEach((row, i) => {
			const f = this.filtered[i];
			if (!f) return;
			const isSel = this.selected.has(f);
			row.toggleClass("is-active", i === this.active);
			row.toggleClass("is-selected", isSel);
			const checkEl = row.querySelector<HTMLElement>(".fl-picker-check");
			if (checkEl) checkEl.setText(isSel ? "☑" : "☐");
		});
		this.rowEls[this.active]?.scrollIntoView({ block: "nearest" });
		this.countEl.setText(`${this.selected.size} 张已选`);
	}

	/** 读取库设置的附件目录名（「仅附件目录」过滤用） */
	private attachmentFolder(): string {
		try {
			const raw = (this.app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.(
				"attachmentFolderPath"
			);
			const v = (typeof raw === "string" ? raw : "")
				.replace(/^\.\//, "")
				.replace(/^\/+|\/+$/g, "");
			return v === "." ? "" : v;
		} catch {
			return "";
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
