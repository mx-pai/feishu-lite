// Live Obsidian regression for native viewer + LP toolbar interaction.
// Uses an existing rendered image; no note or attachment is modified.
(async()=>{
 const plugin=app.plugins.plugins['feishu-lite'];
 if(document.querySelector('.lightbox,.fl-lightbox')) throw new Error('Close the current image viewer before running');
 const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.editor?.cm && l.view.containerEl.querySelector('.image-embed img'));
 if(!leaf) throw new Error('Open a note with an image in Live Preview');
 let img=leaf.view.containerEl.querySelector('.image-embed img');const originalSrc=img.src,initial=leaf.view.editor.getValue(),checks=[];
 let native=null;
 const assert=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label)};
 const wait=()=>new Promise(r=>setTimeout(r,150));
 try {
  for(let index=0;index<2;index++) {
   img.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));
   img.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0}));
   img.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));await wait();
   assert(!!document.querySelector('.fl-image-toolbar') && !document.querySelector('.lightbox,.fl-lightbox'),'LP image click opens editing tools without native zoom: '+index);
  }
  assert(document.querySelector('.fl-image-toolbar')?.dataset.flUi==='basic' && document.querySelectorAll('.fl-image-toolbar button').length===2,'actual LP event path uses current basic toolbar');
  img.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));await wait();
  assert(!!document.querySelector('.fl-image-toolbar') && !document.querySelector('.lightbox'),'double click remains in image editing mode');
  const a=img.getBoundingClientRect(), b=document.querySelector('.fl-image-resize').getBoundingClientRect();
  assert(['left','top','width','height'].every(k=>Math.abs(a[k]-b[k])<2),'resize frame matches the selected source image');
  const nativeAction=img.closest('.image-embed').querySelector('.embed-action:not(.edit-block-button)');
  assert(!!nativeAction,'actual Obsidian native zoom action exists');
  nativeAction.click();await wait();native=document.querySelector('.lightbox');
  assert(!!native && !document.querySelector('.fl-image-toolbar,.fl-image-resize'),'native zoom closes editing toolbar and resize frame');
  img.click();await wait();
  assert(!document.querySelector('.fl-image-toolbar,.fl-image-resize'),'background image cannot remount editing tools while viewer is open');
  native.querySelector('.modal-close-button').click();for(let tries=0;tries<30 && document.querySelector('.lightbox');tries++)await new Promise(r=>setTimeout(r,50));native=null;
  img=Array.from(leaf.view.containerEl.querySelectorAll('.image-embed img')).find(i=>i.src===originalSrc) ?? img;
  img.click();await wait();
  assert(!!document.querySelector('.fl-image-toolbar'),'editing tools return after native viewer closes');
  img.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:300,clientY:300}));await wait();
  const view=Array.from(document.querySelectorAll('.menu-item-title')).find(el=>el.textContent==='查看图片');assert(!!view,'right click exposes secondary viewing action');view.closest('.menu-item').click();await wait();
  assert(!!document.querySelector('.fl-lightbox') && !document.querySelector('.fl-image-toolbar,.fl-image-resize'),'plugin View also has exclusive overlay ownership');
  document.querySelector('.fl-lightbox').dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait();
  assert(!document.querySelector('.fl-lightbox'),'plugin viewer closes cleanly');
  assert(leaf.view.editor.getValue()===initial,'overlay regression does not modify source note');
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  native?.querySelector('.modal-close-button')?.click();
  document.querySelector('.fl-lightbox')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  plugin.imageTools.closeToolbar();plugin.imageTools.contextMenu?.hide();
 }
})()
