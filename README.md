# Feishu Lite

**飞书文档风格的 Obsidian 编辑体验** —— 斜杠菜单、图片分栏、粘贴自动命名、彩色高亮、表格 / 列表增强、浮动目录。

Lark-doc-style editing for Obsidian: slash menu, image grids, paste auto-rename, colored highlights, and more.

## 功能亮点

- **斜杠菜单** — 行首 `/`，中文 / 英文 / 拼音匹配；参数化命令双栏级联，回车即用
- **图片分栏** — `img-2/3/4` 网格，阅读 / 编辑双端渲染；多图粘贴自动成栏
- **粘贴自动命名** — `{note}-{date}-{i}` 模板存入附件目录，可选 WebP / JPEG 压缩
- **彩色高亮** — `=={red}文字==` 七色；划词工具条（高亮 / 内联代码 / 删除线，再点取消）
- **表格 / 列表增强** — Tab 跳格自动对齐、行列增删；`Cmd+Shift+↑/↓` 移动子树；对 Advanced Tables / Outliner 自动让位
- **阅读视图美化** — 代码块徽标 / 复制 / 行号、表格斑马纹
- **图片查看器** — 点击图片悬浮放大：滚轮缩放、拖拽平移、Esc / 点击空白关闭（阅读 / 编辑视图通用）
- **浮动目录** — 右侧悬浮大纲：悬停展开、滚动跟随、点击跳转
- **还有** — Mermaid 骨架、中英混排美化、阅读位置记忆、附件自动清理、目录页自动化

## Features

- **Slash menu** — `/` at the start of a line, with Chinese / English / pinyin matching; two-pane cascading pickers for parameterized commands
- **Image grids** — `img-2/3/4` callout layouts rendered in reading and editing views; multi-image paste wraps automatically
- **Paste auto-rename** — `{note}-{date}-{i}` templates into your attachment folder; optional WebP / JPEG compression
- **Colored highlights** — `=={red}text==` (seven colors) plus a selection toolbar (highlight / recolor / inline code / strikethrough, click again to remove)
- **Table & list enhancements** — Tab navigation with auto-alignment, row and column editing, `Cmd+Shift+↑/↓` subtree moves; yields to Advanced Tables / Outliner
- **Reading view polish** — code block badges, copy button and line numbers, zebra tables
- **Image lightbox** — click an image to zoom: wheel scaling, drag to pan, Esc / click-outside to close (reading & editing views)
- **Floating outline** — hover-to-expand rail on the right edge, scroll-following highlight, click to jump
- **Also included** — Mermaid snippets, CJK–Latin spacing, reading position memory, attachment cleanup, index-page automation

## 安装 / Installation

- **社区插件市场 / Community plugins**：设置 → 社区插件 → 搜索 "Feishu Lite" / Settings → Community plugins → search "Feishu Lite"
- **手动 / Manual**：从 [Releases](https://github.com/mx-pai/feishu-lite/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<vault>/.obsidian/plugins/feishu-lite/` 后启用 / download from Releases into `<vault>/.obsidian/plugins/feishu-lite/`, then enable

Requires Obsidian 1.6.6+ · MIT License

## 开发 / Development

```bash
npm install
npm run build   # 类型检查 + esbuild 生产构建 → main.js
```
