# 测试沉淀

两层验证，全部在插件目录（`.obsidian/plugins/feishu-lite`）下执行。

## 1. 单测（不需要 Obsidian）

```bash
npm test        # node --test tests/core.test.mjs tests/safety.test.mjs
```

纯函数校验：批注解析（`comment-core`）、图片解析 / 箭头几何（`image-core`）与安全边界（`safety.test.mjs`）。

## 2. 运行时验收套件（需要运行中的 Obsidian）

前提：Obsidian 已打开本 vault（runner 固定 `vault=new_obsidian`）且插件在运行。直接把检查代码注入真实 `app` 环境执行：

```bash
node tests/run-runtime.mjs setup     # ① 建验收夹具（图片 + 功能验收笔记）
node tests/run-runtime.mjs layout    # ② 分栏布局校验（20 项）
node tests/run-runtime.mjs cleanup   # ③ 拆除校验（20 项），跑完不留夹具
```

独立套件（自带夹具、`finally` 自清理，与 setup 流水线无关，可单独跑）：

```bash
node tests/run-runtime.mjs toolbar   # 图片工具条（含几何居中检查）
node tests/run-runtime.mjs native    # 原生渲染器：点击选中 / resize 手柄 / 工具条保持
node tests/run-runtime.mjs arrow     # 图片编辑器：箭头绘制、撤销、PNG 导出
node tests/run-runtime.mjs comment   # 批注渲染：阅读视图 mark + Live Preview 行内标记
```

也支持内联代码片段（需自带 `return` 才有输出）：`node tests/run-runtime.mjs 'return 1+1'`。

## 注意

- 套件向运行中的 Obsidian 注入代码并临时挂载 / 移动视图 DOM，`finally` 中恢复；请勿在跑测试时手动改验收文件夹。
- 套件需要 Obsidian 窗口**可见**：锁屏 / 最小化 / 完全被遮挡时 Chromium 会挂起渲染，命名套件会直接报「窗口不可见」（runner 统一前置守卫）；显示窗口后重跑即可。
- 热重载（`npm run dev`）后立刻跑：全工作区重渲染可能让个别检查偶发失败一次，重跑即稳。干净上下文连跑两次全绿 = 验收标准。
