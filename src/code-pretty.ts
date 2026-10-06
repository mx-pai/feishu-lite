import { MarkdownPostProcessorContext } from "obsidian";
import type FeishuLitePlugin from "./main";

/**
 * 阅读视图代码块美化：语言徽标 + 行号（≥4 行时）+ 复制按钮（仅系统未自带时兜底）
 * - 只在阅读视图生效（编辑视图的代码块由 Obsidian 编辑器渲染，不插手）
 * - 复制：新版 Obsidian 自带 pre > button.copy-code-button；检测到就让位（只留徽标并左移避让），
 *   检测不到才落兜底按钮并延后一拍复查（不依赖双方 post-processor 的注册顺序）
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
		// mermaid 块会被渲染器整块替换成图：我们注入的徽标/数字会孤零零留在图旁边，直接跳过
		if (codeEl.className.includes("language-mermaid")) return;

		const wrap = createDiv({ cls: "fl-code-wrap" });
		pre.parentElement?.insertBefore(wrap, pre);
		wrap.appendChild(pre);

		// 语言徽标（悬停显现）
		const actions = wrap.createDiv({ cls: "fl-code-actions" });
		const lang = /language-([\w+.-]+)/.exec(codeEl.className)?.[1];
		if (lang) actions.createSpan({ cls: "fl-code-lang", text: lang });

		// 复制按钮：新版 Obsidian 阅读视图自带（内置 post-processor 往 pre 里插
		// button.copy-code-button）；系统已提供时不再重复注入，仅让徽标左移避让。
		// 同步检查已能命中常规场景（内置先于插件注册），延后一拍复查兜底离屏 / 未出帧场景，
		// 不依赖双方 post-processor 的执行顺序——与 syncGutter 的重试策略一致。
		const hasNativeCopy = (): boolean => !!pre.querySelector(".copy-code-button");
		const source = (codeEl.textContent ?? "").replace(/\n+$/, "");
		if (hasNativeCopy()) {
			wrap.addClass("fl-has-native-copy");
		} else {
			let settled = false;
			const placeCopyButton = (): void => {
				if (settled) return;
				settled = true;
				if (hasNativeCopy()) {
					wrap.addClass("fl-has-native-copy");
					return;
				}
				const btn = actions.createEl("button", { cls: "fl-code-copy", text: "复制" });
				btn.setAttribute("type", "button");
				btn.onclick = (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					void copyText(source, btn);
				};
			};
			window.requestAnimationFrame(() => window.requestAnimationFrame(placeCopyButton));
			window.setTimeout(placeCopyButton, 350);
		}

		// 行号：4 行起步才显示，避免小片段被数字噪音打扰
		const lineCount = source ? source.split("\n").length : 0;
		if (lineCount >= 4) {
			const gutter = createDiv({ cls: "fl-code-lines" });
			gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
			wrap.appendChild(gutter);
			pre.addClass("fl-line-numbers");
			syncGutter(gutter, pre, codeEl);
		}
	});
}

/**
 * 把代码块的行高/字号/上内边距同步给行号列，数字与代码行严格对齐。
 * 时序注意：看板卡片等场景在离屏容器里渲染，触发时元素可能尚未入树，
 * getComputedStyle 会返回空串导致同步静默失败——因此带重试链兜底。
 */
function syncGutter(gutter: HTMLElement, pre: HTMLElement, codeEl: HTMLElement): void {
	let tries = 0;
	const apply = (): void => {
		if (gutter.style.lineHeight) return; // 已同步（幂等）
		tries += 1;
		if (gutter.isConnected) {
			const codeStyle = getComputedStyle(codeEl);
			const padTop = getComputedStyle(pre).paddingTop;
			if (codeStyle.lineHeight && padTop) {
				gutter.style.lineHeight = resolvePitch(codeEl, codeStyle.lineHeight);
				gutter.style.fontSize = codeStyle.fontSize;
				gutter.style.paddingTop = padTop;
				return;
			}
		}
		if (tries < 8) window.setTimeout(apply, tries < 3 ? 120 : 400);
	};
	// 快速路径：双 rAF 等首帧布局；兜底路径：元素尚未入树 / 窗口不出帧时定时重试
	window.requestAnimationFrame(() => window.requestAnimationFrame(apply));
	window.setTimeout(apply, 350);
}

/**
 * 行距校正：某些字体/主题下代码行的实际行距会略大于声明的 line-height
 * （实测卡片内每行 +0.5px，32 行累计漂移 15px）。
 * 用 Range 实测各行顶边距离取中位数；测不到（未布局/行太少）时回退声明值。
 */
function resolvePitch(codeEl: HTMLElement, fallback: string): string {
	try {
		const range = document.createRange();
		range.selectNodeContents(codeEl);
		const tops = Array.from(range.getClientRects())
			.filter((r) => r.width > 0.2)
			.map((r) => r.top)
			.sort((a, b) => a - b);
		const lineTops: number[] = [];
		for (const t of tops) {
			const prev = lineTops[lineTops.length - 1];
			if (prev === undefined || t - prev > 3) lineTops.push(t);
		}
		if (lineTops.length < 3) return fallback;
		const gaps: number[] = [];
		for (let i = 1; i < lineTops.length; i++) gaps.push(lineTops[i] - lineTops[i - 1]);
		gaps.sort((a, b) => a - b);
		const median = gaps[Math.floor(gaps.length / 2)];
		const declared = parseFloat(fallback);
		const withinRange = median >= 4 && median <= 100;
		const nearDeclared = !Number.isFinite(declared) || Math.abs(median - declared) <= declared * 0.5;
		if (withinRange && nearDeclared) return `${Math.round(median * 1000) / 1000}px`;
		return fallback;
	} catch {
		return fallback;
	}
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
