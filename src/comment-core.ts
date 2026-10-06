/** Versioned note-owned threads, anchored at paragraph ends. */
export interface CommentMessage { id: string; author: string; text: string; created: string; updated: string }
export interface CommentThread {
 id: string; status: 'open' | 'resolved'; created: string; updated: string; excerpt: string;
 anchor: { blockId?: string; quote: string; prefix: string; suffix: string }; messages: CommentMessage[];
}
export interface CommentDocument { body: string; threads: CommentThread[]; storeFrom: number; storeTo: number; version: number }
export interface CommentAnchor { from: number; to: number; state: 'attached' | 'recovered' | 'detached'; exact: boolean; reason?: string }
export interface Paragraph { from: number; to: number; text: string; blockId?: string }
const STORE = /^%%\r?\nfeishu-lite-comments:v(\d+)\r?\n([\s\S]*?)\r?\n\/feishu-lite-comments\r?\n%%[ \t]*(?:\r?\n)?/gm;
export const COMMENT_MARKER = /%%fl-comment:([a-z0-9-]+):(start|end)%%/g;
export const BLOCK_MARKER = /[ \t]*%%fl-block:([a-z0-9-]+)%%/g;
const STANDALONE_BLOCK = /^[ \t]*(?:%%fl-block:[a-z0-9-]+%%[ \t]*)+(?:\r?\n|$)/gm;
const ID = /^[a-z0-9-]+$/;
const all = (s: string, re: RegExp) => Array.from(s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')));
export function commentId(): string { const bytes = new Uint8Array(12); crypto.getRandomValues(bytes); return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export const marker = (id: string, end = false) => `%%fl-comment:${id}:${end ? 'end' : 'start'}%%`;
export const blockMarker = (id: string) => ` %%fl-block:${id}%%`;
export const stripCommentMarkers = (s: string) => s.replace(COMMENT_MARKER, '').replace(STANDALONE_BLOCK, '').replace(BLOCK_MARKER, '');
export const safeCommentJson = (v: unknown) => JSON.stringify(v).replace(/%/g, '\\u0025');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function validMessage(m: unknown): m is CommentMessage {
 return object(m) && typeof m.id === 'string' && ID.test(m.id) && ['author','text','created','updated'].every(k => typeof m[k] === 'string') && !!(m.text as string).trim();
}
function validThread(t: unknown): t is CommentThread {
 return object(t) && typeof t.id === 'string' && ID.test(t.id) && (t.status === 'open' || t.status === 'resolved') && typeof t.created === 'string' && typeof t.updated === 'string' && object(t.anchor) &&
 ['quote','prefix','suffix'].every(k => typeof (t.anchor as Record<string, unknown>)[k] === 'string') && (t.anchor.blockId === undefined || typeof t.anchor.blockId === 'string' && ID.test(t.anchor.blockId)) &&
 Array.isArray(t.messages) && t.messages.length > 0 && t.messages.every(validMessage) && new Set(t.messages.map((m: CommentMessage) => m.id)).size === t.messages.length;
}
export function parseComments(text: string): CommentDocument {
 if (/^(<{7}|={7}|>{7})/m.test(text)) throw new Error('笔记存在 Git 合并冲突，请先处理冲突');
 const stores = all(text, STORE);
 if (stores.length > 1) throw new Error('存在多个批注存储区，请先处理同步冲突');
 if (!stores.length) { if (/^feishu-lite-comments:v/m.test(text)) throw new Error('批注存储区不完整，原文已保留'); return {body:text,threads:[],storeFrom:text.length,storeTo:text.length,version:2}; }
 const s = stores[0], version = Number(s[1]), from = s.index, to = from + s[0].length;
 if (version !== 1 && version !== 2) throw new Error(`批注格式 v${version} 需要更新插件`);
 if (text.slice(to).trim()) throw new Error('批注存储区须位于文末，请先整理笔记');
 const threads: CommentThread[] = [];
 for (const line of s[2].split(/\r?\n/).filter(l => l.trim())) {
  let t: unknown; try { t = JSON.parse(line); } catch { throw new Error('批注 JSON 损坏，原文已保留'); }
  if (!validThread(t) || version === 2 && typeof t.excerpt !== 'string') throw new Error('批注数据结构不完整，原文已保留');
  t.excerpt ??= t.anchor.quote; threads.push(t);
 }
 if (new Set(threads.map(t => t.id)).size !== threads.length) throw new Error('批注 ID 重复，请先处理同步冲突');
 return {body:text.slice(0,from),threads,storeFrom:from,storeTo:to,version};
}
export function writeComments(body: string, threads: CommentThread[]): string {
 if (threads.some(t => !validThread(t) || typeof t.excerpt !== 'string')) throw new Error('批注内容或 ID 无效');
 if (new Set(threads.map(t => t.id)).size !== threads.length) throw new Error('批注 ID 重复');
 // Heading text also supplies Obsidian's section-link identifier. Keep it intact.
 body=body.replace(/^(\s{0,3}#{1,6}[ \t]+[^\r\n]+)(\r?\n|$)/gm,(whole,heading:string,eol:string) => {
  const marks=all(heading,BLOCK_MARKER); if (!marks.length) return whole;
  const newline=eol || (body.includes('\r\n')?'\r\n':'\n');
  return heading.replace(BLOCK_MARKER,'')+newline+marks.map(m => `%%fl-block:${m[1]}%%`).join(' ')+eol;
 });
 if (!threads.length) return body;
 const eol = body.includes('\r\n') ? '\r\n' : '\n';
 const records = [...threads].sort((a,b) => a.id.localeCompare(b.id)).map(safeCommentJson).join(eol);
 return body.replace(/[\r\n]*$/, '') + [eol + eol + '%%','feishu-lite-comments:v2',records,'/feishu-lite-comments','%%',''].join(eol);
}
/** 单条段落表缓存：同一份正文（字符串相等）反复定位时不再整篇重扫（光标移动/按键的高频路径） */
let paragraphCache: { body: string; paragraphs: Paragraph[] } | null = null;

/** 段落表。按 body 缓存，返回的数组视为只读（请勿原地修改）；正文变化后自动重建。 */
export function commentParagraphs(body: string): Paragraph[] {
 if (paragraphCache && paragraphCache.body === body) return paragraphCache.paragraphs;
 const paragraphs = scanParagraphs(body); paragraphCache = { body, paragraphs }; return paragraphs;
}

function scanParagraphs(body: string): Paragraph[] {
 const lines = body.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [], out: Paragraph[] = [];
 let offset = 0, active: Paragraph | null = null, front = /^(?:\uFEFF)?---\r?\n/.test(body), fence = '', fenceLength = 0, hidden = false, math = false;
 const flush = () => { if (active) { active.text = body.slice(active.from, active.to); active.blockId = all(active.text,BLOCK_MARKER)[0]?.[1]; out.push(active); active = null; } };
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i], line = raw.replace(/[\r\n]+$/, ''), from = offset, to = from + line.length; offset += raw.length;
  if (front) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false; flush(); continue; }
  const fm = /^\s{0,3}(?:>\s*)*(`{3,}|~{3,})/.exec(line);
  if (fm) { flush(); if (!fence) { fence = fm[1][0]; fenceLength = fm[1].length; } else if (fm[1][0] === fence && fm[1].length >= fenceLength && line.slice(line.indexOf(fm[1]) + fm[1].length).trim() === '') fence = ''; continue; }
  if (fence) continue;
  if (!hidden && !math && all(line,BLOCK_MARKER).length && !stripCommentMarkers(line).trim()) {
   if (active && /^\r?\n$/.test(body.slice(active.to,from))) { active.to=to; flush(); }
   else { const previous=out[out.length-1]; if (previous && /^\r?\n$/.test(body.slice(previous.to,from))) { previous.to=to; previous.text=body.slice(previous.from,to); previous.blockId=all(previous.text,BLOCK_MARKER)[0]?.[1]; } }
   continue;
  }
  const count = (stripCommentMarkers(line).match(/%%/g) ?? []).length;
  if (hidden || count) { flush(); if (count % 2) hidden = !hidden; continue; }
  if (/^\s*\$\$/.test(line)) { flush(); if ((line.match(/\$\$/g) ?? []).length % 2) math = !math; continue; }
  if (math || !line.trim() || /^(?:\s{4}|\t)/.test(line) || /^\s*(?:\||<|(?:[-*_]\s*){3,}$|>\s*\[!|\[\^[^\]]+\]:|\[[^\]]+\]:|={3,}\s*$|-{3,}\s*$)/.test(line)) { flush(); continue; }
  if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+/.test(lines[i+1]?.trim() ?? '')) { flush(); continue; }
  if (/^\s{0,3}(?:#{1,6}\s|(?:[-+*]|\d+[.)])\s|>)/.test(line)) flush();
  if (!active) active = {from,to,text:''}; else active.to = to;
  if (/^\s{0,3}#{1,6}\s/.test(line)) flush();
 }
 flush(); return out;
}
export function assertCommentSelection(body: string, from: number, to: number): Paragraph {
 if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > body.length || !stripCommentMarkers(body.slice(from,to)).trim()) throw new Error('请先选中要批注的正文');
 while (to > from && /[\r\n]/.test(body[to-1])) to--;
 const p = commentParagraphs(body).find(p => from >= p.from && to <= p.to);
 if (!p) throw new Error('请选择同一段正文，代码、表格和属性区暂不支持批注');
 return p;
}
function quoteAnchor(body: string, from: number, to: number, blockId: string): CommentThread['anchor'] {
 return {blockId,quote:stripCommentMarkers(body.slice(from,to)).trimEnd(),prefix:stripCommentMarkers(body.slice(0,from)).slice(-48),suffix:stripCommentMarkers(body.slice(to)).slice(0,48)};
}
const detached = (reason: string): CommentAnchor => ({from:0,to:0,state:'detached',exact:false,reason});
function quoteHits(body: string, t: CommentThread, from: number, to: number): number[] {
 const q = t.anchor.quote, hits: number[] = []; if (!q) return hits;
 for (let p = body.indexOf(q,from); p >= 0 && p + q.length <= to; p = body.indexOf(q,p+1)) hits.push(p);
 if (hits.length <= 1) return hits;
 return hits.filter(p => (!t.anchor.prefix || stripCommentMarkers(body.slice(Math.max(0,p-248),p)).endsWith(t.anchor.prefix)) && (!t.anchor.suffix || stripCommentMarkers(body.slice(p+q.length,p+q.length+248)).startsWith(t.anchor.suffix)));
}
/** paragraphs 可传预计算的段落表（同一 body 上批量定位时只建一次），省略时按缓存取用 */
export function locateComment(body: string, t: CommentThread, paragraphs?: Paragraph[]): CommentAnchor {
 if (t.anchor.blockId) {
  const marks = all(body,BLOCK_MARKER).filter(m => m[1] === t.anchor.blockId);
  if (marks.length > 1) return detached('段落锚点被重复复制，请重新关联');
  if (marks.length === 1) {
   const p = (paragraphs ?? commentParagraphs(body)).find(p => marks[0].index >= p.from && marks[0].index < p.to);
   if (!p) return detached('段落结构已变化，请重新关联');
   const end = marks[0].index, hits = quoteHits(body,t,p.from,end);
   if (hits.length === 1) return {from:hits[0],to:hits[0]+t.anchor.quote.length,state:'attached',exact:true};
   if (end <= p.from || !body.slice(p.from,end).trim()) return detached('原段落已删除');
   return {from:p.from,to:end,state:'attached',exact:false,reason:'原文已变化，已定位到原段落'};
  }
 } else {
  const start = marker(t.id), end = marker(t.id,true), a = body.split(start).length-1, b = body.split(end).length-1;
  if (a || b) { if (a !== 1 || b !== 1) return detached('旧锚点缺失或重复，请重新关联'); const from = body.indexOf(start)+start.length, to = body.indexOf(end); return to > from ? {from,to,state:'attached',exact:true} : detached('旧锚点顺序变化'); }
 }
 const list = paragraphs ?? commentParagraphs(body), hits = quoteHits(body,t,0,body.length).filter(p => list.some(b => p >= b.from && p+t.anchor.quote.length <= b.to));
 return hits.length === 1 ? {from:hits[0],to:hits[0]+t.anchor.quote.length,state:'recovered',exact:true,reason:'根据原文恢复，可重新关联固定位置'} : detached(hits.length > 1 ? '原文有多个候选，请重新关联' : '原文已变化，请重新关联');
}
function cleanUnusedBlocks(body: string, threads: CommentThread[]): string {
 const used = new Set(threads.map(t => t.anchor.blockId));
 body=body.replace(STANDALONE_BLOCK,line => { const marks=all(line,BLOCK_MARKER).filter(m => used.has(m[1])); return marks.length ? marks.map(m => `%%fl-block:${m[1]}%%`).join(' ')+(line.endsWith('\r\n')?'\r\n':line.endsWith('\n')?'\n':'') : ''; });
 return body.replace(BLOCK_MARKER,(s: string,id: string) => used.has(id) ? s : '');
}
function attach(d: CommentDocument, t: CommentThread, from: number, to: number): void {
 const p = assertCommentSelection(d.body,from,to), markers = all(p.text,BLOCK_MARKER);
 const existing = markers.find(m => all(d.body,BLOCK_MARKER).filter(n => n[1] === m[1]).length === 1);
 const id = existing?.[1] ?? commentId(); t.anchor = quoteAnchor(d.body,from,to,id);
 if (!existing) {
  const closing = /^\s{0,3}#{1,6}\s/.test(p.text) ? /[ \t]+#+[ \t]*$/.exec(p.text) : null;
  const at = closing ? p.to-closing[0].length : p.to;
  d.body = d.body.slice(0,at) + blockMarker(id) + d.body.slice(at);
 }
}
export function addComment(text: string, from: number, to: number, message: CommentMessage, id: string, excerpt?: string): string {
 if (!ID.test(id) || !validMessage(message)) throw new Error('批注内容不能为空，ID 必须有效');
 const d = parseComments(text); if (d.threads.some(t => t.id === id)) throw new Error('批注 ID 已存在');
 const t: CommentThread = {id,status:'open',created:message.created,updated:message.updated,excerpt:excerpt ?? stripCommentMarkers(d.body.slice(from,to)).trim(),anchor:{quote:'',prefix:'',suffix:''},messages:[message]};
 attach(d,t,from,to); d.threads.push(t); return writeComments(d.body,d.threads);
}
export function updateThread(text: string, id: string, update: (t: CommentThread) => void): string {
 const d = parseComments(text), t = d.threads.find(t => t.id === id); if (!t) throw new Error('该批注已被删除，请刷新面板');
 update(t); t.updated = new Date().toISOString(); return writeComments(d.body,d.threads);
}
export function deleteComment(text: string, id: string): string {
 const d = parseComments(text); d.threads = d.threads.filter(t => t.id !== id); d.body = d.body.split(marker(id)).join('').split(marker(id,true)).join('');
 return writeComments(cleanUnusedBlocks(d.body,d.threads),d.threads);
}
export function reanchorComment(text: string, id: string, from: number, to: number): string {
 const d = parseComments(text), t = d.threads.find(t => t.id === id); if (!t) throw new Error('批注已不存在');
 const tokens = [marker(id),marker(id,true)];
 const removedBefore = (pos: number) => all(d.body,COMMENT_MARKER).filter(m => tokens.includes(m[0]) && m.index < pos).reduce((n,m) => n + Math.min(m[0].length,pos-m.index),0);
 const a = from-removedBefore(from), b = to-removedBefore(to); d.body = d.body.split(tokens[0]).join('').split(tokens[1]).join('');
 attach(d,t,a,b); t.updated = new Date().toISOString(); return writeComments(cleanUnusedBlocks(d.body,d.threads),d.threads);
}
/** Source prose remains; destination can attach to existing text or append an excerpt. */
export function planCommentMove(source: string, target: string, id: string, range?: {from:number;to:number}): {source:string;target:string;count:number} {
 const s = parseComments(source), d = parseComments(target), t = s.threads.find(t => t.id === id); if (!t) throw new Error('批注已不存在');
 if (d.threads.some(t => t.id === id)) throw new Error('目标笔记已含该批注，请处理重复副本');
 if (!range) { const excerpt = t.excerpt.replace(/\r?\n/g,' ').trim(); if (!excerpt) throw new Error('原始摘录为空，请选择目标段落'); d.body = d.body.replace(/[\r\n]*$/,'')+'\n\n> '+excerpt+'\n'; const from = d.body.length-excerpt.length-1; range = {from,to:from+excerpt.length}; }
 attach(d,t,range.from,range.to); t.updated = new Date().toISOString(); d.threads.push(t);
 return {source:deleteComment(source,id),target:writeComments(d.body,d.threads),count:1};
}
export function exportComments(text: string, title: string): string {
 return [`# ${title} · 批注`,...parseComments(text).threads.map(t => `\n## ${t.status === 'resolved' ? '已解决' : '待处理'} · ${t.created}\n\n> ${t.excerpt.replace(/\r?\n/g,'\n> ')}\n\n` + t.messages.map(m => `**${m.author || '我'}** · ${m.updated}\n\n${m.text}`).join('\n\n'))].join('\n');
}
