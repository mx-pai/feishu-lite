import { commentId, safeCommentJson } from './comment-core';
export type ImageAlign = 'left'|'center'|'right';
export interface ImageRef { from:number;to:number;end:number;raw:string;token:string;target:string;alt:string;style:'wiki'|'markdown';width?:number;height?:number;title:string;id?:string;caption:string;align?:ImageAlign;prefix:string;suffix:string;lineFrom:number;lineTo:number }
export interface ImagePatch { target?:string;style?:'wiki'|'markdown';width?:number;caption?:string;align?:ImageAlign }
const EXT = /\.(png|jpe?g|webp|gif|svg|bmp|avif)(?:[#?].*)?$/i;
const EMBED = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(((?:\\.|[^()\\\n]|\([^()\n]*\))*)\)/g;
export const IMAGE_META = /[ \t]*%%fl-image:(.*?)%%/g;
function protectedRanges(text: string): {from:number;to:number}[] {
 const ranges: {from:number;to:number}[] = []; let at = 0, fence = '', size = 0, front = /^(?:\uFEFF)?---\r?\n/.test(text), hidden = false;
 const lines = text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
 for (let i = 0; i < lines.length; i++) {
  const line = lines[i], from = at; at += line.length;
  if (front) { ranges.push({from,to:at}); if (i > 0 && /^(---|\.\.\.)\s*$/.test(line.trim())) front = false; continue; }
  const m = /^\s{0,3}(?:>\s*)*(`{3,}|~{3,})/.exec(line);
  if (m) { ranges.push({from,to:at}); if (!fence) { fence = m[1][0]; size = m[1].length; } else if (fence === m[1][0] && m[1].length >= size && line.slice(line.indexOf(m[1])+m[1].length).trim() === '') fence = ''; continue; }
  if (fence || /^\s{4}\S|^\t/.test(line)) { ranges.push({from,to:at}); continue; }
  if (/^\s*%%\s*$/.test(line)) { hidden = !hidden; ranges.push({from,to:at}); continue; }
  if (hidden) ranges.push({from,to:at});
  for (const c of line.matchAll(/`+[^`\n]*`+|%%.*?%%/g)) ranges.push({from:from+c.index,to:from+c.index+c[0].length});
 }
 return ranges;
}
export function parseImages(text: string): ImageRef[] {
 const out: ImageRef[] = [], protectedParts = protectedRanges(text);
 for (const m of text.matchAll(EMBED)) {
  const from = m.index, to = from+m[0].length; if (protectedParts.some(r => from >= r.from && from < r.to)) continue;
  const wiki = m[1] !== undefined, parts = (wiki ? m[1] : m[2]).split('|');
  let target = wiki ? parts.shift()!.trim() : m[3].trim(), title = '';
  if (!wiki) { const titled = /^(.*?)(\s+["'][\s\S]*["'])$/.exec(target); if (titled) { target = titled[1]; title = titled[2]; } target = target.replace(/^<([\s\S]*)>$/,'$1'); }
  if (!EXT.test(target) && !/^https?:\/\//i.test(target)) continue;
  let width: number | undefined, height: number | undefined;
  if (parts.length && /^\d+(?:x\d+)?$/.test(parts[parts.length-1])) { const dimensions = parts.pop()!.split('x').map(Number); width = dimensions[0]; height = dimensions[1]; }
  const tail = /^[ \t]*%%fl-image:(.*?)%%/.exec(text.slice(to)); let id: string | undefined, caption = '', align:ImageAlign|undefined, end = to;
  if (tail) {
   let record: unknown; try { record = JSON.parse(tail[1]); } catch { throw new Error('图片元数据损坏，原文已保留'); }
   const meta = record as {v?: unknown; id?: unknown; caption?: unknown; align?: unknown} | null;
   if (!meta || meta.v !== 1 || typeof meta.id !== 'string' || !/^[a-z0-9-]+$/.test(meta.id) || typeof meta.caption !== 'string') throw new Error('图片元数据版本或结构无效');
   if (meta.align === 'left' || meta.align === 'center' || meta.align === 'right') align = meta.align;
   else if (meta.align !== undefined) throw new Error('图片对齐方式无效');
   id = meta.id; caption = meta.caption; end += tail[0].length;
  }
  const lineFrom = text.lastIndexOf('\n',from-1)+1, next = text.indexOf('\n',end);
  out.push({from,to,end,raw:text.slice(from,end),token:m[0],target,alt:parts.join('|'),style:wiki?'wiki':'markdown',width,height,title,id,caption,align,prefix:text.slice(Math.max(0,from-48),from),suffix:text.slice(end,end+48),lineFrom,lineTo:next < 0 ? text.length : next});
 }
 return out;
}
export function locateImage(text: string, ref: ImageRef): ImageRef {
 const images = parseImages(text);
 const matches = ref.id ? images.filter(r => r.id === ref.id) : images.filter(r => r.raw === ref.raw && r.prefix === ref.prefix && r.suffix === ref.suffix);
 if (matches.length !== 1) throw new Error('图片引用已变化或存在歧义，请重新点击图片');
 return matches[0];
}
export function imageToken(ref: ImageRef): string {
 const dimension = ref.width ? String(ref.width)+(ref.height?'x'+ref.height:'') : '', alt = [ref.alt,dimension].filter(Boolean).join('|');
 return ref.style === 'wiki' ? `![[${ref.target}${alt?'|'+alt:''}]]` : `![${alt.replace(/\]/g,'\\]')}](${/\s/.test(ref.target)?'<'+ref.target+'>':ref.target}${ref.title})`;
}
export function patchImage(text: string, reference: ImageRef, patch: ImagePatch): string {
 const ref = locateImage(text,reference), next = {...ref,...patch,id:ref.id ?? commentId()};
 if (patch.width !== undefined) { if (!Number.isInteger(patch.width) || patch.width < 0 || patch.width > 10000) throw new Error('宽度须为 0 到 10000 的整数'); next.width = patch.width || undefined; next.height = undefined; }
 if (patch.target !== undefined && (!patch.target || /[\r\n\]|]/.test(patch.target))) throw new Error('图片路径含不支持的字符');
 if (next.caption.length > 20000) throw new Error('图注过长');
 if (next.align !== undefined && !['left','center','right'].includes(next.align)) throw new Error('图片对齐方式无效');
 const raw = imageToken(next)+' '+`%%fl-image:${safeCommentJson({v:1,id:next.id,caption:next.caption,...(next.align?{align:next.align}:{})})}%%`;
 return text.slice(0,ref.from)+raw+text.slice(ref.end);
}
interface SourceLine { from:number;to:number;raw:string;text:string }
function sourceLines(text: string): SourceLine[] { let at=0; return (text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? []).map(raw => { const from=at; at+=raw.length; return {from,to:at,raw,text:raw.replace(/[\r\n]+$/,'')}; }); }
function pureImageLine(text: string, line: SourceLine, images: ImageRef[], quoted: boolean): ImageRef | null {
 const rows = images.filter(r => r.from >= line.from && r.end <= line.to); if (rows.length !== 1) return null;
 const r = rows[0], before = text.slice(line.from,r.from), after = text.slice(r.end,line.to).trim();
 return !after && (quoted ? /^\s*>\s*$/.test(before) : !before.trim()) ? r : null;
}
export function imageGrid(text: string, reference: ImageRef): {from:number;to:number;cols:number;rows:SourceLine[];index:number} | null {
 const ref = locateImage(text,reference), lines = sourceLines(text), index = lines.findIndex(l => ref.from >= l.from && ref.from < l.to); if (index < 0) return null;
 let head = index; while (head > 0 && /^\s*>/.test(lines[head-1].text)) head--;
 const match = /^\s*>\s*\[!img-([234])\][+-]?\s*$/i.exec(lines[head].text); if (!match) return null;
 let end = head+1; while (end < lines.length && /^\s*>/.test(lines[end].text)) end++;
 const images = parseImages(text), rows: SourceLine[] = [];
 for (let i=head+1;i<end;i++) { if (/^\s*>\s*$/.test(lines[i].text)) continue; if (!pureImageLine(text,lines[i],images,true)) throw new Error('此分栏含文字内容，请在源码中调整布局'); rows.push(lines[i]); }
 return {from:lines[head].from,to:lines[end-1].to,cols:Number(match[1]),rows,index:rows.findIndex(l => ref.from >= l.from && ref.from < l.to)};
}
export function setImageGrid(text: string, reference: ImageRef, cols: number): string {
 if (![0,2,3,4].includes(cols)) throw new Error('图片分栏支持 2、3、4 列');
 const ref = locateImage(text,reference), grid = imageGrid(text,ref), eol = text.includes('\r\n')?'\r\n':'\n';
 if (grid) { const rows = grid.rows.map(r => r.text.replace(/^\s*>\s?/,'')); const block = (cols ? [`> [!img-${cols}]`,...rows.map(r => '> '+r)] : rows).join(eol)+eol; return text.slice(0,grid.from)+block+text.slice(grid.to); }
 if (!cols) return text;
 const lines = sourceLines(text), images = parseImages(text), selected = lines.findIndex(l => ref.from >= l.from && ref.from < l.to);
 if (!pureImageLine(text,lines[selected],images,false)) throw new Error('分栏需要图片独占一行');
 let first=selected,last=selected;
 for (let i=selected-1;i>=0;i--) { if (!lines[i].text.trim()) continue; if (pureImageLine(text,lines[i],images,false)) first=i; else break; }
 for (let i=selected+1;i<lines.length;i++) { if (!lines[i].text.trim()) continue; if (pureImageLine(text,lines[i],images,false)) last=i; else break; }
 const rows = lines.slice(first,last+1).filter(l => l.text.trim()).map(l => '> '+l.text);
 return text.slice(0,lines[first].from)+[`> [!img-${cols}]`,...rows].join(eol)+eol+text.slice(lines[last].to);
}
export function reorderImage(text: string, reference: ImageRef, direction: -1 | 1): string {
 const grid = imageGrid(text,reference); if (!grid || grid.index < 0) throw new Error('请先把图片放入分栏');
 const other=grid.index+direction; if (other < 0 || other >= grid.rows.length) return text;
 const a=grid.rows[Math.min(grid.index,other)], b=grid.rows[Math.max(grid.index,other)];
 return text.slice(0,a.from)+b.text+a.raw.slice(a.text.length)+text.slice(a.to,b.from)+a.text+b.raw.slice(b.text.length)+text.slice(b.to);
}

/** A separate native callout owns the image and editable Markdown alongside it. */
export function imageTextBlock(text:string,reference:ImageRef): {from:number;to:number;side:'left'|'right';content:string} | null {
 const ref=locateImage(text,reference), lines=sourceLines(text), index=lines.findIndex(l => ref.from>=l.from && ref.from<l.to);
 let head=index; while(head>0 && /^\s*>/.test(lines[head-1].text)) head--;
 const match=/^>\s*\[!img-text-(left|right)\]\s*$/i.exec(lines[head]?.text ?? ''); if(!match) return null;
 let end=head+1; while(end<lines.length && /^>/.test(lines[end].text)) end++;
 const images=parseImages(text).filter(r=>r.from>=lines[head].from && r.from<lines[end-1].to);
 if(images.length!==1 || !lines[head+1] || !pureImageLine(text,lines[head+1],images,true) || ref.lineFrom!==lines[head+1].from || !/^>\s*$/.test(lines[head+2]?.text ?? '')) throw new Error('图文块结构已变化，请在源码中整理为一张图片和旁边文字');
 const content=lines.slice(head+3,end).map(l=>l.text.replace(/^>\s?/,'' )).join('\n');
 return {from:lines[head].from,to:lines[end-1].to,side:match[1].toLowerCase() as 'left'|'right',content};
}
export function setImageText(text:string,reference:ImageRef,side:'left'|'right'|'none',content?:string): string {
 if(!['left','right','none'].includes(side)) throw new Error('图文位置无效');
 const ref=locateImage(text,reference), block=imageTextBlock(text,ref), eol=text.includes('\r\n')?'\r\n':'\n';
 if(!block && side==='none') return text;
 if(!block && !pureImageLine(text,sourceLines(text).find(l=>l.from===ref.lineFrom)!,parseImages(text),false)) throw new Error('图文并排需要图片独占一行，分栏中的图片请先取消分栏');
 const body=content ?? block?.content ?? '在这里填写图片旁边的说明';
 if(body.length>50000 || /(?:^|\n)\s*>?\s*\[!img-text-|%%fl-image:/.test(body) || parseImages(body).length) throw new Error('旁边文字支持 Markdown 正文，请将其他图片放在图文块外');
 const rows=body.replace(/\r\n/g,'\n').split('\n');
 const replacement=(side==='none' ? [ref.raw,'',...rows] : [`> [!img-text-${side}]`,'> '+ref.raw,'>',...rows.map(l=>'> '+l)]).join(eol)+eol+eol;
 const from=block?.from ?? ref.lineFrom, to=block?.to ?? (text.indexOf('\n',ref.lineTo)===ref.lineTo?ref.lineTo+1:ref.lineTo);
 const before=text.slice(0,from), gap=before && !before.endsWith(eol+eol)?eol:'';
 return before+gap+replacement+text.slice(to);
}
/** Project a corner gesture onto the aspect-ratio ray; side handles use horizontal motion. */
export function resizedImageWidth(width:number,height:number,dx:number,dy:number,hx:number,hy:number,limit:number,centered=false):number {
 if(![width,height,dx,dy,hx,hy,limit].every(Number.isFinite) || width<=0 || height<=0 || limit<1) throw new Error('图片缩放尺寸无效');
 const slope=hy ? height/width : 0;
 const delta=(hx*dx+slope*hy*dy)/(1+slope*slope)*(centered?2:1);
 return Math.round(Math.max(Math.min(24,limit),Math.min(10000,limit,width+delta)));
}

export interface Point {x:number;y:number}
export interface Rect {x:number;y:number;width:number;height:number}
export interface ImageShape {id:string;kind:'rect'|'arrow'|'pen'|'text';color:string;width:number;points:Point[];text?:string;fontSize?:number}
export interface ImageProject {version:1;original:string;width:number;height:number;crop:Rect;shapes:ImageShape[];sourceMtime?:number}
/** A single filled contour joins a flat tail, straight shaft and pointed head. */
export function arrowOutline(from:Point,to:Point,width:number):Point[] {
 if(![from.x,from.y,to.x,to.y,width].every(Number.isFinite) || width<=0)throw new Error('箭头坐标或笔宽无效');
 const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
 if(length<1e-6)return [];
 const ux=dx/length,uy=dy/length,nx=-uy,ny=ux;
 const headLength=Math.min(Math.max(18,width*5),length*.45),headHalf=Math.min(Math.max(6,width*2),length*.3),shaftHalf=Math.min(width/2,headHalf*.4);
 const point=(along:number,across:number):Point=>({x:from.x+ux*along+nx*across,y:from.y+uy*along+ny*across});
 const neck=length-headLength;
 return [point(0,shaftHalf),point(neck,shaftHalf),point(neck,headHalf),{...to},point(neck,-headHalf),point(neck,-shaftHalf),point(0,-shaftHalf)];
}
/** Store source pixels while keeping a new arrow's visible stroke consistent. */
export function arrowStrokeWidth(previewPixels:number,imageWidth:number,previewWidth:number):number {
 if(![previewPixels,imageWidth,previewWidth].every(v=>Number.isFinite(v) && v>0))throw new Error('箭头预览尺寸无效');
 return Math.min(200,previewPixels*imageWidth/previewWidth);
}
export const MAX_PIXELS = 32_000_000;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function normalizeRect(a: Point, b: Point, width: number, height: number): Rect {
 const x=Math.max(0,Math.min(width-1,Math.round(Math.min(a.x,b.x)))), y=Math.max(0,Math.min(height-1,Math.round(Math.min(a.y,b.y))));
 const right=Math.max(x+1,Math.min(width,Math.round(Math.max(a.x,b.x)))), bottom=Math.max(y+1,Math.min(height,Math.round(Math.max(a.y,b.y))));
 return {x,y,width:right-x,height:bottom-y};
}
export function canvasPoint(client: Point, bounds: Rect, width: number, height: number): Point { return {x:Math.max(0,Math.min(width,(client.x-bounds.x)/bounds.width*width)),y:Math.max(0,Math.min(height,(client.y-bounds.y)/bounds.height*height))}; }
export function validateProject(input: unknown): ImageProject {
 const p = input as ImageProject;
 if (!p || p.version !== 1 || typeof p.original !== 'string' || !EXT.test(p.original) || p.original.startsWith('/') || p.original.startsWith('.') || /^[a-z]+:/i.test(p.original) || p.original.includes('\\') || p.original.split('/').some(s => s === '..') || !finite(p.width) || !finite(p.height) || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0 || p.width*p.height > MAX_PIXELS || Math.max(p.width,p.height) > 16384) throw new Error('图片项目版本、路径或尺寸无效');
 const c=p.crop;
 if (!c || ![c.x,c.y,c.width,c.height].every(v => finite(v) && Number.isInteger(v)) || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x+c.width > p.width || c.y+c.height > p.height) throw new Error('裁剪范围超出原图');
 if (p.sourceMtime !== undefined && !finite(p.sourceMtime)) throw new Error('图片项目时间无效');
 if (!Array.isArray(p.shapes) || p.shapes.length > 500 || new Set(p.shapes.map(s => s.id)).size !== p.shapes.length) throw new Error('标注数量或 ID 无效');
 for (const s of p.shapes) {
  if (!s || !/^[a-z0-9-]+$/.test(s.id) || !['rect','arrow','pen','text'].includes(s.kind) || !/^#[0-9a-f]{6}$/i.test(s.color) || !finite(s.width) || s.width <= 0 || s.width > 200 || !Array.isArray(s.points) || s.points.length < (s.kind === 'text'?1:2) || s.points.length > 5000 || s.points.some(a => !finite(a.x) || !finite(a.y) || a.x < 0 || a.x > p.width || a.y < 0 || a.y > p.height)) throw new Error('标注数据无效');
  if (s.kind === 'text' && (typeof s.text !== 'string' || !s.text.trim() || s.text.length > 2000 || !finite(s.fontSize) || s.fontSize <= 0 || s.fontSize > 500)) throw new Error('文字标注数据无效');
 }
 return p;
}
export function shapeBounds(s: ImageShape): Rect {
 const xs=s.points.map(p => p.x), ys=s.points.map(p => p.y), x=Math.min(...xs), y=Math.min(...ys);
 const lines=s.text?.split('\n') ?? [''], font=s.fontSize ?? 20;
 return {x,y,width:s.kind === 'text'?Math.max(1,...lines.map(line => Array.from(line).length*font)):Math.max(...xs)-x,height:s.kind === 'text'?lines.length*font*1.2:Math.max(...ys)-y};
}
