import { MarkdownRenderChild, Menu, Notice, TFile, editorInfoField, editorLivePreviewField } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type FeishuLitePlugin from './main';
import { action, ChoiceDialog, FileDialog, TextDialog, reportError } from './dialogs';
import { ImageEditorModal } from './image-editor';
import { imageGrid, imageTextBlock, locateImage, parseImages, patchImage, reorderImage, resizedImageWidth, setImageGrid, setImageText, validateProject } from './image-core';
import type { ImageProject, ImageRef } from './image-core';
import { commentId } from './comment-core';
import { editNote, readNote } from './note-edit';
import { openLightbox } from './lightbox';
import { IMAGE_EXTS, sanitizeFileName } from './util';
interface ImageContext {file:TFile;ref:ImageRef;text:string}
type RenderScope = Pick<MarkdownPostProcessorContext,'sourcePath'|'getSectionInfo'>;
export class ImageToolsController {
 private contexts=new WeakMap<HTMLImageElement,ImageContext>();
 private toolbar: HTMLElement | null=null; private active: HTMLImageElement | null=null;
 private toolbarRevision=0;
 private activeContext:ImageContext|null=null; private activePane:HTMLElement|null=null;
 private saveCaption:(()=>Promise<void>)|null=null;
 private contextMenu:Menu|null=null;
 private resizeFrame:HTMLElement|null=null; private resizeObserver:ResizeObserver|null=null; private cancelResize:(() => void)|null=null;
 private editor:ImageEditorModal|null=null;
 private roots=new Map<HTMLElement,RenderScope>(); private timer:number|null=null;
 constructor(readonly plugin: FeishuLitePlugin) {
  document.querySelectorAll(".fl-image-toolbar,.fl-image-resize,.fl-image-menu").forEach(el=>el.remove());
  plugin.registerMarkdownPostProcessor((el,ctx) => { ctx.addChild(new ImageToolsRenderChild(el,ctx,this)); },90);
  plugin.registerEditorExtension(this.editorExtension());
  plugin.registerEditorExtension(StateField.define({create:state => this.metadataDecorations(state),update:(d,tr) => tr.docChanged || tr.selection || tr.effects.length ? this.metadataDecorations(tr.state) : d,provide:f => EditorView.decorations.from(f)}));
  const onImageClick=(e:MouseEvent) => {
   if (!plugin.settings.imageTools) return; const target=e.target as HTMLElement;
   if (!target?.closest || target.closest('.fl-image-toolbar,.fl-image-menu,.fl-image-resize,.fl-image-editor')) return;
   if(target.closest('.lightbox,.fl-lightbox,.embed-action')) { this.closeToolbar(); return; }
   const img=target.closest<HTMLImageElement>('img');
   if (!img || img.closest('a') || !img.closest('.markdown-reading-view,.markdown-preview-view,.cm-editor')) return;
   const editorRoot=img.closest<HTMLElement>('.cm-editor'), view=editorRoot ? EditorView.findFromDOM(editorRoot) : null;
   let context; try { context=view ? this.editorContext(view,img) : this.contexts.get(img); } catch(err) { reportError(err); return; }
   if (!context) return;
   // LP mousedown opens our toolbar; the subsequent native click also opens
   // Obsidian 1.13's viewer unless intercepted before the embed handler.
   e.preventDefault(); e.stopImmediatePropagation(); void this.showToolbar(img,context).catch(reportError);
  };
  plugin.registerDomEvent(document,'click',onImageClick,true);
  plugin.registerDomEvent(document,'dblclick',onImageClick,true);
  plugin.registerDomEvent(document,'contextmenu',e=> { if(!plugin.settings.imageTools)return;const img=(e.target as HTMLElement)?.closest<HTMLImageElement>('img');if(!img || img.closest('a,.lightbox,.fl-lightbox,.modal-container'))return;const context=this.contextFor(img);if(!context)return;e.preventDefault();e.stopImmediatePropagation();void this.openContextMenu(e,img,context).catch(reportError); },true);
  const overlays=new MutationObserver(()=> { if(document.querySelector('.lightbox,.fl-lightbox,.modal-container')) this.closeToolbar(); });
  overlays.observe(document.body,{childList:true}); plugin.register(()=>overlays.disconnect());
  plugin.registerDomEvent(document,'pointerdown',e => {
   if(this.cancelResize)return;
   const t=e.target as HTMLElement,embed=this.active?.closest('.image-embed,.internal-embed,.fl-image-media');
   if(this.toolbar && !t.closest('.fl-image-toolbar,.fl-image-menu,.fl-image-resize,.modal-container') && t!==this.active && !embed?.contains(t))this.closeToolbar();
  },true);
  plugin.registerDomEvent(document,'pointermove',()=>{if(this.active && !this.cancelResize)this.position();},true);
  plugin.registerDomEvent(window,'keydown',e=> {if(e.key==='Escape' && !e.isComposing && (e.target as HTMLElement)?.closest('.fl-image-toolbar')){e.preventDefault();e.stopImmediatePropagation();this.closeToolbar(false);} },true);
  plugin.registerDomEvent(document,'keydown',e=> { if(e.key==='Escape' && !e.isComposing)this.closeToolbar(false); });
  plugin.registerDomEvent(document,'scroll',() => this.position(),true);
  plugin.registerDomEvent(window,'resize',() => this.position());
  plugin.registerEvent(plugin.app.vault.on('rename',(f,oldPath) => { void this.renameProjects(f,oldPath).catch(reportError); }));
  plugin.registerEvent(plugin.app.vault.on('modify',f => { if (f instanceof TFile && f.extension === 'md') this.schedule(); }));
  plugin.registerEvent(plugin.app.workspace.on('file-open',file => {if(file?.path!==this.activeContext?.file.path)this.closeToolbar();}));
  plugin.addCommand({id:'image-tools',name:'图片：打开光标处工具条',editorCallback:(editor,info) => {
   if (!info.file) return; try { const text=editor.getValue(),pos=editor.posToOffset(editor.getCursor()),ref=parseImages(text).find(r => pos >= r.lineFrom && pos <= r.lineTo);
    if (!ref) throw new Error('请把光标放在图片所在行'); const cm=(editor as unknown as {cm:EditorView}).cm;
    const img=Array.from(cm?.dom.querySelectorAll<HTMLImageElement>('img') ?? []).find(i=>this.editorContext(cm,i)?.ref.from===ref.from); this.showToolbar(img ?? null,{file:info.file,ref,text}).catch(reportError);
   } catch(err) { reportError(err); }
  }});
  plugin.register(() => { this.closeToolbar();this.contextMenu?.hide(); this.editor?.close(); if (this.timer !== null) window.clearTimeout(this.timer); this.roots.clear(); });
 }
 closeToolbar(commit=true):void {
  this.toolbarRevision++;const save=this.saveCaption;this.saveCaption=null;
  if(commit && save)void save().catch(reportError);
  const active=this.active;this.active=null;this.activeContext=null;this.activePane=null;
  this.cancelResize?.();this.resizeObserver?.disconnect();this.resizeObserver=null;this.resizeFrame?.remove();this.resizeFrame=null;
  active?.classList.remove('fl-image-selected');this.toolbar?.remove();this.toolbar=null;
 }
 private contextFor(img:HTMLImageElement):ImageContext|null {
  const editor=img.closest<HTMLElement>('.cm-editor'),view=editor?EditorView.findFromDOM(editor):null;
  try { return view?this.editorContext(view,img):this.contexts.get(img) ?? null; }catch(err){reportError(err);return null;}
 }
 private async openContextMenu(event:MouseEvent,img:HTMLImageElement,context:ImageContext):Promise<void> {
  if(img===this.active && this.activeContext)context=this.activeContext;
  await this.saveCaption?.();this.closeToolbar(false);const revision=this.toolbarRevision;
  const text=await readNote(this.plugin.app,context.file);if(revision!==this.toolbarRevision)return;context={file:context.file,text,ref:locateImage(text,context.ref)};
  this.contextMenu?.hide();const file=this.resolve(context.ref,context.file),menu=new Menu().setUseNativeMenu(false);this.contextMenu=menu;menu.onHide(()=>{if(this.contextMenu===menu)this.contextMenu=null;});
  menu.addItem(item=>item.setTitle('查看图片').setIcon('expand').onClick(()=>openLightbox(img.src,context.ref.alt)));
  menu.addItem(item=>item.setTitle('替换图片').setIcon('image').onClick(()=>new FileDialog(this.plugin.app,f=>IMAGE_EXTS.includes(f.extension.toLowerCase()),f=>this.replace(context,f),'选择替换图片').open()));
  menu.addItem(item=>item.setTitle('裁剪与标注').setIcon('crop').setDisabled(!file || !['png','jpg','jpeg','webp','bmp','avif'].includes(file.extension.toLowerCase())).onClick(()=> {void this.edit(context).catch(reportError);}));
  menu.addSeparator();
  menu.addItem(item=>item.setTitle('设置精确宽度').setIcon('ruler').onClick(()=>new TextDialog(this.plugin.app,'图片宽度 px，0 恢复原始尺寸',String(context.ref.width ?? Math.round(img.getBoundingClientRect().width)),value=>{if(!/^\d+$/.test(value))throw new Error('宽度须为 0 到 10000 的整数');return this.change(context,(s,r)=>patchImage(s,r,{width:Number(value)}));},false).open()));
  menu.addItem(item=>item.setTitle('图片对齐').setIcon('align-center').onClick(()=>new ChoiceDialog(this.plugin.app,[{label:'左对齐',value:'left' as const},{label:'居中',value:'center' as const},{label:'右对齐',value:'right' as const}],align=>this.change(context,(s,r)=>patchImage(s,r,{align})),'图片对齐').open()));
  menu.addItem(item=>item.setTitle('图文并排').setIcon('panel-left').onClick(()=>new ChoiceDialog(this.plugin.app,[{label:'图片在左，文字在右',value:'left' as const},{label:'图片在右，文字在左',value:'right' as const},{label:'恢复上下排列',value:'none' as const}],side=>this.change(context,(s,r)=>setImageText(s,r,side)),'图文排列').open()));
  let textBlock:ReturnType<typeof imageTextBlock>=null,grid:ReturnType<typeof imageGrid>=null;
  try{textBlock=imageTextBlock(text,context.ref);grid=imageGrid(text,context.ref);}catch{/* Source layouts with mixed content remain manually editable. */}
  if(textBlock){const block=textBlock;menu.addItem(item=>item.setTitle('编辑旁边文字').setIcon('text').onClick(()=>new TextDialog(this.plugin.app,'图片旁边的文字',block.content,body=>this.change(context,(s,r)=>{const current=imageTextBlock(s,r);if(!current)throw new Error('图文排列已变化，请重新点击图片');return setImageText(s,r,current.side,body);}),true,true,false).open()));}
  menu.addItem(item=>item.setTitle('图片分栏').setIcon('columns-2').onClick(()=>new ChoiceDialog(this.plugin.app,[{label:'两列',value:2},{label:'三列',value:3},{label:'四列',value:4},{label:'取消分栏',value:0}],cols=>this.change(context,(s,r)=>setImageGrid(s,r,cols)),'图片分栏').open()));
  if(grid){menu.addItem(item=>item.setTitle('向前移动').setIcon('arrow-left').setDisabled(grid!.index<=0).onClick(()=>{void this.change(context,(s,r)=>reorderImage(s,r,-1)).catch(reportError);}));menu.addItem(item=>item.setTitle('向后移动').setIcon('arrow-right').setDisabled(grid!.index>=grid!.rows.length-1).onClick(()=>{void this.change(context,(s,r)=>reorderImage(s,r,1)).catch(reportError);}));}
  menu.addSeparator();
  menu.addItem(item=>item.setTitle('恢复原始尺寸').setIcon('rotate-ccw').onClick(()=> {void this.change(context,(s,r)=>patchImage(s,r,{width:0})).catch(reportError);}));
  if(file && this.plugin.app.vault.getAbstractFileByPath(file.path+'.fl-edit.json') instanceof TFile)menu.addItem(item=>item.setTitle('恢复原图').setIcon('undo').onClick(()=> {void this.restore(context).catch(reportError);}));
  menu.showAtMouseEvent(event);
 }
 private reconnect():void {
  if(!this.activeContext || !this.activePane)return;
  const selected=this.activeContext;
  for(const img of Array.from(this.activePane.querySelectorAll<HTMLImageElement>('img'))) {
   if(!this.matches(img,selected.ref,selected.file))continue;const context=this.contextFor(img);
   if(!context || context.file.path!==selected.file.path || (selected.ref.id?context.ref.id!==selected.ref.id:context.ref.from!==selected.ref.from))continue;
   this.active?.classList.remove('fl-image-selected');this.active=img;img.classList.add('fl-image-selected');this.resizeObserver?.disconnect();this.resizeObserver?.observe(img);return;
  }
 }
 private editorExtension() {
  const controller=this;
  return ViewPlugin.fromClass(class {
   private down:(e:MouseEvent) => void;
   private observer:MutationObserver;
   private timer:number|null=null;
   private destroyed=false;
   private owned=new Set<HTMLElement>();
   private bootstrap = () => {
    if (this.destroyed) return;
    const file=this.view.state.field(editorInfoField,false)?.file; if (!file) return;
    for (const el of Array.from(this.view.dom.querySelectorAll<HTMLElement>('.cm-embed-block .markdown-rendered'))) {
     if (!el.querySelector('img')) continue;
     this.owned.add(el); controller.addRoot(el,{sourcePath:file.path,getSectionInfo:() => null});
    }
    for (const el of controller.roots.keys()) if (!el.isConnected) controller.removeRoot(el);
    if(controller.activePane?.contains(this.view.dom))controller.position();
   };
   constructor(private view:EditorView) {
    this.down=e => { if (e.button !== 0 || e.defaultPrevented || !controller.plugin.settings.imageTools) return;
     const img=(e.target as HTMLElement)?.closest<HTMLImageElement>('img'); if (!img || img.closest('a,.fl-lightbox,.fl-image-editor')) return;
     const context=controller.editorContext(view,img); if (!context) return;
     e.preventDefault(); e.stopPropagation(); void controller.showToolbar(img,context).catch(reportError);
    };
    view.contentDOM.addEventListener('mousedown',this.down,true);
    this.observer=new MutationObserver(() => { if (this.timer !== null) window.clearTimeout(this.timer); this.timer=window.setTimeout(() => { this.timer=null; this.bootstrap(); },100); });
    this.observer.observe(view.contentDOM,{childList:true,subtree:true});
    queueMicrotask(this.bootstrap);
   }
   destroy(): void { const selected=controller.active?.closest('.cm-editor')===this.view.dom || controller.activePane?.contains(this.view.dom);this.destroyed=true; this.view.contentDOM.removeEventListener('mousedown',this.down,true); this.observer.disconnect(); if (this.timer !== null) window.clearTimeout(this.timer); for (const el of this.owned) controller.removeRoot(el); if(selected)controller.closeToolbar(); }
  });
 }
 private editorContext(view:EditorView,img:HTMLImageElement): ImageContext | null {
  const file=view.state.field(editorInfoField,false)?.file; if (!file) return null;
  const text=view.state.doc.toString(), known=this.contexts.get(img);
  if (known?.file.path === file.path) { try { const current=locateImage(text,known.ref); return this.matches(img,current,file) ? {file,text,ref:current} : null; } catch { /* Recompute after surrounding source changes. */ } }
  const refs=parseImages(text); let pos:number;
  try { pos=view.posAtDOM(img); } catch { const p=view.posAtCoords({x:img.getBoundingClientRect().left+2,y:img.getBoundingClientRect().top+2}); if (p === null) return null; pos=p; }
  const container=img.closest('.cm-embed-block,.cm-line') ?? img.parentElement!;
  const candidates=refs.filter(r => this.matches(img,r,file));
  const nearby=candidates.filter(r => pos >= r.lineFrom && pos <= r.lineTo);
  if (nearby.length === 1) return {file,text,ref:nearby[0]};
  const calloutStart=text.lastIndexOf('> [!img-',pos), calloutEnd=calloutStart >= 0 ? (() => { const lines=text.slice(calloutStart).split('\n'); let length=lines[0].length+1; for (const line of lines.slice(1)) { if (!/^\s*>/.test(line)) break; length+=line.length+1; } return calloutStart+length; })() : -1;
  const inside=calloutStart >= 0 && pos <= calloutEnd ? candidates.filter(r => r.from >= calloutStart && r.from < calloutEnd) : candidates;
  const same=Array.from(container.querySelectorAll<HTMLImageElement>('img')).filter(i => this.matches(i,inside[0] ?? candidates[0],file));
  const n=same.indexOf(img); if (n >= 0 && same.length === inside.length && inside[n]) return {file,text,ref:inside[n]};
  return candidates.length === 1 ? {file,text,ref:candidates[0]} : null;
 }
 resolve(ref:ImageRef,file:TFile): TFile | null {
  if (/^https?:\/\//i.test(ref.target)) return null; let path=ref.target.split('#')[0]; try { path=decodeURIComponent(path); } catch { /* literal path */ }
  return this.plugin.app.metadataCache.getFirstLinkpathDest(path,file.path);
 }
 private matches(img:HTMLImageElement,ref:ImageRef | undefined,file:TFile): boolean {
  if (!ref) return false; const dest=this.resolve(ref,file);
  return dest ? img.src.split('?')[0] === this.plugin.app.vault.getResourcePath(dest).split('?')[0] : /^https?:\/\//i.test(ref.target) && img.src === ref.target;
 }
 async decorateRoot(el:HTMLElement,ctx:RenderScope): Promise<void> {
  const file=this.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath); if (!(file instanceof TFile)) return;
  const text=await readNote(this.plugin.app,file), section=ctx.getSectionInfo(el);
  let refs; try { refs=parseImages(text); } catch { return; }
  if(this.activeContext?.file.path===file.path && !refs.some(r=>this.activeContext!.ref.id?r.id===this.activeContext!.ref.id:r.from===this.activeContext!.ref.from))this.closeToolbar();
  const editorRoot=el.closest<HTMLElement>('.cm-editor');
  const liveView=section || !editorRoot ? null : EditorView.findFromDOM(editorRoot);
  if (!section && !liveView) return;
  if (section) {
   const lines=text.split('\n'), from=lines.slice(0,section.lineStart).join('\n').length+(section.lineStart?1:0), to=lines.slice(0,section.lineEnd+1).join('\n').length;
   refs=refs.filter(r => r.from >= from && r.from <= to);
  }
  const imgs=Array.from(el.querySelectorAll<HTMLImageElement>('img')).filter(i => !i.closest('.fl-comment-badge,.fl-lightbox'));
  for (const img of imgs) {
   const candidates=refs.filter(r => this.matches(img,r,file)), peers=imgs.filter(i => this.matches(i,candidates[0],file)), index=peers.indexOf(img);
   if (!liveView && (index < 0 || peers.length !== candidates.length)) continue;
   const ref=liveView ? this.editorContext(liveView,img)?.ref : candidates[index];
   if (!ref) continue;
   this.contexts.set(img,{file,ref,text});
   let embed=img.closest<HTMLElement>('.image-embed,.internal-embed,.fl-image-media');
   if(!embed) { embed=el.ownerDocument.createElement('span'); embed.className='fl-image-media'; img.replaceWith(embed); embed.appendChild(img); }
   let figure=embed.parentElement?.matches('.fl-image-figure') ? embed.parentElement : null;
   if (!figure) { figure=el.ownerDocument.createElement('span'); figure.className='fl-image-figure'; embed.replaceWith(figure); figure.appendChild(embed); }
   if (ref.align) figure.dataset.align=ref.align; else delete figure.dataset.align;
   // Native grids stretch embeds; explicit widths remain occurrence-owned in every layout.
   embed.style.width=ref.width ? `${ref.width}px` : ''; embed.style.maxWidth='100%';
   if (ref.width) { img.style.width='100%'; img.style.height='auto'; } else { img.style.width=''; img.style.height=''; }
   let caption=figure.querySelector<HTMLElement>('.fl-image-caption'); if (ref.caption) { if (!caption) caption=figure.createSpan({cls:'fl-image-caption'}); if (caption.textContent !== ref.caption) caption.setText(ref.caption); caption.style.maxWidth=ref.width?`${ref.width}px`:''; } else caption?.remove();
  }
  this.decorateImageText(el);
  if(this.active && !this.active.isConnected){this.reconnect();this.position();}
 }
 private decorateImageText(root:HTMLElement): void {
  const selector='.callout[data-callout="img-text-left"],.callout[data-callout="img-text-right"]';
  const callouts=Array.from(root.querySelectorAll<HTMLElement>(selector)); if(root.matches(selector)) callouts.unshift(root);
  for(const callout of callouts) {
   const content=Array.from(callout.children).find(e=>e.classList.contains('callout-content')) as HTMLElement|undefined;
   if(!content || content.querySelector(':scope > .fl-image-text-media')) continue;
   const first=content.firstElementChild; if(!first || !first.querySelector('img') && !first.matches('img,.fl-image-figure,.image-embed')) continue;
   const media=content.ownerDocument.createElement('div'), body=content.ownerDocument.createElement('div');
   media.className='fl-image-text-media'; body.className='fl-image-text-body';
   media.appendChild(first); body.append(...Array.from(content.childNodes)); content.append(media,body);
  }
 }
 addRoot(el:HTMLElement,ctx:RenderScope): void { this.roots.set(el,ctx); void this.decorateRoot(el,ctx).catch(reportError); }
 removeRoot(el:HTMLElement): void { this.roots.delete(el); }
 private schedule(): void { if (this.timer !== null) window.clearTimeout(this.timer); this.timer=window.setTimeout(() => { this.timer=null; for (const [el,ctx] of this.roots) void this.decorateRoot(el,ctx).catch(reportError); },150); }
 private metadataDecorations(state:EditorView['state']) {
  if (state.field(editorLivePreviewField,false) !== true) return Decoration.none;
  let refs; try { refs=parseImages(state.doc.toString()); } catch { return Decoration.none; }
  const ranges=[];
  for (const r of refs) {
   // Native LP images belong to CodeMirror's .cm-line, outside Markdown
   // postprocessor roots. Decorate the source line without moving CM nodes.
   if(r.align && !state.doc.sliceString(r.lineFrom,r.from).trim() && !state.doc.sliceString(r.end,r.lineTo).trim())ranges.push(Decoration.line({attributes:{class:'fl-image-source-line','data-fl-align':r.align}}).range(r.lineFrom));
   if (r.end > r.to) ranges.push(Decoration.replace({}).range(r.to,r.end)); if (r.caption) ranges.push(Decoration.widget({widget:new CaptionWidget(r.caption),side:1}).range(r.end));
  }
  return Decoration.set(ranges,true);
 }
 private position(): void {
  if(this.active && !this.active.isConnected) { this.reconnect();if(!this.active?.isConnected){if(this.resizeFrame)this.resizeFrame.hidden=true;return;} }
  if(this.resizeFrame && this.active) { const r=this.active.getBoundingClientRect(); Object.assign(this.resizeFrame.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'}); this.resizeFrame.hidden=!this.active.isConnected || !r.width || !r.height; }
  if (!this.toolbar) return;
  const pane=this.active?.closest<HTMLElement>('.workspace-leaf-content,.markdown-preview-view,.cm-editor')?.getBoundingClientRect();
  const left=Math.max(8,(pane?.left ?? 0)+8),right=Math.max(left,Math.min(window.innerWidth-8,(pane?.right ?? window.innerWidth)-8));
  const available=Math.max(1,right-left);this.toolbar.style.maxWidth=`${Math.min(330,available)}px`;this.toolbar.dataset.boundLeft=String(left);this.toolbar.dataset.boundRight=String(right);
  this.toolbar.classList.toggle('is-tiny',available<220);
  const r=this.active?.getBoundingClientRect(), w=this.toolbar.offsetWidth, h=this.toolbar.offsetHeight;
  const top=Math.max(8,pane?.top ?? 8),bottom=Math.min(window.innerHeight-8,pane?.bottom ?? window.innerHeight-8);
  this.toolbar.style.left=`${Math.max(left,Math.min(r?.left ?? left,right-w))}px`;
  this.toolbar.style.top=`${Math.max(top,Math.min((r?.bottom ?? top)+6+h<=bottom?(r?.bottom ?? top)+6:(r?.top ?? bottom)-h-6,bottom-h))}px`; this.toolbar.style.right='auto'; this.toolbar.style.bottom='auto';
 }
 async showToolbar(img:HTMLImageElement | null,context:ImageContext): Promise<void> {
  if(img && img===this.active && this.toolbar && this.activeContext?.file.path===context.file.path){this.position();return;}
  this.closeToolbar(); if(document.querySelector('.lightbox,.fl-lightbox')) return;
  const revision=this.toolbarRevision, text=await readNote(this.plugin.app,context.file); if (revision !== this.toolbarRevision || document.querySelector('.lightbox,.fl-lightbox')) return; const ref=locateImage(text,context.ref); const current={file:context.file,ref,text};
  this.active=img;this.activeContext=current;this.activePane=img?.closest<HTMLElement>('.workspace-leaf-content,.markdown-preview-view,.cm-editor') ?? null;img?.classList.add('fl-image-selected');
  const bar=document.body.createDiv({cls:'fl-image-toolbar fl-image-basic',attr:{role:'toolbar','aria-label':'图片：缩放、居中和图注','data-fl-ui':'basic'}});this.toolbar=bar;
  bar.addEventListener('mousedown',e=> { if((e.target as HTMLElement).closest('button'))e.preventDefault(); });
  bar.createSpan({cls:'fl-image-size',text:`${ref.width ?? Math.round(img?.getBoundingClientRect().width ?? 0)} px`});
  const center=action(bar,'居中',()=>this.change(current,(s,r)=>patchImage(s,r,{align:r.align==='center'?'left':'center'}),true),'fl-image-center');center.setAttribute('aria-pressed',String(ref.align==='center'));center.title='切换居中 / 左对齐';
  const caption=bar.createEl('input',{type:'text',cls:'fl-image-caption-input',attr:{placeholder:'添加图注','aria-label':'图注，回车或离开输入框保存'}});caption.value=ref.caption;let baseline=caption.value,busy=false;
  const save=async()=> { const value=caption.value;if(busy || value===baseline)return;busy=true;try{await this.change(current,(s,r)=>patchImage(s,r,{caption:value}),true);baseline=value;}finally{busy=false;} };
  this.saveCaption=save;
  caption.addEventListener('blur',()=> {void save().catch(reportError);});
  caption.addEventListener('keydown',e=> { if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();void save().catch(reportError);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();caption.value=baseline;this.closeToolbar(false);} });
  action(bar,'×',()=>this.closeToolbar(),'fl-toolbar-close').setAttribute('aria-label','关闭图片工具条');if(img)this.addResizeHandles(img);this.position();
 }
 private addResizeHandles(img:HTMLImageElement):void {
  const frame=img.ownerDocument.createElement('div'); frame.className='fl-image-resize'; img.ownerDocument.body.appendChild(frame); this.resizeFrame=frame;
  for(const [name,x,y] of [['nw',-1,-1],['ne',1,-1],['sw',-1,1],['se',1,1],['w',-1,0],['e',1,0]] as const) {
   const handle=frame.createEl('button',{cls:'fl-image-resize-handle fl-resize-'+name,attr:{'aria-label':'拖动缩放图片，方向键微调','type':'button'}});
   handle.addEventListener('pointerdown',e=>{if(this.active && this.activeContext)this.beginResize(e,handle,this.active,this.activeContext,x,y);});
   handle.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();});
   handle.addEventListener('keydown',e=> { if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) || this.cancelResize || !this.active || !this.activeContext) return; e.preventDefault(); const current=this.activeContext,direction=['ArrowRight','ArrowUp'].includes(e.key)?1:-1; const width=Math.max(24,Math.min(10000,(current.ref.width ?? Math.round(this.active.getBoundingClientRect().width))+direction*(e.shiftKey?1:10))); void this.change(current,(s,r)=>patchImage(s,r,{width}),true).catch(reportError); });
  }
  this.resizeObserver=new ResizeObserver(()=>this.position()); this.resizeObserver.observe(img);
 }
 private beginResize(e:PointerEvent,handle:HTMLElement,img:HTMLImageElement,context:ImageContext,hx:number,hy:number):void {
  if(e.button!==0 || this.cancelResize) return; e.preventDefault(); e.stopPropagation();
  const bounds=img.getBoundingClientRect(); if(!bounds.width || !bounds.height) return;
  const embed=img.closest<HTMLElement>('.image-embed,.internal-embed,.fl-image-media') ?? img, figure=embed.closest<HTMLElement>('.fl-image-figure');
  const inGrid=figure?.parentElement?.matches('.callout-content') && figure.closest('.callout[data-callout="img-2"],.callout[data-callout="img-3"],.callout[data-callout="img-4"]');
  const limit=Math.max(1,Math.min(10000,(inGrid?figure?.clientWidth:figure?.parentElement?.clientWidth) || embed.parentElement?.clientWidth || bounds.width));
  const oldEmbed=embed.style.width, oldWidth=img.style.width, oldHeight=img.style.height;
  this.resizeFrame?.classList.add('is-resizing');
  let width=Math.round(bounds.width), moved=false; const owner=img.ownerDocument;
  const clean=()=> { owner.removeEventListener('pointermove',move,true); owner.removeEventListener('pointerup',up,true); owner.removeEventListener('pointercancel',cancel,true); try { if(handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); } catch { /* Detached handle. */ } embed.style.width=oldEmbed; img.style.width=oldWidth; img.style.height=oldHeight;this.resizeFrame?.classList.remove('is-resizing');this.toolbar?.querySelector('.fl-image-size')?.setText(`${context.ref.width ?? Math.round(bounds.width)} px`);this.cancelResize=null; this.position(); };
  const cancel=(event?:PointerEvent)=> { if(event && event.pointerId!==e.pointerId) return; clean(); };
  const move=(event:PointerEvent)=> { if(event.pointerId!==e.pointerId) return; if(!img.isConnected){clean();return;} event.preventDefault(); const dx=event.clientX-e.clientX,dy=event.clientY-e.clientY; moved ||= Math.hypot(dx,dy)>2;
   width=resizedImageWidth(bounds.width,bounds.height,dx,dy,hx,hy,limit,context.ref.align==='center'); embed.style.width=width+'px'; img.style.width='100%'; img.style.height='auto';this.toolbar?.querySelector('.fl-image-size')?.setText(width+' px');this.position(); };
  const up=(event:PointerEvent)=> { if(event.pointerId!==e.pointerId) return; move(event); clean(); if(moved) void this.change(context,(s,r)=>patchImage(s,r,{width}),true).catch(reportError); };
  this.cancelResize=cancel; owner.addEventListener('pointermove',move,true); owner.addEventListener('pointerup',up,true); owner.addEventListener('pointercancel',cancel,true); try { handle.setPointerCapture(e.pointerId); } catch { /* Document listeners also cover uncaptured pointers. */ }
 }
 private async change(context:ImageContext,edit:(text:string,ref:ImageRef)=>string,keep=false):Promise<void> {
  let nextRef:ImageRef|undefined,nextText='';
  await editNote(this.plugin.app,context.file,s=> {const current=locateImage(s,context.ref);if(current.target!==context.ref.target)throw new Error('这次图片引用已被替换，请重新点击');nextText=edit(s,current);nextRef=parseImages(nextText).find(r=>r.from===current.from);return nextText;});
  if(keep && nextRef){context.ref=nextRef;context.text=nextText;
   if(this.active && this.activeContext===context){this.contexts.set(this.active,context);const embed=this.active.closest<HTMLElement>('.image-embed,.internal-embed,.fl-image-media') ?? this.active;embed.style.width=nextRef.width?nextRef.width+'px':'';if(nextRef.width){this.active.style.width='100%';this.active.style.height='auto';}const figure=embed.closest<HTMLElement>('.fl-image-figure');if(figure && nextRef.align)figure.dataset.align=nextRef.align;
    this.toolbar?.querySelector('.fl-image-center')?.setAttribute('aria-pressed',String(nextRef.align==='center'));this.toolbar?.querySelector('.fl-image-size')?.setText(`${nextRef.width ?? Math.round(this.active.getBoundingClientRect().width)} px`);this.position();
   }
  }else this.closeToolbar();this.schedule();
 }
 private replacement(ref:ImageRef,file:TFile,note:TFile): {target:string;style:'wiki'|'markdown'} {
  const link='!'+this.plugin.app.fileManager.generateMarkdownLink(file,note.path), parsed=parseImages(link)[0]; if (!parsed) throw new Error('新图片链接无法解析'); return {target:parsed.target,style:parsed.style};
 }
 private replace(context:ImageContext,file:TFile): Promise<void> { return this.change(context,(s,r) => patchImage(s,r,this.replacement(r,file,context.file))); }
 private async projectFor(file:TFile): Promise<ImageProject | null> {
  const sidecar=this.plugin.app.vault.getAbstractFileByPath(file.path+'.fl-edit.json'); if (!(sidecar instanceof TFile)) return null;
  return validateProject(JSON.parse(await this.plugin.app.vault.read(sidecar)));
 }
 private async edit(context:ImageContext): Promise<void> {
  const selected=this.resolve(context.ref,context.file); if (!selected) throw new Error('请先将图片导入当前笔记库');
  const project=await this.projectFor(selected), source=project ? this.plugin.app.vault.getAbstractFileByPath(project.original) : selected;
  if (!(source instanceof TFile)) throw new Error('原图已不存在，编辑项目已保留'); this.closeToolbar();
  this.editor?.close();
  this.editor=new ImageEditorModal(this.plugin.app,source,project,async (p,data) => {
   const latest=await readNote(this.plugin.app,context.file), ref=locateImage(latest,context.ref); if (ref.target !== context.ref.target) throw new Error('图片引用已替换，请重新开始编辑');
   p.original=source.path; validateProject(p);
   const filename=sanitizeFileName(source.basename+'-编辑')+'-'+commentId().slice(0,8)+'.png';
   const path=await this.plugin.app.fileManager.getAvailablePathForAttachment(filename,context.file.path);
   const output=await this.plugin.app.vault.createBinary(path,data);
   try { await this.plugin.app.vault.create(path+'.fl-edit.json',JSON.stringify(p,null,2)); await this.replace(context,output); new Notice('已保存新图片，原图和可编辑标注保留'); }
   catch(err) { new Notice(`图片已保存到 ${path}，笔记引用未完成更新，请重新选择图片`); throw err; }
  }); this.editor.open();
 }
 private async restore(context:ImageContext): Promise<void> {
  const file=this.resolve(context.ref,context.file); if (!file) throw new Error('图片文件无法解析'); const project=await this.projectFor(file); if (!project) throw new Error('此图片没有编辑项目');
  const original=this.plugin.app.vault.getAbstractFileByPath(project.original); if (!(original instanceof TFile)) throw new Error('原图已不存在'); await this.replace(context,original);
 }
 private async renameProjects(file:TFile | import('obsidian').TAbstractFile,oldPath:string): Promise<void> {
  const {vault,fileManager}=this.plugin.app;
  if (file instanceof TFile && IMAGE_EXTS.includes(file.extension.toLowerCase())) {
   const sidecar=vault.getAbstractFileByPath(oldPath+'.fl-edit.json'), destination=file.path+'.fl-edit.json';
   if (sidecar instanceof TFile) { if (vault.getAbstractFileByPath(destination)) throw new Error('编辑项目目标路径已存在，请手动整理'); await fileManager.renameFile(sidecar,destination); }
  }
  for (const f of vault.getFiles().filter(f => f.path.endsWith('.fl-edit.json'))) {
   let p; try { p=validateProject(JSON.parse(await vault.read(f))); } catch { continue; }
   if (p.original === oldPath || p.original.startsWith(oldPath+'/')) await vault.process(f,text => { const current=validateProject(JSON.parse(text)); if (current.original !== oldPath && !current.original.startsWith(oldPath+'/')) return text; current.original=file.path+current.original.slice(oldPath.length); return JSON.stringify(current,null,2); });
  }
 }
}
class CaptionWidget extends WidgetType {
 constructor(private text:string) { super(); }
 eq(other:CaptionWidget): boolean { return this.text === other.text; }
 toDOM(): HTMLElement { return createSpan({cls:'fl-image-caption-widget',text:this.text}); }
}
class ImageToolsRenderChild extends MarkdownRenderChild {
 private observer:MutationObserver | null=null; private timer:number|null=null;
 constructor(el:HTMLElement,private ctx:MarkdownPostProcessorContext,private controller:ImageToolsController) { super(el); }
 onload(): void { this.controller.addRoot(this.containerEl,this.ctx); this.observer=new MutationObserver(() => { if (this.timer !== null) window.clearTimeout(this.timer); this.timer=window.setTimeout(() => { this.timer=null; void this.controller.decorateRoot(this.containerEl,this.ctx).catch(reportError); },80); }); this.observer.observe(this.containerEl,{childList:true,subtree:true}); }
 onunload(): void { this.observer?.disconnect(); if (this.timer !== null) window.clearTimeout(this.timer); this.controller.removeRoot(this.containerEl); }
}
