/**
 * 斜杠菜单第三方扩展点（公开面）：
 * - FlSlashItem：外部插件注册项的契约（比内置 SlashItem 更窄：无 params、run 不带 plugin 句柄）
 * - 校验 / 适配 / 说明行求值：main.ts（注册 API）与 slash.ts / cascade.ts（渲染）共用
 *
 * 本文件零运行时依赖（obsidian 只作类型引入，esbuild 自动擦除）：
 * 契约逻辑由 tests/slash-ext.test.mjs 直接 bundle 本文件兜底，不依赖 obsidian 运行时。
 */
import type { Editor, TFile } from "obsidian";
import type { SlashItem } from "./slash-items";

/** 外部插件可注册的斜杠菜单项 */
export interface FlSlashItem {
	/** 唯一标识（去重 / 覆盖用）；建议带插件前缀，如 "your-plugin:action" */
	id: string;
	/** 菜单显示名 */
	name: string;
	/** 说明行（右侧灰色小字）；可传函数、每次渲染时求值（适合随状态变化的提示） */
	hint?: string | (() => string);
	/** 匹配键：英文 / 拼音全称 / 拼音缩写 / 中文，任一前缀或包含即命中 */
	keys: string[];
	/** 次级项：刚输入 `/` 时默认不出现在列表里，输入关键词才命中 */
	secondary?: boolean;
	/** 执行体：输入的 /query 已被吃掉，光标处可直接插入 */
	run: (editor: Editor, file: TFile | null) => void | Promise<void>;
}

/** 求值说明行（渲染点统一走这里；内置项的纯字符串 hint 同样兼容） */
export function resolveHint(item: { hint?: string | (() => string) }): string {
	const h = item.hint;
	if (typeof h === "function") {
		try {
			return h();
		} catch {
			return ""; // 第三方 hint 函数出错不该拖垮整个菜单渲染
		}
	}
	return h ?? "";
}

/** 校验外部注册项；返回错误文案（null = 合法）。错误只发生在注册那一刻，渲染路径无需再防 */
export function validateFlSlashItem(item: FlSlashItem): string | null {
	if (!item || typeof item !== "object") return "注册项必须是对象";
	if (typeof item.id !== "string" || !item.id.trim()) return "id 必须是非空字符串";
	if (typeof item.name !== "string" || !item.name.trim()) return "name 必须是非空字符串";
	if (!Array.isArray(item.keys) || !item.keys.length || item.keys.some((k) => typeof k !== "string" || !k.trim()))
		return "keys 必须是非空字符串数组";
	if (item.secondary !== undefined && typeof item.secondary !== "boolean") return "secondary 必须是布尔值";
	if (item.hint !== undefined && typeof item.hint !== "string" && typeof item.hint !== "function")
		return "hint 必须是字符串或函数";
	if (typeof item.run !== "function") return "run 必须是函数";
	return null;
}

/** 适配为内置 SlashItem：id 加 `ext:` 前缀隔离命名空间；外部 run 收掉 plugin 参数 */
export function adaptFlSlashItem(item: FlSlashItem): SlashItem {
	return {
		id: `ext:${item.id}`,
		name: item.name,
		hint: item.hint ?? "",
		keys: item.keys,
		secondary: item.secondary,
		run: (_plugin, editor, file) => item.run(editor, file),
	};
}
