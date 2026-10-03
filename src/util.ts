import { App, SuggestModal } from "obsidian";

export function pad2(n: number): string {
	return n < 10 ? "0" + n : String(n);
}

export function formatDate(d: Date): string {
	return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function formatTime(d: Date): string {
	return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** 清理文件名中的非法字符，防止路径注入/无效字符 */
export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^\.+/, "")
		.replace(/[. ]+$/, "")
		.slice(0, 80)
		.trim();
	return cleaned || "image";
}

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

export function isImagePath(path: string): boolean {
	const clean = path.split("#")[0].split("?")[0];
	const ext = clean.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTS.includes(ext);
}

/** 插件是否处于启用状态（「让位」检查用：原插件在启用中就不接管，内部 API 带兜底） */
export function isPluginEnabled(app: App, id: string): boolean {
	try {
		const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
		return !!plugins?.enabledPlugins?.has(id);
	} catch {
		return false;
	}
}

export interface ListOption<T> {
	label: string;
	value: T;
	hint?: string;
}

/** 通用二段选择器：用于高亮块类型 / 代码语言 / 分栏数等 */
export class ListModal<T> extends SuggestModal<ListOption<T>> {
	private opts: {
		title: string;
		options: ListOption<T>[];
		placeholder?: string;
		onPick: (value: T) => void;
	};

	constructor(app: App, opts: { title: string; options: ListOption<T>[]; placeholder?: string; onPick: (value: T) => void }) {
		super(app);
		this.opts = opts;
		this.setPlaceholder(opts.placeholder ?? "输入以筛选…");
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
	}

	getSuggestions(query: string): ListOption<T>[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.opts.options;
		return this.opts.options.filter(
			(o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)
		);
	}

	renderSuggestion(option: ListOption<T>, el: HTMLElement): void {
		el.createDiv({ text: option.label });
		if (option.hint) el.createEl("small", { text: option.hint, cls: "fl-modal-hint" });
	}

	onChooseSuggestion(option: ListOption<T>): void {
		this.opts.onPick(option.value);
	}
}
