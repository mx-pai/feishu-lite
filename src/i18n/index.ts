import { getLanguage } from "obsidian";
import { en } from "./en";
import type { Dict } from "./en";
import { zh } from "./zh";

/**
 * 当前语言的设置页文案：
 * - 中文（zh / zh-TW / zh-Hans…）→ 中文词典；其余语言 → 英文词典
 * - 语言来自 Obsidian 官方 getLanguage()（切换界面语言后重载插件即生效）
 */
export const t: Dict = getLanguage().startsWith("zh") ? zh : en;
