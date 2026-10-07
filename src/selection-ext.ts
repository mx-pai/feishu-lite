/**
 * 划词 UI 第三方扩展（公开面）：编辑器划词工具条 + 阅读视图批注条共用一份「划词动作」注册表。
 * - FlSelectionAction：外部插件注册项的契约
 * - 校验 / 适配在这里，main.ts（注册 API）与 select-toolbar.ts / comments.ts（渲染）复用
 *
 * 本文件零运行时依赖（obsidian 仅类型引入）：契约由 tests/selection-ext.test.mjs 直接 bundle 兜底。
 */
import type { Editor } from "obsidian";

/** 外部插件可注册的划词动作（出现在编辑器划词工具条 / 阅读视图批注条） */
export interface FlSelectionAction {
	/** 唯一标识（去重 / 覆盖用）；建议带插件前缀，如 "your-plugin:translate" */
	id: string;
	/** 按钮文字（工具栏空间有限，建议 1~2 字） */
	label: string;
	/** 悬停提示（可选） */
	title?: string;
	/** 跨行选区也显示（默认 false：与内置单行格式工具规则一致；内置「批注」不受此限） */
	multiLine?: boolean;
	/** 执行体：编辑器工具条给 Editor，阅读批注条给 null（可自行从 DOM 读选区） */
	run: (editor: Editor | null) => void | Promise<void>;
}

/** 内部条目：注册后 id 已加 `ext:` 前缀（与内置按钮隔离命名空间） */
export type SelectionAction = FlSelectionAction;

/** 校验外部注册项；返回错误文案（null = 合法） */
export function validateFlSelectionAction(item: FlSelectionAction): string | null {
	if (!item || typeof item !== "object") return "注册项必须是对象";
	if (typeof item.id !== "string" || !item.id.trim()) return "id 必须是非空字符串";
	if (typeof item.label !== "string" || !item.label.trim()) return "label 必须是非空字符串";
	if (item.title !== undefined && typeof item.title !== "string") return "title 必须是字符串";
	if (item.multiLine !== undefined && typeof item.multiLine !== "boolean") return "multiLine 必须是布尔值";
	if (typeof item.run !== "function") return "run 必须是函数";
	return null;
}

/** 适配为内部条目：id 加 `ext:` 前缀 */
export function adaptFlSelectionAction(item: FlSelectionAction): SelectionAction {
	return { ...item, id: `ext:${item.id}` };
}
