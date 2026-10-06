import type { Dict } from "./en";

/** 中文词典（结构与 en.ts 完全一致，由 Dict 类型保证） */
export const zh: Dict = {
	groups: {
		paste: "图片 · 粘贴与命名",
		grid: "图片 · 分栏与排版",
		imageTools: "图片 · 工具与查看",
		library: "图片 · 图库与附件清理",
		editor: "编辑 · 增强",
		comments: "编辑 · 批注",
		highlight: "编辑 · 文本高亮",
		reading: "阅读 · 美化与导航",
		maintenance: "维护",
	},
	hero: {
		tagline: "文档增强 · 批注 / 图片 / 高亮 / 阅读",
		collapseAll: "全部折叠",
		expandAll: "全部展开",
	},
	paste: {
		rename: {
			name: "粘贴自动命名",
			desc: "粘贴或拖入图片时按模板重命名，存入附件目录（跟随库设置）",
		},
		pattern: {
			name: "命名模板",
			desc: "变量：{note} 笔记名 · {date} 日期 · {time} 时间 · {i} 序号",
			preview: (sample: string) => `示例：${sample}`,
			noteFallback: "笔记",
		},
		datePattern: {
			name: "日期格式",
			desc: "命名模板中 {date} 的写法",
			options: {
				compact: "紧凑：20261003",
				dash: "带横线：2026-10-03",
				short: "短年份：261003",
			},
		},
		compress: {
			name: "粘贴自动压缩",
			desc: "保存前先压缩；GIF、SVG 或压缩后更大的图片自动保留原图",
		},
		format: {
			name: "压缩格式",
			desc: "支持透明通道、体积更小；JPEG 兼容性最好",
			options: {
				webp: "WebP（推荐）",
				jpeg: "JPEG",
			},
		},
		quality: {
			name: "压缩质量",
			desc: "越低体积越小；80 左右观感基本无损",
		},
		maxEdge: {
			name: "最长边（px）",
			desc: "超过则等比缩小；0 不限（截图建议 1600 左右）",
		},
	},
	grid: {
		columns: {
			name: "默认分栏数",
			desc: "斜杠菜单、图库插入与多图粘贴的默认列数",
			options: {
				"2": "2 栏",
				"3": "3 栏",
				"4": "4 栏",
			},
		},
		autoWrap: {
			name: "多图粘贴自动成栏",
			desc: "一次粘贴或拖入多张图片时自动包成网格",
		},
		rowHeight: {
			name: "统一行高",
			desc: "0 = 自适应（按各自比例）；大于 0 时等比裁切到统一高度，更整齐",
		},
		gap: {
			name: "分栏间距",
			desc: "图片之间的空隙",
		},
		radius: {
			name: "圆角",
			desc: "图片圆角半径",
		},
		preview: "效果预览",
		emptyHint: {
			name: "空分栏占位提示",
			desc: "未贴图的分栏显示虚线占位与提示；关闭后显示为空白",
		},
		sourceThumbs: {
			name: "图片行缩略图",
			desc: "编辑视图点入分栏块内部时，未在编辑的图片行显示缩略图（不露出文件名）",
		},
	},
	imageTools: {
		toolbar: {
			name: "图片工具条",
			desc: "点击图片调整宽度、图注、分栏与顺序，或打开裁剪与标注（原图保留）",
		},
		lightbox: {
			name: "图片查看器",
			desc: "点击图片悬浮查看：滚轮缩放、拖拽平移；点空白处关闭",
		},
	},
	library: {
		scope: {
			name: "搜索范围",
			desc: "图库弹窗里显示哪些图片",
			all: "全部图片",
			attachmentsOnly: (folder: string) => (folder ? `仅附件目录（${folder}）` : "仅附件目录"),
		},
		sort: {
			name: "排序",
			desc: "图库弹窗里图片的排列顺序",
			options: {
				newest: "最新优先",
				oldest: "最旧优先",
				name: "按文件名（升序）",
			},
		},
		clean: {
			name: "自动清理未引用附件",
			desc: "全库无引用且超过 24 小时的图片移入回收站：启动后约 15 秒首查，此后每 24 小时复查；库设置为「永久删除」时整体跳过。",
		},
	},
	editor: {
		toolbar: {
			name: "划词工具条",
			desc: "划词浮现工具条：高亮 / 行内代码 / 删除线；跨行选区支持批注",
		},
		table: {
			name: "表格增强",
			desc: "表格内 Tab / Shift+Tab / Enter 跳格并自动对齐，末格补新行（Advanced Tables 启用时自动让位）",
		},
		list: {
			name: "列表增强",
			desc: "Cmd+Shift+↑ / ↓ 整棵子树移动（Outliner 启用时自动让位）",
		},
	},
	comments: {
		enabled: {
			name: "笔记批注",
			desc: "选中文字留批注；侧栏或底部面板查看线程，数据保存在笔记内",
		},
		author: {
			name: "批注署名",
			desc: "新批注的默认署名",
		},
	},
	highlight: {
		livePreview: {
			name: "编辑视图渲染",
			desc: "在 Live Preview 渲染 ==颜色== 语法；关闭则仅阅读视图渲染（重开笔记后完全生效）",
		},
		colors: {
			red: "红色",
			orange: "橙色",
			yellow: "黄色",
			green: "绿色",
			blue: "蓝色",
			purple: "紫色",
			gray: "灰色",
		},
		colorsRow: {
			name: "高亮颜色",
			desc: "点色块即可修改：红 / 橙 / 黄 / 绿 / 蓝 / 紫 / 灰",
		},
		restoreColors: "恢复默认配色",
	},
	reading: {
		codePretty: {
			name: "代码块美化",
			desc: "语言徽标、4 行以上自动行号、缺失时补复制按钮（重开笔记后完全生效）",
		},
		tablePretty: {
			name: "表格斑马纹",
			desc: "隔行浅色底与悬停行高亮（阅读视图）",
		},
		toc: {
			name: "浮动目录",
			desc: "右侧 Feishu 式悬浮大纲：跟随当前笔记，滚动高亮、点击跳转；默认收窄成轨，悬停展开",
		},
		rememberScroll: {
			name: "记住阅读位置",
			desc: "按笔记记住上次阅读位置，重开自动回到原位；仅桌面端生效",
		},
		cjk: {
			name: "粘贴时自动美化中英混排",
			desc: "粘贴文本时在中文与英文 / 数字间补一个空格（代码块、链接、公式内不处理）",
		},
	},
	maintenance: {
		reset: {
			name: "恢复默认设置",
			desc: "所有选项回到初始值；不影响已写入笔记的内容",
		},
		confirmTitle: "恢复默认设置",
		confirmMessage: "将重置全部选项为初始值，不影响笔记内容。确定继续？",
	},
	notices: {
		colorsRestored: "Feishu Lite：已恢复默认高亮配色",
		defaultsRestored: "Feishu Lite：已恢复默认设置",
	},
};
