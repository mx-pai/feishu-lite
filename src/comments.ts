import { Editor, ItemView, MarkdownRenderChild, MarkdownView, Modal, Notice, Platform, TFile, WorkspaceLeaf, editorInfoField, editorLivePreviewField } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import { StateField } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type FeishuLitePlugin from './main';
import { addComment, assertCommentSelection, BLOCK_MARKER, COMMENT_MARKER, commentId, commentParagraphs, deleteComment, exportComments, locateComment, parseComments, planCommentMove, reanchorComment, stripCommentMarkers, updateThread } from './comment-core';
import type { CommentAnchor, CommentDocument, CommentMessage, CommentThread, Paragraph } from './comment-core';
import { action, ChoiceDialog, ConfirmDialog, FileDialog, reportError, TextDialog } from './dialogs';
import { assertSnapshot, commitTransfer, editNote, readNote, recoverTransfers } from './note-edit';
import { sanitizeFileName } from './util';

const VIEW = 'feishu-lite-comments';
type RenderScope = Pick<MarkdownPostProcessorContext,'sourcePath'|'getSectionInfo'>;
interface LoadedComments { text: string; doc: CommentDocument; file: TFile }
export class CommentsController {
 file: TFile | null = null;
 focusedId = '';
 pending: {path:string;id:string} | null = null;
 private panels = new Set<CommentPanel>();
 private roots = new Map<HTMLElement, RenderScope>();
 private timer: number | null = null;
 private mobile: CommentModal | null = null;
 readonly extension;
 constructor(readonly plugin: FeishuLitePlugin) {
  this.file = plugin.app.workspace.getActiveFile();
  this.extension = StateField.define<DecorationSet>({create:s => this.decorations(s),update:(d,tr) => tr.docChanged || tr.selection || tr.effects.length ? this.decorations(tr.state) : d,provide:f => EditorView.decorations.from(f)});
  plugin.registerView(VIEW,leaf => new CommentsView(leaf,this));
  plugin.registerEditorExtension(this.extension);
  plugin.registerEditorExtension(CommentsController.embedViewPlugin(this));
  plugin.registerMarkdownPostProcessor((el,ctx) => { ctx.addChild(new CommentsRenderChild(el,ctx,this)); }, 100);
  plugin.registerEvent(plugin.app.workspace.on('file-open', f => { if (f?.extension === 'md') { this.file = f; this.pending = this.pending?.path === f.path ? this.pending : null; this.schedule(); } }));
  plugin.registerEvent(plugin.app.workspace.on('editor-change', () => this.schedule()));
  plugin.registerEvent(plugin.app.vault.on('modify',f => { if (f.path === this.file?.path) this.schedule(); }));
  plugin.registerEvent(plugin.app.vault.on('delete', f => { if (f.path === this.file?.path) { this.file = null; this.schedule(); } }));
  plugin.registerEvent(plugin.app.vault.on('rename',(f,oldPath) => { if (f instanceof TFile) { if (this.pending?.path === oldPath) this.pending.path=f.path; for (const p of this.panels) p.renameDrafts(oldPath,f.path); this.schedule(); } }));
  plugin.register(() => { if (this.timer !== null) window.clearTimeout(this.timer); this.mobile?.close(); for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW)) leaf.detach(); this.roots.clear(); });
  plugin.addCommand({id:'comment-new',name:'批注：新建或关联选中文字',editorCallback:(e,ctx) => { if (ctx.file) this.createFromEditor(e,ctx.file); }});
  plugin.addCommand({id:'comment-panel',name:'批注：查看当前笔记全部批注',callback:() => { void this.open().catch(reportError); }});
  plugin.addCommand({id:'comment-export',name:'批注：导出当前笔记',callback:() => { void this.export().catch(reportError); }});
  plugin.addCommand({id:'comment-recover',name:'批注：恢复中断迁移',callback:async () => { try { const n = await recoverTransfers(plugin.app); this.schedule(); new Notice(`已恢复 ${n} 次批注迁移`); } catch(err) { reportError(err); } }});
  this.registerReadingSelection();
  plugin.app.workspace.onLayoutReady(() => { void recoverTransfers(plugin.app).catch(reportError); });
 }

 /** 编辑器内嵌笔记（.cm-embed-block）的批注根扫描与徽标点击；控制器以参数传入，供 ViewPlugin 内引用 */
 private static embedViewPlugin(controller: CommentsController) {
  return ViewPlugin.fromClass(class {
   private observer:MutationObserver; private timer:number|null=null; private destroyed=false; private owned=new Set<HTMLElement>();
   private click=(event:MouseEvent) => { if (!this.view.state.selection.main.empty || event.button !== 0) return; const target=(event.target as HTMLElement)?.closest<HTMLElement>('[data-fl-thread]'), file=this.view.state.field(editorInfoField,false)?.file; if (target?.dataset.flThread && file) { event.preventDefault(); void controller.open(file,target.dataset.flThread).catch(reportError); } };
   private bootstrap=() => { if (this.destroyed) return; for (const el of Array.from(this.owned)) if (!el.isConnected) { this.owned.delete(el); controller.removeRoot(el); } const file=this.view.state.field(editorInfoField,false)?.file; if (!file) return; for (const el of Array.from(this.view.dom.querySelectorAll<HTMLElement>('.cm-embed-block .markdown-rendered'))) if (!controller.roots.has(el)) { this.owned.add(el); controller.addRoot(el,{sourcePath:file.path,getSectionInfo:() => null}); } };
   constructor(private view:EditorView) { this.observer=new MutationObserver(() => { if (this.timer !== null) window.clearTimeout(this.timer); this.timer=window.setTimeout(() => { this.timer=null; this.bootstrap(); },100); }); this.observer.observe(view.contentDOM,{childList:true,subtree:true}); view.contentDOM.addEventListener('click',this.click,true); queueMicrotask(this.bootstrap); }
   destroy(): void { this.destroyed=true; this.observer.disconnect(); this.view.contentDOM.removeEventListener('click',this.click,true); if (this.timer !== null) window.clearTimeout(this.timer); for (const el of this.owned) controller.removeRoot(el); }
  });
 }
 message(text: string): CommentMessage { const now = new Date().toISOString(); return {id:commentId(),author:this.plugin.settings.commentAuthor.trim() || '我',text,created:now,updated:now}; }
 createFromEditor(editor: Editor, file: TFile): void {
  try { const text = editor.getValue(), from = editor.posToOffset(editor.getCursor('from')), to = editor.posToOffset(editor.getCursor('to')); this.createSelection(file,text,from,to); } catch(err) { reportError(err); }
 }
 createSelection(file: TFile, snapshot: string, from: number, to: number, excerpt?: string): void {
  if (!this.plugin.settings.commentsEnabled) { new Notice('请在 Feishu Lite 设置中开启批注'); return; }
  assertCommentSelection(parseComments(snapshot).body,from,to);
  if (this.pending?.path === file.path) {
   const id = this.pending.id;
   void this.change(file,current => { assertSnapshot(current,snapshot); return reanchorComment(current,id,from,to); }).then(() => { this.pending = null; return this.open(file,id); }).catch(reportError);
   return;
  }
  new TextDialog(this.plugin.app,'新建批注', '', async value => {
   const id = commentId(); await this.change(file,current => { assertSnapshot(current,snapshot); return addComment(current,from,to,this.message(value),id,excerpt); }); await this.open(file,id);
  }).open();
 }
 async change(file: TFile, edit: (current: string) => string): Promise<void> { await editNote(this.plugin.app,file,edit); this.schedule(); }
 async open(file = this.file, id = ''): Promise<void> {
  if (file) this.file = file; this.focusedId = id;
  if (Platform.isMobile) { if (!this.mobile) this.mobile = new CommentModal(this.plugin.app,this,() => { this.mobile = null; }); this.mobile.open(); this.schedule(); return; }
  let leaf = this.plugin.app.workspace.getLeavesOfType(VIEW)[0];
  if (!leaf) { leaf = this.plugin.app.workspace.getRightLeaf(false)!; await leaf.setViewState({type:VIEW,active:true}); }
  await this.plugin.app.workspace.revealLeaf(leaf); this.schedule();
 }
 mount(panel: CommentPanel): void { this.panels.add(panel); void panel.render(); }
 unmount(panel: CommentPanel): void { this.panels.delete(panel); }
 schedule(): void {
  if (this.timer !== null) window.clearTimeout(this.timer);
  this.timer = window.setTimeout(() => { this.timer = null; for (const p of this.panels) void p.render(); const preload = new Map<string,Promise<LoadedComments|null>>(); for (const [el,ctx] of this.roots) void this.decorateReading(el,ctx,preload).catch(reportError); },120);
 }
 addRoot(el: HTMLElement, ctx: RenderScope): void { this.roots.set(el,ctx); void this.decorateReading(el,ctx).catch(reportError); }
 removeRoot(el: HTMLElement): void { this.roots.delete(el); this.clearRoot(el); }
 private clearRoot(el: HTMLElement): void {
  el.querySelectorAll('.fl-comment-badge').forEach(b => b.remove());
  el.querySelectorAll('mark.fl-comment-read').forEach(m => m.replaceWith(...Array.from(m.childNodes)));
 }
 /** 同一批 schedule 内按 sourcePath 复用「读文件 + 解析批注」（多根 / 多窗格同文件只读一次） */
 private loadComments(path: string, preload?: Map<string,Promise<LoadedComments|null>>): Promise<LoadedComments|null> {
  let job = preload?.get(path); if (job) return job;
  job = (async () => { const file = this.plugin.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return null; const text = await readNote(this.plugin.app,file); try { return {text,doc:parseComments(text),file}; } catch { return null; } })();
  if (!preload) return job;
  preload.set(path,job); return job;
 }
 private async decorateReading(el: HTMLElement, ctx: RenderScope, preload?: Map<string,Promise<LoadedComments|null>>): Promise<void> {
  this.clearRoot(el); el.dataset.flCommentsSource = ctx.sourcePath;
  if (!this.plugin.settings.commentsEnabled) return;
  const loaded = await this.loadComments(ctx.sourcePath,preload); if (!loaded) return;
  const {text,doc,file} = loaded;
  const section = ctx.getSectionInfo(el), editorRoot=el.closest<HTMLElement>('.cm-editor'), live=section || !editorRoot ? null : EditorView.findFromDOM(editorRoot);
  if (!section && !live) return;
  const lines = text.split('\n'); let start: number, end: number;
  if (section) { start=lines.slice(0,section.lineStart).join('\n').length+(section.lineStart?1:0); end=lines.slice(0,section.lineEnd+1).join('\n').length; }
  else { const pos=live!.posAtDOM(el), line=live!.state.doc.lineAt(pos); start=line.from; end=line.to; if (/^\s*>/.test(line.text)) { for (let n=line.number+1;n<=live!.state.doc.lines;n++) { const next=live!.state.doc.line(n); if (!/^\s*>/.test(next.text)) break; end=next.to; } } }
  el.dataset.flSourceFrom = String(start); el.dataset.flSourceTo = String(end);
  const targets = Array.from(el.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6'));
  if (el.matches('p,li,h1,h2,h3,h4,h5,h6')) targets.unshift(el);
  const paragraphs = commentParagraphs(doc.body);
  for (const thread of doc.threads) {
   const a = locateComment(doc.body,thread,paragraphs); if (a.state === 'detached' || a.from < start || a.from > end) continue;
   const quote = thread.anchor.quote.replace(/^\s*(?:#{1,6}\s|>\s|[-+*]\s)/,'');
   const matching = targets.filter(t => t.textContent?.includes(quote)).filter(t => !targets.some(child => child !== t && t.contains(child) && child.textContent?.includes(quote)));
   const target = matching.length === 1 ? matching[0] : el;
   if (a.exact && matching.length === 1 && quote) {
    // 优先按源码偏移映射（重复短语不会标错位置），文本对不上再回退首个匹配
    const offset = CommentsController.quoteOffset(doc.body,paragraphs,a);
    const range = (offset >= 0 ? CommentsController.rangeAtTextOffset(el.ownerDocument,target,offset,quote) : null) ?? CommentsController.rangeAtFirstHit(el.ownerDocument,target,quote);
    if (range) { const mark = el.ownerDocument.win.createEl('mark', { cls: 'fl-comment-read' + (thread.status === 'resolved' ? ' is-resolved' : '') }); mark.dataset.flThread=thread.id; mark.onclick=() => { void this.open(file,thread.id).catch(reportError); }; range.surroundContents(mark); }
   }
   const button = action(target,thread.status === 'resolved' ? '✓' : '批注',() => this.open(file,thread.id),'fl-comment-badge');
   button.title = thread.messages[0].text; button.setAttribute('aria-label',`打开批注：${thread.messages[0].text}`);
  }
 }
 /** 引文相对所在段落起点的源码偏移（剥掉批注标记与 `#`/`>`/`-`/`1.` 前缀）；定位不到段落返回 -1 */
 private static quoteOffset(body: string, paragraphs: Paragraph[], a: CommentAnchor): number {
  const p = paragraphs.find(p => a.from >= p.from && a.to <= p.to); if (!p) return -1;
  return stripCommentMarkers(body.slice(p.from,a.from)).replace(/^\s{0,3}(?:#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s)/,'').length;
 }
 /** 段落起点文本偏移 + 段内相对偏移 → DOM Range（TreeWalker 累计字符数）；该处文本不是引文时返回 null */
 private static rangeAtTextOffset(doc: Document, target: HTMLElement, offset: number, quote: string): Range | null {
  const walker = doc.createTreeWalker(target,NodeFilter.SHOW_TEXT); let node: Node | null, acc = 0;
  while ((node = walker.nextNode())) {
   if (node.parentElement?.closest('code,a,button,mark')) continue;
   const text = node.textContent ?? '';
   if (offset >= acc && offset + quote.length <= acc + text.length && text.startsWith(quote,offset-acc)) { const range = doc.createRange(); range.setStart(node,offset-acc); range.setEnd(node,offset-acc+quote.length); return range; }
   acc += text.length;
  }
  return null;
 }
 /** 回退：target 内首个匹配引文的文本节点 */
 private static rangeAtFirstHit(doc: Document, target: HTMLElement, quote: string): Range | null {
  const walker = doc.createTreeWalker(target,NodeFilter.SHOW_TEXT); let node: Node | null;
  while ((node = walker.nextNode())) {
   if (node.parentElement?.closest('code,a,button,mark')) continue;
   const index = node.textContent?.indexOf(quote) ?? -1;
   if (index >= 0) { const range = doc.createRange(); range.setStart(node,index); range.setEnd(node,index+quote.length); return range; }
  }
  return null;
 }
 private decorations(state: EditorState): DecorationSet {
  if (!this.plugin.settings.commentsEnabled || state.field(editorLivePreviewField,false) !== true) return Decoration.none;
  const text = state.doc.toString(); let d; try { d = parseComments(text); } catch { return Decoration.none; }
  const ranges = [];
  for (const re of [BLOCK_MARKER,COMMENT_MARKER]) for (const m of text.matchAll(new RegExp(re.source,'g'))) ranges.push(Decoration.replace({}).range(m.index,m.index+m[0].length));
  if (d.storeTo > d.storeFrom) ranges.push(Decoration.replace({block:true}).range(d.storeFrom,d.storeTo));
  const file = state.field(editorInfoField,false)?.file;
  if (file) { const paragraphs = commentParagraphs(d.body); for (const t of d.threads) { const a = locateComment(d.body,t,paragraphs); if (a.state === 'detached') continue;
   if (a.exact && a.to > a.from) ranges.push(Decoration.mark({class:'fl-comment-text' + (t.status === 'resolved' ? ' is-resolved' : ''),attributes:{'data-fl-thread':t.id}}).range(a.from,a.to));
   ranges.push(Decoration.widget({widget:new CommentWidget(this,file,t.id,t.status),side:1}).range(a.to));
  } }
  return Decoration.set(ranges,true);
 }
 async jump(file: TFile, thread: CommentThread): Promise<void> {
  const d = parseComments(await readNote(this.plugin.app,file)), a = locateComment(d.body,thread);
  if (a.state === 'detached') throw new Error(a.reason);
  const leaf = this.plugin.app.workspace.getLeavesOfType('markdown').find(l => (l.view as MarkdownView).file?.path === file.path) ?? this.plugin.app.workspace.getLeaf(false);
  await leaf.openFile(file,{state:{mode:'source'}}); await this.plugin.app.workspace.revealLeaf(leaf);
  const v = leaf.view; if (v instanceof MarkdownView) { const from = v.editor.offsetToPos(a.from), to = v.editor.offsetToPos(a.to); v.editor.setSelection(from,to); v.editor.scrollIntoView({from,to},true); v.editor.focus(); }
 }
 async reassociate(file: TFile, thread: CommentThread): Promise<void> {
  this.pending = {path:file.path,id:thread.id}; await this.plugin.app.workspace.getLeaf(false).openFile(file,{state:{mode:'source'}});
  this.mobile?.close(); new Notice('选中新位置，再点划词工具条的「关联批注」或运行批注命令'); this.schedule();
 }
 async move(file: TFile, thread: CommentThread): Promise<void> {
  new FileDialog(this.plugin.app,f => f.extension === 'md' && f.path !== file.path,async target => {
   const sourceBefore = await readNote(this.plugin.app,file), targetBefore = await readNote(this.plugin.app,target), body = parseComments(targetBefore).body;
   const paragraphs = commentParagraphs(body).filter(p => stripCommentMarkers(p.text).trim());
   const choices: {label:string;value:{from:number;to:number}|undefined}[] = [{label:'在文末附加原始摘录，并迁移批注',value:undefined}, ...paragraphs.map(p => ({label:stripCommentMarkers(p.text).slice(0,100),value:{from:p.from,to:p.to}}))];
   new ChoiceDialog(this.plugin.app,choices,async range => {
    const plan = planCommentMove(sourceBefore,targetBefore,thread.id,range);
    await commitTransfer(this.plugin.app,{version:1,id:commentId(),sourcePath:file.path,targetPath:target.path,sourceBefore,targetBefore,sourceAfter:plan.source,targetAfter:plan.target});
    this.schedule(); await this.open(target,thread.id); new Notice('批注已迁移，来源正文保留');
   },'选择目标段落，或在文末附加摘录').open();
  },'将批注移到哪篇笔记').open();
 }
 async export(): Promise<void> {
  const file = this.file; if (!file) throw new Error('请打开一篇笔记');
  const text = exportComments(await readNote(this.plugin.app,file),file.basename), folder = file.parent?.path;
  const path = (folder && folder !== '/' ? folder+'/' : '') + sanitizeFileName(file.basename+'-批注')+'-'+commentId().slice(0,6)+'.md';
  const out = await this.plugin.app.vault.create(path,text); await this.plugin.app.workspace.getLeaf('tab').openFile(out);
 }
 private registerReadingSelection(): void {
  let bar: HTMLElement | null = null, timer:number|null=null;
  const clear = () => { bar?.remove(); bar = null; };
  const update = (doc: Document) => {
   const ext = this.plugin.externalSelectionActions;
   if (!this.plugin.settings.commentsEnabled && !ext.length) return;
   const selection = doc.getSelection(); if (!selection || selection.isCollapsed) { clear(); return; }
   const parent = selection.anchorNode?.parentElement, root = parent?.closest<HTMLElement>('[data-fl-comments-source]');
   if (!root || !root.closest('.markdown-reading-view,.markdown-preview-view,.cm-embed-block')) { clear(); return; }
   const quote = selection.toString().trim(); if (!quote) return;
   const path = root.dataset.flCommentsSource!, file = this.plugin.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
   const win = doc.defaultView ?? window;
   clear(); bar = doc.body.createDiv({cls:'fl-reading-comment-bar'});
   // 公开协调标记：其他划词浮层以此判断「点在 feishu-lite 划词条上」并避让
   bar.setAttribute('data-fl-ui','selbar');
   const range = selection.getRangeAt(0).getBoundingClientRect(); bar.style.left = `${Math.max(8,Math.min(range.left,win.innerWidth-120))}px`; bar.style.top = `${Math.max(8,range.top-44)}px`;
   const sourceFrom = Number(root.dataset.flSourceFrom), sourceTo = Number(root.dataset.flSourceTo);
   if (this.plugin.settings.commentsEnabled) action(bar,this.pending?.path === path ? '关联批注' : '添加批注',async () => {
    const text = await readNote(this.plugin.app,file), body = parseComments(text).body, hits: number[] = [];
    for (let p = body.indexOf(quote,sourceFrom); p >= 0 && p+quote.length <= sourceTo; p = body.indexOf(quote,p+1)) hits.push(p);
    if (hits.length !== 1) throw new Error('所选文字在源码中无法唯一定位，请切换编辑视图选择');
    this.createSelection(file,text,hits[0],hits[0]+quote.length,quote); clear();
   },'fl-rbar-act');
   // 外部划词动作（公开扩展点）：阅读态无编辑器，给 null；动作自行从 DOM 读选区
   // fl-rbar-act：与编辑器划词条同款纯文字观感（不做按钮底，见 styles.css）
   for (const a of ext) {
    const btn = action(bar,a.label,() => a.run(null),'fl-rbar-act');
    if (a.title) btn.title = a.title;
   }
   bar.addEventListener('mousedown',e => e.preventDefault());
   bar.addEventListener('pointerdown',e => e.preventDefault());
  };
  // 划词条可能落在弹出窗口里：按各自 document 注册监听、挂元素（对齐划词工具条的多窗口做法）
  const bind = (doc: Document): void => {
   this.plugin.registerDomEvent(doc,'mouseup',() => update(doc));
   this.plugin.registerDomEvent(doc,'selectionchange',() => { if (timer !== null) window.clearTimeout(timer); timer=window.setTimeout(() => { timer=null; update(doc); },100); });
   this.plugin.registerDomEvent(doc,'keydown',e => { if (e.key === 'Escape' && !e.isComposing) { clear(); this.pending = null; } });
   this.plugin.registerDomEvent(doc,'scroll',clear,true);
  };
  const docs = new Set<Document>([document]);
  this.plugin.app.workspace.iterateAllLeaves(leaf => { const doc = leaf.view?.containerEl?.ownerDocument; if (doc) docs.add(doc); });
  for (const doc of docs) bind(doc);
  this.plugin.registerEvent(this.plugin.app.workspace.on('window-open',(_win,win) => bind(win.document)));
  this.plugin.register(() => { clear(); if (timer !== null) window.clearTimeout(timer); });
 }
}
class CommentWidget extends WidgetType {
 constructor(private controller: CommentsController, private file: TFile, private id: string, private status: string) { super(); }
 eq(other: CommentWidget): boolean { return this.id === other.id && this.status === other.status; }
 toDOM(): HTMLElement { const span = createSpan(); const b = action(span,this.status === 'resolved' ? '✓' : '批注',() => this.controller.open(this.file,this.id),'fl-comment-badge'); b.setAttribute('aria-label','打开批注'); return span; }
}
class CommentsRenderChild extends MarkdownRenderChild {
 constructor(el: HTMLElement, private ctx: MarkdownPostProcessorContext, private controller: CommentsController) { super(el); }
 onload(): void { this.controller.addRoot(this.containerEl,this.ctx); }
 onunload(): void { this.controller.removeRoot(this.containerEl); }
}
class CommentsView extends ItemView {
 private panel: CommentPanel | null = null;
 constructor(leaf: WorkspaceLeaf, private controller: CommentsController) { super(leaf); }
 getViewType(): string { return VIEW; }
 getDisplayText(): string { return '笔记批注'; }
 getIcon(): string { return 'message-square'; }
 async onOpen(): Promise<void> { this.panel = new CommentPanel(this.contentEl,this.controller); this.controller.mount(this.panel); }
 async onClose(): Promise<void> { if (this.panel) this.controller.unmount(this.panel); this.contentEl.empty(); }
}
class CommentModal extends Modal {
 private panel: CommentPanel | null = null;
 constructor(app: FeishuLitePlugin['app'], private controller: CommentsController, private done: () => void) { super(app); }
 onOpen(): void { this.modalEl.addClass('fl-comment-sheet'); this.titleEl.setText('笔记批注'); this.panel = new CommentPanel(this.contentEl,this.controller); this.controller.mount(this.panel); }
 onClose(): void { if (this.panel) this.controller.unmount(this.panel); this.contentEl.empty(); this.done(); }
}
class CommentPanel {
 private filter = 'open'; private search = ''; private drafts = new Map<string,string>(); private revision = 0;
 constructor(private el: HTMLElement, private controller: CommentsController) { el.addClass('fl-comment-panel'); }
 renameDrafts(oldPath:string,newPath:string): void { for (const [key,value] of this.drafts) if (key.startsWith(oldPath+':')) { this.drafts.delete(key); this.drafts.set(newPath+key.slice(oldPath.length),value); } }
 async render(): Promise<void> {
  const revision = ++this.revision, file = this.controller.file; let text = '';
  try { if (file) text = await readNote(this.controller.plugin.app,file); if (revision !== this.revision) return; const d = parseComments(text); this.draw(file,d.body,d.threads); }
  catch(err) { if (revision === this.revision) { this.el.empty(); this.el.createEl('p',{text:err instanceof Error ? err.message : String(err)}); } }
 }
 private draw(file: TFile | null, body: string, threads: CommentThread[]): void {
  if (this.controller.focusedId && threads.some(t => t.id === this.controller.focusedId && (this.filter !== 'all' && t.status !== this.filter))) { this.filter='all'; this.search=''; }
  const scroll = this.el.scrollTop; this.el.empty();
  this.el.createEl('h3',{text:file?.basename ?? '打开一篇笔记'});
  if (!file) return;
  const header = this.el.createDiv({cls:'fl-comment-controls'}), select = header.createEl('select');
  for (const [value,label] of [['open','待处理'],['resolved','已解决'],['all','全部'],['detached','待重新关联']]) select.createEl('option',{value,text:label});
  select.value = this.filter; select.onchange = () => { this.filter = select.value; void this.render(); };
  const input = header.createEl('input',{type:'search',attr:{placeholder:'搜索批注与原文'}}); input.value = this.search;
  input.oninput = () => { this.search = input.value; this.drawThreads(file,body,threads,list); };
  action(header,'导出',() => this.controller.export());
  this.el.createDiv({cls:'fl-comment-summary',text:`${threads.filter(t => t.status === 'open').length} 条待处理 · ${threads.length} 条批注`});
  if (this.controller.pending) this.el.createDiv({cls:'fl-comment-warning',text:'正在重新关联：选中新位置后使用划词工具条'});
  const list = this.el.createDiv({cls:'fl-comment-list'}); this.drawThreads(file,body,threads,list); this.el.scrollTop = scroll;
 }
 private drawThreads(file: TFile, body: string, threads: CommentThread[], list: HTMLElement): void {
  list.empty(); const q = this.search.toLowerCase();
  const visible = threads.filter(t => (this.filter === 'all' || this.filter === 'detached' ? this.filter !== 'detached' || locateComment(body,t).state === 'detached' : t.status === this.filter) && (!q || (t.excerpt+' '+t.messages.map(m => m.text).join(' ')).toLowerCase().includes(q)));
  if (!visible.length) list.createEl('p',{text:'暂无符合条件的批注'});
  for (const t of visible.sort((a,b) => a.created.localeCompare(b.created))) {
   const card = list.createDiv({cls:'fl-comment-card'}); card.dataset.threadId = t.id;
   card.toggleClass('is-focused',t.id === this.controller.focusedId);
   card.createEl('blockquote',{text:t.excerpt}); const a = locateComment(body,t);
   if (a.reason) card.createDiv({cls:'fl-comment-warning',text:a.reason});
   const tools = card.createDiv({cls:'fl-comment-actions'});
   action(tools,'原文',() => this.controller.jump(file,t));
   action(tools,t.status === 'resolved' ? '重新打开' : '解决',() => this.controller.change(file,s => updateThread(s,t.id,x => { x.status = x.status === 'open' ? 'resolved' : 'open'; })));
   action(tools,'重新关联',() => this.controller.reassociate(file,t));
   action(tools,'移动',() => this.controller.move(file,t));
   action(tools,'删除',() => new ConfirmDialog(this.controller.plugin.app,'删除批注','这条批注及其回复将被移除，正文保留',() => this.controller.change(file,s => deleteComment(s,t.id))).open());
   for (const m of t.messages) {
    const message = card.createDiv({cls:'fl-comment-message'}); message.createDiv({cls:'fl-comment-meta',text:`${m.author || '我'} · ${new Date(m.updated).toLocaleString()}`}); message.createDiv({cls:'fl-comment-body',text:m.text});
    const buttons = message.createDiv({cls:'fl-comment-actions'});
    action(buttons,'编辑',() => new TextDialog(this.controller.plugin.app,'编辑批注',m.text,v => this.controller.change(file,s => updateThread(s,t.id,x => { const entry = x.messages.find(y => y.id === m.id); if (!entry) throw new Error('回复已被删除'); entry.text = v; entry.updated = new Date().toISOString(); }))).open());
    if (t.messages.length > 1) action(buttons,'删除回复',() => new ConfirmDialog(this.controller.plugin.app,'删除回复','移除这条回复',() => this.controller.change(file,s => updateThread(s,t.id,x => { x.messages = x.messages.filter(y => y.id !== m.id); }))).open());
   }
   const draftKey = file.path+':'+t.id, reply = card.createEl('textarea',{cls:'fl-comment-reply',attr:{placeholder:'写回复…'}}); reply.value = this.drafts.get(draftKey) ?? ''; reply.oninput = () => this.drafts.set(draftKey,reply.value);
   const send = action(card,'回复',async () => { const value = reply.value.trim(); if (!value) throw new Error('回复不能为空'); await this.controller.change(file,s => updateThread(s,t.id,x => { x.messages.push(this.controller.message(value)); })); this.drafts.delete(draftKey); },'mod-cta');
   reply.onkeydown = e => { if (!e.isComposing && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); } };
  }
  if (this.controller.focusedId) { const card = Array.from(list.querySelectorAll<HTMLElement>('[data-thread-id]')).find(el => el.dataset.threadId === this.controller.focusedId); card?.scrollIntoView({block:'nearest'}); }
 }
}
