import { App, Modal, Notice, TFile } from 'obsidian';
import { action, reportError, TextDialog } from './dialogs';
import { commentId } from './comment-core';
import { arrowOutline, arrowStrokeWidth, canvasPoint, MAX_PIXELS, normalizeRect, shapeBounds, validateProject } from './image-core';
import type { ImageProject, ImageShape, Point } from './image-core';

export function drawShape(ctx: CanvasRenderingContext2D, shape: ImageShape): void {
 ctx.save(); ctx.strokeStyle=shape.color; ctx.fillStyle=shape.color; ctx.lineWidth=shape.width; ctx.lineCap='round'; ctx.lineJoin='round';
 const [a,b]=shape.points;
 if (shape.kind === 'rect') ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));
 else if (shape.kind === 'text') { ctx.font=`${shape.fontSize}px sans-serif`; ctx.textBaseline='top'; for (const [i,line] of shape.text!.split('\n').entries()) ctx.fillText(line,a.x,a.y+i*shape.fontSize!*1.2); }
 else if(shape.kind==='arrow') {
  const outline=arrowOutline(a,shape.points[shape.points.length-1],shape.width);
  if(outline.length){ctx.beginPath();ctx.moveTo(outline[0].x,outline[0].y);for(const p of outline.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill();}
 }
 else {
  ctx.beginPath(); ctx.moveTo(a.x,a.y); for (const p of shape.points.slice(1)) ctx.lineTo(p.x,p.y); ctx.stroke();
 }
 ctx.restore();
}
export function renderProject(image: CanvasImageSource, project: ImageProject, doc: Document = document): HTMLCanvasElement {
 validateProject(project); const canvas=doc.win.createEl('canvas'), c=project.crop; canvas.width=c.width; canvas.height=c.height;
 const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('当前设备无法创建图片画布');
 ctx.translate(-c.x,-c.y); ctx.drawImage(image,0,0,project.width,project.height); for (const shape of project.shapes) drawShape(ctx,shape); return canvas;
}
const clone = (p: ImageProject): ImageProject => JSON.parse(JSON.stringify(p)) as ImageProject;
export class ImageEditorModal extends Modal {
 private project!: ImageProject; private image!: HTMLImageElement; private canvas!: HTMLCanvasElement; private status!: HTMLElement;
 private tool: ImageShape['kind']|'crop'|'select' = 'crop'; private color='#ff453a'; private width=5; private fontSize=32;
 private undo: ImageProject[]=[]; private redo: ImageProject[]=[]; private before: ImageProject | null=null;
 private start: Point | null=null; private draft: ImageShape | null=null; private selected=''; private dragging=false; private pointer=-1;
 private observer: ResizeObserver | null=null; private closed=false; private busy=false; private toolButtons=new Map<string,HTMLElement>();
 constructor(app: App, private source: TFile, private existing: ImageProject | null, private saveImage: (project:ImageProject,data:ArrayBuffer) => Promise<void>) { super(app); }
 onOpen(): void {
  this.closed=false; this.modalEl.addClass('fl-image-editor'); this.titleEl.setText('裁剪与标注 · '+this.source.name);
  this.status=this.contentEl.createDiv({cls:'fl-editor-status',text:'正在加载原图…'});
  void this.load().catch(err => { this.status.setText(err instanceof Error ? err.message : String(err)); reportError(err); });
 }
 private async load(): Promise<void> {
  this.image=new Image(); this.image.src=this.app.vault.getResourcePath(this.source);
  await new Promise<void>((resolve,reject) => { this.image.onload=() => resolve(); this.image.onerror=() => reject(new Error('原图加载失败')); if (this.image.complete && this.image.naturalWidth) resolve(); });
  if (this.closed) return;
  const width=this.image.naturalWidth,height=this.image.naturalHeight;
  if (width*height > MAX_PIXELS || Math.max(width,height) > 16384) throw new Error('原图超过安全画布预算，请先缩小图片');
  this.project=this.existing ? clone(validateProject(this.existing)) : {version:1,original:this.source.path,width,height,sourceMtime:this.source.stat.mtime,crop:{x:0,y:0,width,height},shapes:[]};
  if (this.project.width !== width || this.project.height !== height || this.project.sourceMtime !== undefined && this.project.sourceMtime !== this.source.stat.mtime) throw new Error('原图已发生变化，请恢复原图后重新开始编辑');
  const tools=this.contentEl.createDiv({cls:'fl-image-editor-tools'});
  for (const [kind,label] of [['crop','裁剪'],['arrow','箭头'],['rect','方框'],['pen','画笔'],['text','文字'],['select','选择/移动']]) this.toolButtons.set(kind,action(tools,label,() => { this.tool=kind as typeof this.tool; this.sync(); }));
  const color=tools.createEl('input',{type:'color',attr:{'aria-label':'标注颜色'}}); color.value=this.color; color.oninput=() => { this.color=color.value; };
  const line=tools.createEl('input',{type:'number',attr:{min:'1',max:'100','aria-label':'笔宽',title:'笔宽，箭头按当前预览像素计算'}}); line.value=String(this.width); line.onchange=() => { this.width=Math.max(1,Math.min(100,Number(line.value)||5)); line.value=String(this.width); };
  const font=tools.createEl('input',{type:'number',attr:{min:'8',max:'200','aria-label':'文字大小',title:'文字大小'}}); font.value=String(this.fontSize); font.onchange=() => { this.fontSize=Math.max(8,Math.min(200,Number(font.value)||32)); font.value=String(this.fontSize); };
  const host=this.contentEl.createDiv({cls:'fl-image-canvas-host'}); host.tabIndex=0;
  this.canvas=host.createEl('canvas',{attr:{'aria-label':'图片编辑画布'}});
  const scale=Math.min(1,1400/Math.max(width,height)); this.canvas.width=Math.round(width*scale); this.canvas.height=Math.round(height*scale);
  this.canvas.addEventListener('pointerdown',e => this.down(e)); this.canvas.addEventListener('pointermove',e => this.move(e)); this.canvas.addEventListener('pointerup',e => this.up(e)); this.canvas.addEventListener('pointercancel',() => this.cancelGesture());
  this.contentEl.addEventListener('keydown',e => { if (e.isComposing || (e.target as HTMLElement)?.matches('input,textarea')) return;
   if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.history(e.shiftKey); }
   if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeSelected(); }
  });
  const footer=this.contentEl.createDiv({cls:'fl-image-editor-footer'});
  action(footer,'撤销',() => this.history(false)); action(footer,'重做',() => this.history(true)); action(footer,'删除标注',() => this.removeSelected());
  action(footer,'取消裁剪',() => this.mutate(() => { this.project.crop={x:0,y:0,width,height}; }));
  action(footer,'重置',() => this.mutate(() => { this.project.crop={x:0,y:0,width,height}; this.project.shapes=[]; this.selected=''; }));
  action(footer,'取消',() => { if (!this.busy) this.close(); });
  action(footer,'保存新图片',async () => {
   if (this.dragging) this.cancelGesture(); this.busy=true; this.modalEl.addClass('is-saving');
   try { if (this.source.stat.mtime !== this.project.sourceMtime) throw new Error('原图已变化，请重新打开编辑器');
    const output=renderProject(this.image,this.project,this.canvas.ownerDocument);
    const blob=await new Promise<Blob>((resolve,reject) => output.toBlob(b => b ? resolve(b) : reject(new Error('图片导出失败')),'image/png'));
    await this.saveImage(clone(this.project),await blob.arrayBuffer()); this.busy=false; this.close();
   } finally { this.busy=false; this.modalEl.removeClass('is-saving'); }
  },'mod-cta');
  this.observer=new ResizeObserver(() => this.fit()); this.observer.observe(host); this.fit(); this.sync();
 }
 private point(e: PointerEvent): Point { const r=this.canvas.getBoundingClientRect(); return canvasPoint({x:e.clientX,y:e.clientY},{x:r.left,y:r.top,width:r.width,height:r.height},this.project.width,this.project.height); }
 private down(e: PointerEvent): void {
  if (this.busy || e.button !== 0 || this.dragging) return;
  if (!['select','crop'].includes(this.tool) && this.project.shapes.length>=500) { new Notice('当前项目已达到 500 条标注，请先删除部分标注'); return; }
  e.preventDefault(); this.canvas.parentElement?.focus(); const p=this.point(e);
  if (this.tool === 'text') { new TextDialog(this.app,'文字标注','',text => this.mutate(() => { this.project.shapes.push({id:commentId(),kind:'text',color:this.color,width:this.width,points:[p],text,fontSize:this.fontSize}); })).open(); return; }
  this.before=clone(this.project); this.start=p; this.dragging=true; this.pointer=e.pointerId; this.canvas.setPointerCapture(e.pointerId);
  if (this.tool === 'select') { const tolerance=12*this.project.width/this.canvas.getBoundingClientRect().width;
   this.selected=[...this.project.shapes].reverse().find(s => { const r=shapeBounds(s); return p.x >= r.x-tolerance && p.x <= r.x+r.width+tolerance && p.y >= r.y-tolerance && p.y <= r.y+r.height+tolerance; })?.id ?? '';
  } else if (this.tool !== 'crop') this.draft={id:commentId(),kind:this.tool,color:this.color,width:this.tool==='arrow'?arrowStrokeWidth(this.width,this.project.width,this.canvas.getBoundingClientRect().width):this.width,points:[p,p]};
  this.draw();
 }
 private move(e: PointerEvent): void {
  if (!this.dragging || this.pointer !== e.pointerId || !this.start) return; e.preventDefault(); const p=this.point(e);
  if (this.tool === 'crop') this.project.crop=normalizeRect(this.start,p,this.project.width,this.project.height);
  else if (this.tool === 'select' && this.selected && this.before) {
   const original=this.before.shapes.find(s => s.id === this.selected)!, current=this.project.shapes.find(s => s.id === this.selected)!;
   const r=shapeBounds(original), dx=Math.max(-r.x,Math.min(this.project.width-r.x-r.width,p.x-this.start.x)), dy=Math.max(-r.y,Math.min(this.project.height-r.y-r.height,p.y-this.start.y));
   current.points=original.points.map(a => ({x:a.x+dx,y:a.y+dy}));
  } else if (this.draft) {
   if (this.draft.kind === 'pen') { const last=this.draft.points[this.draft.points.length-1]; if (Math.hypot(p.x-last.x,p.y-last.y)>1 && this.draft.points.length<5000) this.draft.points.push(p); }
   else this.draft.points[1]=p;
  }
  this.draw();
 }
 private up(e: PointerEvent): void {
  if (!this.dragging || this.pointer !== e.pointerId) return; this.move(e);
  if (this.tool === 'crop' && this.start && Math.hypot(this.point(e).x-this.start.x,this.point(e).y-this.start.y) < 3 && this.before) this.project.crop=this.before.crop;
  if (this.draft) { if (Math.hypot(this.draft.points[0].x-this.draft.points[this.draft.points.length-1].x,this.draft.points[0].y-this.draft.points[this.draft.points.length-1].y)>1) this.project.shapes.push(this.draft); }
  if (this.before && JSON.stringify(this.before)!==JSON.stringify(this.project)) { this.undo.push(this.before); this.undo=this.undo.slice(-60); this.redo=[]; }
  this.release(); this.sync();
 }
 private release(): void { if (this.canvas.hasPointerCapture(this.pointer)) this.canvas.releasePointerCapture(this.pointer); this.dragging=false; this.start=null; this.before=null; this.draft=null; this.pointer=-1; }
 private cancelGesture(): void { if (this.before) this.project=this.before; this.release(); this.sync(); }
 private mutate(fn: () => void): void { if (this.busy) return; const before=clone(this.project); try { fn(); validateProject(this.project); } catch(err) { this.project=before; throw err; } this.undo.push(before); this.undo=this.undo.slice(-60); this.redo=[]; this.sync(); }
 private history(redo: boolean): void { if (this.busy) return; if (this.dragging) this.cancelGesture(); const source=redo?this.redo:this.undo, target=redo?this.undo:this.redo, value=source.pop(); if (value) { target.push(clone(this.project)); this.project=value; this.selected=''; this.sync(); } }
 private removeSelected(): void { if (this.selected) this.mutate(() => { this.project.shapes=this.project.shapes.filter(s => s.id !== this.selected); this.selected=''; }); }
 private fit(): void { if (!this.canvas) return; const host=this.canvas.parentElement!, scale=Math.min(1,Math.max(200,host.clientWidth-16)/this.project.width,Math.max(160,window.innerHeight*0.52)/this.project.height); this.canvas.style.width=`${Math.round(this.project.width*scale)}px`; this.canvas.style.height=`${Math.round(this.project.height*scale)}px`; this.draw(); }
 private sync(): void { if (!this.project) return; for (const [tool,button] of this.toolButtons) { button.toggleClass('is-active',tool === this.tool); button.setAttribute('aria-pressed',String(tool === this.tool)); } const c=this.project.crop; this.status.setText(`裁剪 ${c.width} × ${c.height} · ${this.project.shapes.length} 条标注 · 撤销 ${this.undo.length} 次`); this.draw(); }
 private draw(): void {
  if (!this.canvas) return; const ctx=this.canvas.getContext('2d')!; const scale=this.canvas.width/this.project.width;
  ctx.clearRect(0,0,this.canvas.width,this.canvas.height); ctx.save(); ctx.scale(scale,scale); ctx.drawImage(this.image,0,0,this.project.width,this.project.height);
  for (const shape of this.project.shapes) drawShape(ctx,shape); if (this.draft) drawShape(ctx,this.draft);
  const c=this.project.crop,w=this.project.width,h=this.project.height; ctx.fillStyle='rgba(0,0,0,.48)'; ctx.fillRect(0,0,w,c.y); ctx.fillRect(0,c.y+c.height,w,h-c.y-c.height); ctx.fillRect(0,c.y,c.x,c.height); ctx.fillRect(c.x+c.width,c.y,w-c.x-c.width,c.height);
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=2/scale; ctx.setLineDash([6/scale,4/scale]); ctx.strokeRect(c.x,c.y,c.width,c.height);
  const selected=this.project.shapes.find(s => s.id === this.selected); if (selected) { const r=shapeBounds(selected); ctx.strokeStyle='#0a84ff'; ctx.strokeRect(r.x,r.y,r.width,r.height); }
  ctx.restore();
 }
 onClose(): void { this.closed=true; this.observer?.disconnect(); if (this.image) { this.image.onload=null; this.image.onerror=null; } this.contentEl.empty(); }
 close(): void { if (!this.busy) super.close(); }
}
