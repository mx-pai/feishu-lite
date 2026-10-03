import type { Editor } from "obsidian";
import type FeishuLitePlugin from "./main";
import { openCascade } from "./cascade";

/**
 * Mermaid 骨架插入（炼化 mermaid-tools 的常用切片）：
 * 斜杠 /mmd 或命令 → 选类型 → 插入一段带示例内容的 ```mermaid 代码块。
 */

export interface MermaidType {
	label: string;
	hint: string;
	body: string;
}

export const MERMAID_TYPES: MermaidType[] = [
	{
		label: "流程图（纵向）",
		hint: "flowchart TD",
		body: "flowchart TD\n    A[开始] --> B{判断}\n    B -->|是| C[结束]\n    B -->|否| A",
	},
	{
		label: "流程图（横向）",
		hint: "flowchart LR",
		body: "flowchart LR\n    A[开始] --> B{判断}\n    B -->|是| C[结束]\n    B -->|否| A",
	},
	{
		label: "时序图",
		hint: "sequenceDiagram",
		body: "sequenceDiagram\n    participant A as 甲方\n    participant B as 乙方\n    A->>B: 请求\n    B-->>A: 响应",
	},
	{
		label: "类图",
		hint: "classDiagram",
		body: "classDiagram\n    class 类名 {\n        +属性: 类型\n        +方法()\n    }\n    类名 <|-- 子类",
	},
	{
		label: "状态图",
		hint: "stateDiagram-v2",
		body: "stateDiagram-v2\n    [*] --> 状态1\n    状态1 --> 状态2\n    状态2 --> [*]",
	},
	{
		label: "甘特图",
		hint: "gantt（时间计划）",
		body: "gantt\n    title 项目计划\n    dateFormat YYYY-MM-DD\n    section 阶段一\n    任务A :a1, 2026-01-01, 7d\n    任务B :after a1, 5d",
	},
	{
		label: "饼图",
		hint: "pie",
		body: 'pie title 占比\n    "类别A" : 45\n    "类别B" : 30\n    "类别C" : 25',
	},
	{
		label: "用户旅程",
		hint: "journey",
		body: "journey\n    title 用户旅程\n    section 阶段一\n      步骤1: 5: 用户\n      步骤2: 3: 用户",
	},
	{
		label: "ER 图",
		hint: "erDiagram（实体关系）",
		body: "erDiagram\n    USER ||--o{ ORDER : 下单\n    USER {\n        string 名字\n        string 邮箱\n    }",
	},
	{
		label: "思维导图",
		hint: "mindmap",
		body: "mindmap\n  root((主题))\n    分支一\n      子节点\n    分支二",
	},
	{
		label: "时间线",
		hint: "timeline",
		body: "timeline\n    title 时间线\n    2025 : 事件一\n    2026 : 事件二",
	},
	{
		label: "象限图",
		hint: "quadrantChart",
		body: "quadrantChart\n    title 优先级\n    x-axis 低影响 --> 高影响\n    y-axis 低成本 --> 高成本\n    事项一: [0.3, 0.6]\n    事项二: [0.7, 0.8]",
	},
];

export function insertMermaid(_plugin: FeishuLitePlugin, editor: Editor): void {
	openCascade(
		editor,
		"Mermaid 图 · 选类型",
		MERMAID_TYPES.map((t) => ({ label: t.label, value: t, hint: t.hint })),
		(t) => insertMermaidType(editor, t)
	);
}

/** 按指定类型插入 Mermaid 骨架（光标停在首行内容后） */
export function insertMermaidType(editor: Editor, t: MermaidType): void {
	const start = editor.getCursor();
	editor.replaceSelection("```mermaid\n" + t.body + "\n```\n");
	const firstLineLen = (t.body.split("\n")[0] ?? "").length;
	editor.setCursor({ line: start.line + 1, ch: firstLineLen });
}
