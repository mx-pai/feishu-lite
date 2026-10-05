// Obsidian 运行时为每个 Window 注入 createEl / createDiv / createSpan
// （enhance.js；创建的是脱离状态 detached 元素），lint 的 prefer-create-el
// 规则也推荐 doc.win.createEl 形式；但 obsidian@1.13.1 的类型定义尚未声明
// 这三者，此处按官方 Node 接口与全局函数的签名先行补齐。
interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, callback?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
    createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
}
