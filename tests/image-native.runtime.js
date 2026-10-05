// Native Obsidian Live Preview regression, using an owned background leaf.
// Geometry assertions deliberately cover the native .cm-line path, not mock figures.
(async()=>{
 const tools=app.plugins.plugins['feishu-lite'].imageTools,core=window.__flCore;
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)},wait=ms=>new Promise(r=>setTimeout(r,ms??180));
 const folder='_Feishu Lite 原生图片验收-'+Date.now();await app.vault.createFolder(folder);
 const owned=app.vault.getAbstractFileByPath(folder);let leaf,host,parent,next,oldStyle;
 try{
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  canvas.getContext('2d').fillRect(0,0,960,540);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const image=await app.vault.createBinary(folder+'/截图.png',await blob.arrayBuffer());
  const source='上方正文\n\n![[ '+image.path+'|320]]\n\n中间正文\n\n![重复图片|240](<'+image.path+'>)\n\n普通正文 ![['+image.path+'|90]] 后面的文字\n';
  const file=await app.vault.create(folder+'/原生验收.md',source.replace('![[ ','![['));
  const previous=app.workspace.activeLeaf;leaf=app.workspace.getLeaf('tab');
  await leaf.openFile(file,{active:false,state:{mode:'source',source:false}});await leaf.loadIfDeferred();
  if(app.workspace.activeLeaf===leaf && previous)app.workspace.setActiveLeaf(previous,{focus:false});
  parent=leaf.containerEl.parentNode;next=leaf.containerEl.nextSibling;oldStyle=leaf.containerEl.getAttribute('style');
  host=document.body.createDiv();Object.assign(host.style,{position:'fixed',left:'15px',top:'15px',width:'740px',height:'800px',zIndex:'-1',pointerEvents:'none'});
  host.appendChild(leaf.containerEl);Object.assign(leaf.containerEl.style,{display:'flex',width:'100%',height:'100%',position:'relative'});
  const cm=leaf.view.editor.cm;cm.requestMeasure();
  const images=()=>Array.from(cm.dom.querySelectorAll('.cm-content img')).filter(i=>i.src.startsWith(app.vault.getResourcePath(image).split('?')[0]));
  for(let n=0;n<30 && images().length<3;n++){cm.requestMeasure();await wait(100);}
  check(images().length===3,'actual native renderer loads all three image occurrences');
  const first=()=>images()[0],second=()=>images()[1];
  const geometry=img=>{const a=img.getBoundingClientRect(),b=img.closest('.cm-line').getBoundingClientRect();return {width:a.width,lineWidth:b.width,left:a.left-b.left,centerError:Math.abs((a.left+a.right-b.left-b.right)/2)};};
  check(geometry(first()).lineWidth>500 && geometry(first()).width===320,'native image has narrower width than its actual content line');
  check(!first().closest('.fl-image-figure'),'regression exercises native cm-line without a postprocessed figure');
  const select=async(img=first())=>{for(const type of ['mousedown','mouseup','click'])img.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0}));await wait();return document.querySelector('.fl-image-toolbar');};
  let bar=await select();check(bar?.dataset.flUi==='basic' && !document.querySelector('.lightbox,.fl-lightbox'),'native image event sequence opens basic controls without a second viewer');
  // Make the native fixture hit-testable above the workspace, below our controls.
  host.style.zIndex='950';
  const frame=document.querySelector('.fl-image-resize'),handle=frame.querySelector('.fl-resize-e'),bounds=first().getBoundingClientRect();
  first().closest('.image-wrapper').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:bounds.right+1,clientY:bounds.top+bounds.height/2}));
  check(getComputedStyle(handle).opacity==='1' && getComputedStyle(handle).pointerEvents==='auto','crossing the native image edge keeps handles interactive');
  check(document.elementFromPoint(bounds.right+5,bounds.top+bounds.height/2)?.closest('.fl-resize-e')===handle,'browser hit testing reaches the outer half of the side handle');
  check(!!document.elementFromPoint(bounds.right+5,bounds.bottom+5)?.closest('.fl-resize-se'),'browser hit testing reaches the outer corner handle');
  check(getComputedStyle(first().closest('.image-wrapper').querySelector('.image-resize-corner')).display==='none','native resize corner yields to the selected image controls');
  first().closest('.image-wrapper').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1199,button:0,clientX:bounds.right-2,clientY:bounds.top+bounds.height/2}));await wait();
  check(document.querySelector('.fl-image-toolbar')===bar,'pointer down on the native wrapper keeps image selection');
  for(const [id,delta,expected] of [[1201,-30,290],[1202,30,320]]){
   first().dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:id}));
   const b=first().getBoundingClientRect(),x=b.right+5,y=b.top+b.height/2,target=document.elementFromPoint(x,y);
   target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:id,button:0,clientX:x,clientY:y}));
   check(frame.classList.contains('is-resizing'),'native hit-tested drag '+id+' starts without losing selection');
   document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:id,clientX:x+delta,clientY:y}));
   document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:id,clientX:x+delta,clientY:y}));await wait(220);
   check(Math.abs(first().getBoundingClientRect().width-expected)<2 && document.querySelector('.fl-image-toolbar')===bar,'native drag '+id+' persists size and keeps the same controls');
  }
  await select();check(document.querySelector('.fl-image-toolbar')===bar,'reclicking the same native image keeps existing controls');
  host.style.zIndex='-1';bar.querySelector('.fl-image-center').click();await wait();
  check(geometry(first()).centerError<2,'center button actually moves native image to line center');
  check(Math.abs(geometry(second()).left)<2,'centering one occurrence leaves the repeated image left aligned');
  check(!first().style.outline && getComputedStyle(first()).outlineStyle==='none','native selected image has no persistent purple border');
  const input=bar.querySelector('input');input.value='原生图注';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait();
  check(cm.dom.querySelector('.fl-image-caption-widget')?.textContent==='原生图注' && geometry(first()).centerError<2,'caption remains visible without displacing the centered image');
  await tools.change(tools.activeContext,(s,r)=>core.patchImage(s,r,{width:280}),true);await wait();
  check(Math.abs(geometry(first()).width-280)<2 && geometry(first()).centerError<2,'width changes preserve native center alignment');
  // Selection transactions cause CodeMirror to recreate active-line DOM.
  leaf.view.editor.setCursor({line:2,ch:0});await wait();
  check(geometry(first()).centerError<2,'center survives native active-line rerender');
  tools.closeToolbar(false);
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'},active:false});await wait(350);
  const readingImage=()=>Array.from(leaf.view.containerEl.querySelectorAll('.markdown-preview-view img')).find(i=>i.src.startsWith(app.vault.getResourcePath(image).split('?')[0]));
  for(let n=0;n<30 && !readingImage()?.closest('.fl-image-figure[data-align="center"]');n++)await wait(100);
  let readImage=readingImage();
  check(!!readImage?.closest('.fl-image-figure[data-align="center"]'),'reading view restores the same saved center alignment');
  if(readImage){const a=readImage.getBoundingClientRect(),b=readImage.closest('.fl-image-figure').getBoundingClientRect();check(a.width>0 && Math.abs((a.left+a.right-b.left-b.right)/2)<2,'reading view is geometrically centered');}
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:false});await wait(350);cm.requestMeasure();await wait();
  check(geometry(first()).centerError<2,'returning to Live Preview reloads centered native image');
  await tools.change(tools.contextFor(first()),(s,r)=>core.patchImage(s,r,{align:'right'}));await wait();
  {const a=first().getBoundingClientRect(),b=first().closest('.cm-line').getBoundingClientRect();check(Math.abs(a.right-b.right)<2,'native right alignment reaches the line right edge');}
  await tools.change(tools.contextFor(first()),(s,r)=>core.patchImage(s,r,{align:'center'}));await wait();
  bar=await select();bar.querySelector('.fl-image-center').click();await wait();
  check(Math.abs(geometry(first()).left)<2,'second click actually returns native image to left edge');
  const openMenu=async()=>{const img=first(),b=img.getBoundingClientRect();await tools.openContextMenu(new MouseEvent('contextmenu',{clientX:b.left+10,clientY:b.top+10}),img,tools.contextFor(img));await wait(60);return Array.from(document.querySelectorAll('.menu-item-title')).map(i=>i.textContent);};
  let titles=await openMenu();check(['替换图片','裁剪与标注','图片对齐','图文并排','图片分栏','恢复原始尺寸'].every(t=>titles.includes(t)),'secondary features remain accessible in the standard right-click menu');tools.contextMenu?.hide();
  let text=leaf.view.editor.getValue();await tools.change(tools.contextFor(first()),(s,r)=>core.setImageGrid(s,r,2));await wait(350);
  const gridImg=Array.from(leaf.view.containerEl.querySelectorAll('img')).find(i=>i.src.startsWith(app.vault.getResourcePath(image).split('?')[0]));
  const gridContext=tools.contextFor(gridImg);check(!!core.imageGrid(leaf.view.editor.getValue(),gridContext.ref),'restored grid handler produces a native two-column callout');
  await tools.openContextMenu(new MouseEvent('contextmenu',{clientX:40,clientY:40}),gridImg,gridContext);await wait(60);
  titles=Array.from(document.querySelectorAll('.menu-item-title')).map(i=>i.textContent);check(titles.includes('向前移动')&&titles.includes('向后移动'),'existing grid exposes both reorder actions');tools.contextMenu?.hide();
  await tools.change(gridContext,(s,r)=>core.setImageGrid(s,r,0));await wait(350);
  await tools.change(tools.contextFor(first()),(s,r)=>core.setImageText(s,r,'left','旁边可编辑的 **Markdown** 文字'));await wait(350);
  const alongsideImg=Array.from(leaf.view.containerEl.querySelectorAll('img')).find(i=>i.src.startsWith(app.vault.getResourcePath(image).split('?')[0]));
  check(!!alongsideImg.closest('.callout[data-callout="img-text-left"]')?.querySelector('.fl-image-text-body strong'),'restored image/text action renders Markdown alongside');
  await tools.openContextMenu(new MouseEvent('contextmenu',{clientX:40,clientY:40}),alongsideImg,tools.contextFor(alongsideImg));await wait(60);
  check(Array.from(document.querySelectorAll('.menu-item-title')).some(i=>i.textContent==='编辑旁边文字'),'existing image/text block exposes editing without replacing its data');tools.contextMenu?.hide();
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  tools.contextMenu?.hide();tools.closeToolbar(false);
  if(leaf){
   if(parent && leaf.containerEl.isConnected){parent.insertBefore(leaf.containerEl,next?.parentNode===parent?next:null);if(oldStyle===null)leaf.containerEl.removeAttribute('style');else leaf.containerEl.setAttribute('style',oldStyle);}
   // detach() starts asynchronous MarkdownView teardown. Its closing save may
   // still hold the file after detach returns, so await unloading and I/O first.
   const view=leaf.view;if(view.save)await view.save();
   await leaf.setViewState({type:'empty',active:false});
   for(let n=0;n<100 && view.saving;n++)await wait(50);
   if(view.saving)throw new Error('验收笔记仍在保存，临时文件已保留');
   leaf.detach();
  }
  host?.remove();await app.fileManager.trashFile(owned);
 }
})()
