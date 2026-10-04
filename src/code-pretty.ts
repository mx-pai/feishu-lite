import { MarkdownPostProcessorContext } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 阅读视图代码块美化：语言徽标 + 一键复制 + 行号（≥4 行时）
 * - 只在阅读视图生效（编辑视图的代码块由 Obsidian 编辑器渲染，不插手）
 * - 行号用独立 gutter 叠在 pre 左侧的内边距区，不触碰 code 内部，语法高亮不受影响
 */

export function codePrettyPostProcessor(
	el: HTMLElement,
	_ctx: MarkdownPostProcessorContext,
	plugin: FeishuLitePlugin
): void {
	if (!plugin.settings.codePretty) return;

	el.querySelectorAll<HTMLElement>("pre > code").forEach((codeEl) => {
		const pre = codeEl.parentElement;
		if (!pre || pre.closest(".fl-code-wrap")) return; // 幂等保护

		const wrap = createDiv({ cls: "fl-code-wrap" });
		pre.parentElement?.insertBefore(wrap, pre);
		wrap.appendChild(pre);

		// 语言徽标 + 复制按钮（悬停显现）
		const actions = wrap.createDiv({ cls: "fl-code-actions" });
		const lang = /language-([\w+.-]+)/.exec(codeEl.className)?.[1];
		if (lang) actions.createSpan({ cls: "fl-code-lang", text: lang });
		const btn = actions.createEl("button", { cls: "fl-code-copy", text: "复制" });
		btn.setAttribute("type", "button");

		const source = (codeEl.textContent ?? "").replace(/\n+$/, "");
		btn.onclick = (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			void copyText(source, btn);
		};

		// 行号：4 行起步才显示，避免小片段被数字噪音打扰
		const lineCount = source ? source.split("\n").length : 0;
		if (lineCount >= 4) {
			const gutter = createDiv({ cls: "fl-code-lines" });
			gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
			wrap.appendChild(gutter);
			pre.addClass("fl-line-numbers");
			// 渲染后测量实际行高并同步给 gutter（双 rAF 等 DOM 入树完成），数字与代码行严格对齐
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					const codeStyle = getComputedStyle(codeEl);
					gutter.style.lineHeight = codeStyle.lineHeight;
					gutter.style.fontSize = codeStyle.fontSize;
					gutter.style.paddingTop = getComputedStyle(pre).paddingTop;
				});
			});
		}
	});
}

async function copyText(text: string, btn: HTMLElement): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		btn.setText("已复制 ✓");
	} catch {
		btn.setText("复制失败");
	}
	window.setTimeout(() => btn.setText("复制"), 1200);
}
