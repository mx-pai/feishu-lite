// Basic UI regression in real Obsidian DOM; owns and trashes its isolated fixture.
(async()=>{
 const plugin=app.plugins.plugins['feishu-lite'],tools=plugin.imageTools,core=window.__flCore;
 if(!core)throw new Error('Run tests/run-runtime.mjs toolbar');
 if(document.querySelector('.lightbox,.fl-lightbox,.modal-container'))throw new Error('Close the current dialog first');
 const folder='_Feishu Lite UI验收-'+Date.now();await app.vault.createFolder(folder);const owned=app.vault.getAbstractFileByPath(folder);
 let root;
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)},wait=()=>new Promise(r=>setTimeout(r,160));
 try {
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const c=canvas.getContext('2d');c.fillStyle='#e6edf5';c.fillRect(0,0,960,540);c.fillStyle='#485366';c.font='36px sans-serif';c.fillText('图片基础操作验收',60,100);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),image=await app.vault.createBinary(folder+'/图片.png',await blob.arrayBuffer());
  let text='![验收|320]('+image.path+')\n',file=await app.vault.create(folder+'/验收.md',text);
  root=document.createElement('div');root.className='markdown-preview-view';Object.assign(root.style,{position:'fixed',left:'20px',top:'70px',width:'520px',height:'650px',fontSize:'30px',zIndex:'-1'});document.body.appendChild(root);
  const embed=document.createElement('span');embed.className='image-embed';root.appendChild(embed);const img=document.createElement('img');img.src=app.vault.getResourcePath(image);img.width=320;embed.appendChild(img);await img.decode();
  const ctx={sourcePath:file.path,getSectionInfo:()=>({lineStart:0,lineEnd:100,text})};tools.addRoot(root,ctx);await tools.decorateRoot(root,ctx);
  const select=async()=>{text=await app.vault.read(file);await tools.showToolbar(img,{file,text,ref:core.parseImages(text)[0]});return document.querySelector('.fl-image-toolbar')};
  let bar=await select();const input=bar.querySelector('.fl-image-caption-input'),center=bar.querySelector('.fl-image-center');
  check(bar.dataset.flUi==='basic' && bar.querySelectorAll('button').length===2,'basic toolbar has only center and close buttons');
  check(!!input && !bar.textContent.includes('更多') && !bar.textContent.includes('宽度'),'caption is inline with no width popup or multi-level menu');
  check(getComputedStyle(center).fontSize==='12px' && bar.getBoundingClientRect().height<=42,'controls stay compact despite large note typography');
  check(getComputedStyle(img).outlineStyle==='none','selected image has no permanent outline');
  const frame=document.querySelector('.fl-image-resize'),handle=frame.querySelector('.fl-resize-e');
  document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:600}));
  check(getComputedStyle(frame).borderTopWidth==='0px' && getComputedStyle(handle).opacity==='1' && getComputedStyle(handle).pointerEvents==='auto','selected image has no border while handles remain reachable');
  img.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:600}));check(getComputedStyle(handle).opacity==='1','moving between image and handles retains editing controls');
  const b=img.getBoundingClientRect();handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:601,button:0,clientX:b.right,clientY:b.top+30}));
  document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:601,clientX:b.right-40,clientY:b.top+30}));
  check(frame.classList.contains('is-resizing') && Math.abs(img.getBoundingClientRect().width-280)<2,'drag previews width and shows border only during gesture');
  document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:601,clientX:b.right-40,clientY:b.top+30}));await wait();
  check(core.parseImages(await app.vault.read(file))[0].width===280,'release saves width without a dialog');
  check(!!document.querySelector('.fl-image-toolbar') && !frame.classList.contains('is-resizing'),'resize keeps simple controls and clears drag border');
  center.click();await wait();const centered=img.getBoundingClientRect(),line=root.getBoundingClientRect();check(core.parseImages(await app.vault.read(file))[0].align==='center' && center.getAttribute('aria-pressed')==='true' && Math.abs((centered.left+centered.right-line.left-line.right)/2)<2,'one click centers the image geometrically');
  center.click();await wait();check(core.parseImages(await app.vault.read(file))[0].align==='left','second click returns to left alignment');
  input.value='这一步的图注';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait();
  check(core.parseImages(await app.vault.read(file))[0].caption==='这一步的图注' && !document.querySelector('.modal-container'),'Enter saves inline caption without a modal');
  input.value='离开输入框保存';input.dispatchEvent(new FocusEvent('blur'));await wait();check(core.parseImages(await app.vault.read(file))[0].caption==='离开输入框保存','leaving caption saves in place');
  input.value='取消这次修改';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
  check(core.parseImages(await app.vault.read(file))[0].caption==='离开输入框保存' && !document.querySelector('.fl-image-toolbar'),'Escape cancels an unsaved caption and closes controls');
  bar=await select();const modal=document.body.createDiv({cls:'modal-container'});await wait();
  check(!document.querySelector('.fl-image-toolbar,.fl-image-resize'),'opening a modal clears toolbar and resize handles');modal.remove();
  for(const width of [280,180]){root.style.width=width+'px';bar=await select();const a=bar.getBoundingClientRect(),p=root.getBoundingClientRect();check(a.left>=p.left && a.right<=p.right && bar.scrollWidth<=bar.clientWidth,'basic controls fit '+width+'px pane');}
  return JSON.stringify({passed:checks.length,checks});
 }finally{tools.closeToolbar(false);if(root){tools.removeRoot(root);root.remove();}await app.fileManager.trashFile(owned);}
})()
