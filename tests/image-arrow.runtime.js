// Exercise the actual modal, preview renderer and PNG exporter with an owned fixture.
(async()=>{
 const tools=app.plugins.plugins['feishu-lite'].imageTools,core=window.__flCore;
 if(document.querySelector('.modal-container'))throw new Error('请先关闭当前弹窗');
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)},wait=()=>new Promise(r=>setTimeout(r,100));
 const folder='_Feishu Lite 箭头验收-'+Date.now();await app.vault.createFolder(folder);const owned=app.vault.getAbstractFileByPath(folder);let editor,url;
 const ready=async()=>{for(let n=0;n<60&&!editor.canvas;n++)await wait();check(!!editor.canvas,'actual image editor loads its canvas');};
 const red=(canvas,p)=>{const data=canvas.getContext('2d').getImageData(Math.round(p.x),Math.round(p.y),1,1).data;return data[0]>180&&data[1]<120&&data[2]<120;};
 const sample=shape=>{const [a,b]=shape.points,outline=core.arrowOutline(a,b,shape.width);return {shaft:{x:a.x+(b.x-a.x)*.4,y:a.y+(b.y-a.y)*.4},head:{x:(b.x+3*outline[2].x+outline[4].x)/5,y:(b.y+3*outline[2].y+outline[4].y)/5},neck:{x:(outline[1].x+outline[5].x)/2,y:(outline[1].y+outline[5].y)/2}};};
 try{
  const source=document.createElement('canvas');source.width=2400;source.height=1600;const ctx=source.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,2400,1600);
  const blob=await new Promise(r=>source.toBlob(r,'image/png')),image=await app.vault.createBinary(folder+'/原图.png',await blob.arrayBuffer());
  const text='![['+image.path+']]\n',file=await app.vault.create(folder+'/验收.md',text),context={file,text,ref:core.parseImages(text)[0]};
  await tools.edit(context);editor=tools.editor;await ready();
  Array.from(editor.modalEl.querySelectorAll('button')).find(b=>b.textContent==='箭头').click();
  const canvas=editor.canvas,bounds=canvas.getBoundingClientRect();
  // Synthetic pointers have no browser pointer capture; keep the modal's own
  // event listeners and lifecycle, replacing this one native capture operation.
  const originalCapture=canvas.setPointerCapture;canvas.setPointerCapture=()=>{};
  for(const [id,from,to] of [[2001,[.18,.32],[.72,.32]],[2002,[.2,.75],[.72,.5]]]){
   const event=(type,p)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,button:0,clientX:bounds.left+p[0]*bounds.width,clientY:bounds.top+p[1]*bounds.height});
   canvas.dispatchEvent(event('pointerdown',from));canvas.dispatchEvent(event('pointermove',to));canvas.dispatchEvent(event('pointerup',to));
  }
  canvas.setPointerCapture=originalCapture;
  check(editor.project.shapes.length===2,'native arrow tool creates horizontal and diagonal shapes');
  check(editor.project.shapes.every(s=>Math.abs(s.width*bounds.width/2400-5)<.05),'new arrows keep five visible preview pixels on a large source');
  const scale=canvas.width/2400;
  for(const [index,shape] of editor.project.shapes.entries()){
   const samples=Object.values(sample(shape));
   check(samples.every(p=>red(canvas,{x:p.x*scale,y:p.y*scale})),'preview arrow '+index+' has a filled shaft, broad head and connected neck');
  }
  editor.history(false);check(editor.project.shapes.length===1,'arrow drawing remains undoable');editor.history(true);check(editor.project.shapes.length===2,'redo restores the same arrow geometry');
  const before=JSON.stringify(editor.project);core.validateProject(editor.project);
  let saved;editor.saveImage=async(project,data)=>{saved={project,data};};
  Array.from(editor.modalEl.querySelectorAll('button')).find(b=>b.textContent==='保存新图片').click();
  for(let n=0;n<100&&!saved;n++)await wait();check(!!saved,'actual PNG export completes');
  const png=new Image();url=URL.createObjectURL(new Blob([saved.data],{type:'image/png'}));png.src=url;await png.decode();
  const exported=document.createElement('canvas');exported.width=png.naturalWidth;exported.height=png.naturalHeight;exported.getContext('2d').drawImage(png,0,0);
  check(exported.width===2400&&exported.height===1600,'export retains original resolution');
  check(saved.project.shapes.every(s=>Object.values(sample(s)).every(p=>red(exported,p))),'exported PNG retains solid connected arrow heads and shafts');
  URL.revokeObjectURL(url);url=null;
  editor=new editor.constructor(app,image,saved.project,async()=>{});tools.editor=editor;editor.open();await ready();
  check(JSON.stringify(editor.project)===before,'reopening the editable project preserves stored source geometry');
  check(await app.vault.read(file)===text && !app.vault.getFiles().some(f=>f.path.startsWith(folder+'/')&&f.name.includes('-编辑')),'controlled export leaves the source note and original attachment untouched');
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  if(url)URL.revokeObjectURL(url);if(editor){for(let n=0;n<100&&editor.busy;n++)await wait();if(editor.busy)throw new Error('验收导出尚未完成，临时文件保留');editor.close();}
  await app.fileManager.trashFile(owned);
 }
})()
