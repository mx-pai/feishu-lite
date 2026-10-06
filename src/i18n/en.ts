/**
 * English strings（src/i18n/en.ts）
 * - 本文件是词典的结构源：zh.ts 用 `Dict` 类型锁定同构，键不一致会直接编译失败
 * - 文件命名形如 `en*.ts` 是官方本地化约定：eslint 会对本文件执行句子大小写检查
 */
export const en = {
	groups: {
		paste: "Images · paste & naming",
		grid: "Images · grid & layout",
		imageTools: "Images · tools & viewer",
		library: "Images · library & cleanup",
		editor: "Editor · enhancements",
		comments: "Editor · comments",
		highlight: "Editor · highlight",
		reading: "Reading · polish & navigation",
		maintenance: "Maintenance",
	},
	paste: {
		rename: {
			name: "Auto-name on paste",
			desc: "Rename pasted or dropped images by the pattern below; they go to your attachment folder.",
		},
		pattern: {
			name: "Naming pattern",
			desc: "Variables: {note} note name · {date} date · {time} time · {i} index",
			preview: (sample: string) => `Example: ${sample}`,
			noteFallback: "Note",
		},
		datePattern: {
			name: "Date format",
			desc: "How {date} is written in the pattern",
			options: {
				compact: "Compact: 20261003",
				dash: "Dashed: 2026-10-03",
				short: "Short year: 261003",
			},
		},
		compress: {
			name: "Compress on paste",
			desc: "Compress before saving; GIF, SVG, or larger results keep the original.",
		},
		format: {
			name: "Compression format",
			desc: "Smallest files with transparency support; JPEG is the most compatible.",
			options: {
				webp: "WebP (recommended)",
				jpeg: "JPEG",
			},
		},
		quality: {
			name: "Compression quality",
			desc: "Lower means smaller; around 80 is visually near-lossless.",
		},
		maxEdge: {
			name: "Longest edge (px)",
			desc: "Shrink larger images to fit. Zero keeps the original size; use 1600 for screenshots.",
		},
	},
	grid: {
		columns: {
			name: "Default columns",
			desc: "Column count for grid inserts and multi-image pastes.",
			options: {
				"2": "Two columns",
				"3": "Three columns",
				"4": "Four columns",
			},
		},
		autoWrap: {
			name: "Auto-grid on multi-paste",
			desc: "Pasting or dropping several images at once wraps them into a grid.",
		},
		rowHeight: {
			name: "Uniform row height",
			desc: "Zero keeps each image's own ratio. Above 0 crops all images to one height for an even look.",
		},
		gap: {
			name: "Grid gap",
			desc: "Space between images.",
		},
		radius: {
			name: "Corner radius",
			desc: "Image corner rounding.",
		},
		preview: "Preview",
		emptyHint: {
			name: "Empty grid hint",
			desc: "Empty cells show a dashed placeholder and a hint; turn off for blank cells.",
		},
		sourceThumbs: {
			name: "Thumbnails on image lines",
			desc: "Inside a grid block, image lines you are not editing show a thumbnail instead of the file name.",
		},
	},
	imageTools: {
		toolbar: {
			name: "Image toolbar",
			desc: "Click an image to adjust its width, caption, or grid position, or to crop and annotate it. Originals are kept.",
		},
		lightbox: {
			name: "Image viewer",
			desc: "Click an image to zoom and pan in an overlay; click outside to close.",
		},
	},
	library: {
		scope: {
			name: "Gallery scope",
			desc: "Which images the gallery picker lists.",
			all: "All images",
			attachmentsOnly: (folder: string) => (folder ? `Attachment folder only (${folder})` : "Attachment folder only"),
		},
		sort: {
			name: "Sort order",
			desc: "Order of images in the gallery picker.",
			options: {
				newest: "Newest first",
				oldest: "Oldest first",
				name: "By file name, ascending",
			},
		},
		clean: {
			name: "Auto-clean unused attachments",
			desc: "Unreferenced images older than 24 hours move to trash: first pass about 15 seconds after startup, then every 24 hours. Skipped while deletion is set to permanent.",
		},
	},
	editor: {
		toolbar: {
			name: "Selection toolbar",
			desc: "Select text to pop up: highlight, inline code, and strikethrough; multi-line selections offer comments.",
		},
		table: {
			name: "Table assist",
			desc: "Tab / Shift+Tab / Enter hop between cells and keep the table aligned; the last cell adds a new row. Yields to Advanced Tables when it is enabled.",
		},
		list: {
			name: "List assist",
			desc: "Cmd+Shift+↑ / ↓ move a list item with its whole subtree. Yields to Outliner when it is enabled.",
		},
	},
	comments: {
		enabled: {
			name: "Comments",
			desc: "Annotate selected text; threads show in the side panel or bottom sheet. Data is stored in the note.",
		},
		author: {
			name: "Author name",
			desc: "Default name for new comments.",
		},
	},
	highlight: {
		livePreview: {
			name: "Render in edit view",
			desc: "Render ==color== markup while editing; off renders it in reading view only. Reopen a note to fully apply.",
		},
		colors: {
			red: "Red",
			orange: "Orange",
			yellow: "Yellow",
			green: "Green",
			blue: "Blue",
			purple: "Purple",
			gray: "Gray",
		},
		restoreColors: "Restore default colors",
	},
	reading: {
		codePretty: {
			name: "Code block polish",
			desc: "Language badge, line numbers for 4+ lines, and a copy button where none exists. Reopen a note to fully apply.",
		},
		tablePretty: {
			name: "Table stripes",
			desc: "Alternating row shading with a hover highlight.",
		},
		toc: {
			name: "Floating outline",
			desc: "A floating outline on the right: follows the active note, highlights the section in view, jumps on click. Stays a thin rail until hovered.",
		},
		rememberScroll: {
			name: "Remember reading position",
			desc: "Reopen a note where you left off. Reading view only; desktop only.",
		},
		cjk: {
			name: "Auto-space mixed scripts",
			desc: "Add a space between mixed scripts when pasting. Skipped inside code, links, and math.",
		},
	},
	maintenance: {
		reset: {
			name: "Restore default settings",
			desc: "Every option returns to its initial value; notes you have written are untouched.",
		},
		confirmTitle: "Restore default settings",
		confirmMessage: "All options return to their initial values. Notes already in your vault are not affected. Continue?",
	},
	notices: {
		colorsRestored: "Feishu Lite: default highlight colors restored",
		defaultsRestored: "Feishu Lite: default settings restored",
	},
};

/** 词典结构：zh.ts 以此为同构约束 */
export type Dict = typeof en;
