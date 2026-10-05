// 批注渲染回归：阅读视图原生渲染链产出的 mark（配色类 + 线程标记），
// 以及切回 Live Preview 后的行内标记；对应历史上「阅读视图 mark 未生成 / 样式丢失」回归。
// 注：装饰链为「clearRoot → readNote(异步) → 重建标记」，app 繁忙时可能数秒才稳定，
// 故等 500ms 后按 150ms 步进轮询（最长 ~8s）；套件自行保证 commentsEnabled 开启并还原。
(async()=>{
 const core=window.__flCore,plugin=app.plugins.plugins['feishu-lite'];
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)},wait=ms=>new Promise(r=>setTimeout(r,ms??100));
 const folder='_Feishu Lite 批注验收-'+Date.now();await app.vault.createFolder(folder);const owned=app.vault.getAbstractFileByPath(folder);
 const wasEnabled=plugin.settings.commentsEnabled;
 let leaf=null;
 try{
  if(!wasEnabled){plugin.settings.commentsEnabled=true;await plugin.saveSettings();}
  const base='# 标题\n\n这是需要批注的正文内容。\n',from=base.indexOf('需要批注');
  const message=plugin.comments.message('批注验收消息');
  const body=core.addComment(base,from,from+4,message,core.commentId());
  const file=await app.vault.create(folder+'/批注验收.md',body);
  leaf=app.workspace.getLeaf('tab');
  await leaf.openFile(file,{active:false,state:{mode:'preview'}});await leaf.loadIfDeferred();
  await wait(500); // 给装饰链（addRoot → readNote → 扫描 → 建 mark）一个低负载起步窗口
  let mark=null;
  for(let n=0;n<50&&!mark;n++){await wait(150);mark=leaf.view.containerEl.querySelector('mark.fl-comment-read');}
  check(!!mark,'reading view decorates annotated text with a colored mark');
  check(!!mark.dataset.flThread,'reading view mark keeps its thread id');
  check(mark.textContent==='需要批注','reading view mark wraps exactly the annotated range');
  // 切到 Live Preview（重启编辑实例）：行内标记应仍在，且线程标记一致
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:false});
  let lpMark=null;
  for(let n=0;n<30&&!lpMark;n++){await wait(150);lpMark=leaf.view.containerEl.querySelector('.cm-content .fl-comment-text');}
  check(!!lpMark,'live preview keeps the inline comment mark after mode switch');
  check(lpMark.getAttribute('data-fl-thread')===mark.dataset.flThread,'live preview mark keeps the same thread id');
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  if(plugin.settings.commentsEnabled!==wasEnabled){plugin.settings.commentsEnabled=wasEnabled;await plugin.saveSettings();}
  try{const view=leaf?.view;if(view&&view.save)await view.save();}catch(e){}
  try{await leaf?.setViewState({type:'empty',active:false});}catch(e){}
  try{leaf?.detach();}catch(e){}
  try{await app.fileManager.trashFile(owned);}catch(e){}
 }
})()
