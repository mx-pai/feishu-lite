/** 链接卡片纯逻辑测试：字段行往返 / 合并语义 / 版式解析 / URL 归一化 / 图片命名（详见 src/link-card-core.ts） */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
async function module(name) {
	const b = await build({
		entryPoints: [new URL('src/' + name + '.ts', root).pathname],
		bundle: true, write: false, format: 'esm', platform: 'node',
	});
	return import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
}

const lc = await module('link-card-core');

test('link-card: build → write → parse 往返保真（含值里带冒号）', () => {
	const entries = lc.buildCardLines({
		url: 'https://www.investor.gov/',
		title: 'Investor.gov — SEC',
		description: 'A: B 说明',
		site: 'investor.gov',
		favicon: 'https://www.investor.gov/favicon.ico',
	});
	const quoted = lc.writeCardLines(entries);
	assert.deepEqual(quoted[0], '> url: https://www.investor.gov/');
	const parsed = lc.parseCardLines(quoted.map((l) => lc.stripQuote(l)));
	assert.equal(lc.fieldOf(parsed, 'url'), 'https://www.investor.gov/');
	assert.equal(lc.fieldOf(parsed, 'description'), 'A: B 说明');
	assert.equal(lc.fieldOf(parsed, 'layout'), '');
	assert.equal(entries.length, 5);
});

test('link-card: 空字段省略；layout 仅显式合法值写入', () => {
	const bare = lc.buildCardLines({ url: 'https://a.dev/', title: '', description: '', site: '', image: '', favicon: '' });
	assert.deepEqual(bare.map((e) => e.key), ['url']);
	assert.deepEqual(lc.buildCardLines({ url: 'https://a.dev/' }, 'large').map((e) => e.key), ['url', 'layout']);
	assert.deepEqual(lc.buildCardLines({ url: 'https://a.dev/' }, 'auto').map((e) => e.key), ['url']);
});

test('link-card: fill 合并只补空缺，保留手改与手写行', () => {
	const lines = lc.parseCardLines(['url: https://a.dev/', 'title: 我改过的标题', '手写说明这一行']);
	const merged = lc.mergeCardLines(lines, { title: '新标题', description: '抓到的描述', site: 'a.dev' }, 'fill');
	assert.equal(lc.fieldOf(merged, 'title'), '我改过的标题');
	assert.equal(lc.fieldOf(merged, 'description'), '抓到的描述');
	assert.equal(lc.fieldOf(merged, 'site'), 'a.dev');
	assert.ok(lc.writeCardLines(merged).some((l) => l.includes('手写说明')));
});

test('link-card: refetch 覆盖已有值，但本地配图与未知字段不动', () => {
	const lines = lc.parseCardLines(['url: https://a.dev/', 'title: 旧', 'image: 附件/link-card-1a2b3c4d.png', 'author: 张三']);
	const merged = lc.mergeCardLines(
		lines,
		{ title: '新', image: 'https://a.dev/cover.png', favicon: 'https://a.dev/f.ico' },
		'refetch'
	);
	assert.equal(lc.fieldOf(merged, 'title'), '新');
	assert.equal(lc.fieldOf(merged, 'image'), '附件/link-card-1a2b3c4d.png');
	assert.equal(lc.fieldOf(merged, 'author'), '张三');
	assert.equal(lc.fieldOf(merged, 'favicon'), 'https://a.dev/f.ico');
});

test('link-card: 版式解析（显式优先，auto 按有无配图）', () => {
	assert.equal(lc.resolveCardLayout('', true), 'compact');
	assert.equal(lc.resolveCardLayout('auto', false), 'text');
	assert.equal(lc.resolveCardLayout('large', true), 'large');
	assert.equal(lc.resolveCardLayout('junk', true), 'compact');
});

test('link-card: URL 输入归一化（只认单独一条 http(s)）', () => {
	assert.equal(lc.normalizeUrlInput('  https://a.dev/x '), 'https://a.dev/x');
	assert.equal(lc.normalizeUrlInput('<https://a.dev/>'), 'https://a.dev/');
	assert.equal(lc.normalizeUrlInput('两个词'), null);
	assert.equal(lc.normalizeUrlInput('ftp://a.dev/'), null);
	assert.equal(lc.normalizeUrlInput(''), null);
	assert.equal(lc.hostnameOf('https://www.investor.gov/'), 'investor.gov');
	assert.equal(lc.isHttpUrl('http://a.dev'), true);
});

test('link-card: 文案清洗（控制符 / 折叠 / 截断）', () => {
	assert.equal(lc.cleanMetaText('  a\n b\t c  '), 'a b c');
	assert.equal(lc.cleanMetaText('x'.repeat(200), 10), 'xxxxxxxxx…');
	assert.equal(lc.cleanMetaText('', 10), '');
});

test('link-card: 图片命名与魔数嗅探', () => {
	assert.equal(lc.cardImageName('https://a.dev/pic.PNG', new Uint8Array(), ''), `link-card-${lc.shortHash('https://a.dev/pic.PNG')}.png`);
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
	assert.equal(lc.sniffImageExt(png), '.png');
	assert.equal(lc.cardImageName('https://a.dev/img', png, ''), `link-card-${lc.shortHash('https://a.dev/img')}.png`);
	assert.equal(lc.cardImageName('https://a.dev/img', new Uint8Array(), 'image/webp'), `link-card-${lc.shortHash('https://a.dev/img')}.webp`);
	assert.equal(lc.sniffImageExt(new Uint8Array([0xff, 0xd8, 0xff])), '.jpg');
});

test('link-card: 确定性文件名（带扩展名可查重复用；无扩展名不猜）', () => {
	assert.equal(lc.cardImageNameFromUrl('https://a.dev/pic.jpeg'), `link-card-${lc.shortHash('https://a.dev/pic.jpeg')}.jpg`);
	assert.equal(lc.cardImageNameFromUrl('https://a.dev/pic.png?v=2'), `link-card-${lc.shortHash('https://a.dev/pic.png?v=2')}.png`);
	assert.equal(lc.cardImageNameFromUrl('https://a.dev/img'), null);
	assert.equal(lc.cardImageNameFromUrl('not a url'), null);
});

test('link-card: 写入时保留缩进前缀与裸引用行', () => {
	assert.deepEqual(lc.writeCardLines([{ raw: '' }], '  > '), ['  >']);
	assert.deepEqual(lc.writeCardLines([{ key: 'url', value: 'https://a.dev/' }], '  > '), ['  > url: https://a.dev/']);
});

test('link-card: 链接文字转义 / 插入后光标 / 行内链接识别（悬浮转换的纯逻辑）', () => {
	assert.equal(lc.escapeLinkText('a[b]c'), 'a\\[b\\]c');
	assert.equal(lc.escapeLinkText(' 多  空格 \n 换行 '), '多 空格 换行');
	assert.deepEqual(lc.positionAfterInsert({ line: 3, ch: 2 }, 'abc'), { line: 3, ch: 5 });
	assert.deepEqual(lc.positionAfterInsert({ line: 3, ch: 2 }, 'a\nbc'), { line: 4, ch: 2 });
	// 行内链接识别：命中 offset 的裸链接
	assert.deepEqual(lc.findUrlAtInLine('看这个 https://a.dev/x 很好', 8), { url: 'https://a.dev/x', start: 4, end: 19 });
	assert.equal(lc.findUrlAtInLine('看这个 https://a.dev/x 很好', 1), null);
	// markdown 链接 / 自动链接里的 URL 不算裸链接
	assert.equal(lc.findUrlAtInLine('[题](https://a.dev/)', 10), null);
	assert.equal(lc.findUrlAtInLine('<https://a.dev/>', 5), null);
	// 结尾句读不计入 URL
	assert.equal(lc.findUrlAtInLine('https://a.dev/。', 8)?.url, 'https://a.dev/');
	assert.equal(lc.findUrlAtInLine('看 https://a.dev，然后', 8)?.url, 'https://a.dev');
});

test('link-card: 块级替换文本（独占行整行 / 行内拆句首句尾）', () => {
	const B = '> [!link-card]\n> url: https://a.dev/';
	assert.equal(lc.expandBlockReplacement('https://a.dev/', 0, 14, B), B);
	assert.equal(lc.expandBlockReplacement('  https://a.dev/', 2, 16, B), B);
	assert.equal(lc.expandBlockReplacement('看这个 https://a.dev/ 好', 4, 18, B), `看这个\n\n${B}\n\n好`);
	assert.equal(lc.expandBlockReplacement('看这个 https://a.dev/', 4, 18, B), `看这个\n\n${B}`);
	assert.equal(lc.expandBlockReplacement('https://a.dev/ 补充', 0, 14, B), `${B}\n\n补充`);
});
