// Run with tests/run-runtime.mjs layout after creating its temporary acceptance fixture.
// These are controlled DOM/pointer checks, not an OS or physical-phone test.
const run=window.__flRun, core=window.__flCore, plugin=app.plugins.plugins['feishu-lite'], check=window.__flAssert;
if(!run) throw new Error('Run setup first');
const path=run.folder+'/图文排版验收.md';
let source='![[ '+run.original.path+' ]]\n\n后面的正文保留\n';
source=core.patchImage(source,core.parseImages(source)[0],{width:320,align:'center',caption:'图文并排说明'});
source=core.setImageText(source,core.parseImages(source)[0],'left','**关键调用链**\n\n- 初始化\n- 发起请求\n\n支持正常 Markdown 正文');
let file=app.vault.getAbstractFileByPath(path); if(file) await app.vault.modify(file,source); else file=await app.vault.create(path,source);
const root=document.createElement('div'); root.className='markdown-reading-view markdown-rendered';
Object.assign(root.style,{position:'fixed',left:'12px',top:'20px',width:'840px',zIndex:'-1',pointerEvents:'none'}); document.body.appendChild(root);
let frame;
try {
 let parsed;run.leaf.view.previewMode.renderer.parseSync.call({text:source,parseFinish:(_,p)=>parsed=p}); root.innerHTML=parsed.sections.map(s=>s.html).join('');
 const embed=root.querySelector('.internal-embed');embed.classList.add('image-embed');embed.textContent='';
 const img=document.createElement('img');img.src=app.vault.getResourcePath(run.original);img.width=320;embed.appendChild(img);await img.decode();
 const ctx={sourcePath:file.path,getSectionInfo:()=>({lineStart:0,lineEnd:source.split('\n').length-1,text:source})};
 await plugin.imageTools.decorateRoot(root,ctx);
 check(!!root.querySelector('.fl-image-text-media img') && !!root.querySelector('.fl-image-text-body strong'),'native callout becomes image/text columns');
 check(root.querySelector('.fl-image-text-body').textContent.includes('发起请求'),'rich alongside Markdown retained');
 check(root.querySelector('.fl-image-figure').dataset.align==='center','alignment metadata applies to rendered image');
 check(Math.abs(img.getBoundingClientRect().width-320)<2,'explicit image width overrides grid stretching');
 await plugin.imageTools.showToolbar(img,{file,text:source,ref:core.parseImages(source)[0]});
 check(document.querySelectorAll('.fl-image-resize-handle').length===6,'image selection exposes corner and side resize handles');
 const side=document.querySelector('.fl-resize-e'), bounds=img.getBoundingClientRect();
 side.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:501,button:0,clientX:bounds.right,clientY:bounds.top+30}));
 document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:501,clientX:bounds.right-40,clientY:bounds.top+30}));
 check(Math.abs(img.getBoundingClientRect().width-240)<2,'centered drag previews aspect-ratio width');
 document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:501}));
 check(await app.vault.read(file)===source,'cancelled edge resize leaves note unchanged');
 check(Math.abs(img.getBoundingClientRect().width-320)<2,'cancelled resize restores original preview');
 side.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:502,button:0,clientX:bounds.right,clientY:bounds.top+30}));
 document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:502,clientX:bounds.right-40,clientY:bounds.top+30}));
 await new Promise(r=>setTimeout(r,180));
 source=await app.vault.read(file);let ref=core.parseImages(source)[0];
 check(ref.width===240 && ref.align==='center' && ref.caption==='图文并排说明','edge drag persists native width, alignment and caption');
 await plugin.imageTools.decorateRoot(root,ctx);
 check(Math.abs(img.getBoundingClientRect().width/img.getBoundingClientRect().height-1280/720)<0.02,'resized image retains original aspect ratio');
 await plugin.imageTools.showToolbar(img,{file,text:source,ref});
 await plugin.imageTools.change(plugin.imageTools.activeContext,(s,r)=>core.patchImage(s,r,{align:'right'}),true);await new Promise(r=>setTimeout(r,150));
 source=await app.vault.read(file);ref=core.parseImages(source)[0];check(ref.align==='right','alignment data remains compatible after UI simplification');
 await plugin.imageTools.decorateRoot(root,ctx);
 check(getComputedStyle(root.querySelector('.fl-image-figure')).alignItems==='flex-end','right alignment affects rendered geometry');
 source=core.setImageText(source,ref,'right');await app.vault.modify(file,source);
 check(core.imageTextBlock(source,core.parseImages(source)[0]).content.includes('**关键调用链**'),'switching image/text sides preserves formatted content');
 // Isolated viewport exercises the actual mobile CSS without changing the user's window.
 frame=document.createElement('iframe');Object.assign(frame.style,{position:'fixed',left:'-10000px',top:'0',width:'390px',height:'800px'});document.body.appendChild(frame);
 const doc=frame.contentDocument;const style=doc.createElement('style');style.textContent=await app.vault.adapter.read('.obsidian/plugins/feishu-lite/styles.css');doc.head.appendChild(style);
 const base=doc.createElement('style');base.textContent='body{margin:0;padding:12px;box-sizing:border-box;font:16px sans-serif}img{max-width:100%;height:auto}';doc.head.appendChild(base);
 const content=root.cloneNode(true);content.removeAttribute('style');doc.body.appendChild(content);
 const callout=content.querySelector('.callout');callout.dataset.callout='img-text-right';
 const media=content.querySelector('.fl-image-text-media'), body=content.querySelector('.fl-image-text-body');
 check(body.getBoundingClientRect().top>=media.getBoundingClientRect().bottom,'390px viewport stacks image before text');
 check(content.scrollWidth<=doc.body.clientWidth,'narrow image/text block has no horizontal overflow');
 const grip=doc.createElement('button');grip.className='fl-image-resize-handle';doc.body.appendChild(grip);
 check(getComputedStyle(grip).touchAction==='none' && parseFloat(getComputedStyle(grip).width)>=32,'narrow resize handle has touch target and controlled gestures');
 check(run.errors.length===0,'no plugin errors during controlled image layout checks');
 return JSON.stringify({passed:run.checks.length,layoutChecks:17,errors:run.errors});
} finally {plugin.imageTools.closeToolbar();root.remove();frame?.remove();}
