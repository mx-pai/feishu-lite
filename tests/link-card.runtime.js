// 链接卡片渲染回归：> [!link-card] → 阅读视图自绘卡片
// （字段读取 / three 版式 / 无 url 降级为原生 callout / favicon 失败回落字母方块）。
// 渲染可能被窗口可见性或低负载推迟，故 500ms 起步后 150ms 步进轮询（最长 ~8s）。
(async()=>{
 const plugin=app.plugins.plugins['feishu-lite'];
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)},wait=ms=>new Promise(r=>setTimeout(r,ms??100));
 const folder='_Feishu Lite 链接卡片验收-'+Date.now();await app.vault.createFolder(folder);const owned=app.vault.getAbstractFileByPath(folder);
 const wasEnabled=plugin.settings.linkCard;
 let leaf=null;
 try{
  if(!wasEnabled){plugin.settings.linkCard=true;await plugin.saveSettings();}
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#cfe3ff';ctx.fillRect(0,0,320,200);ctx.fillStyle='#1849a9';ctx.font='28px sans-serif';ctx.fillText('卡片配图',36,110);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const imgName='fl-card-verify-'+Date.now()+'.png';
  await app.vault.createBinary(folder+'/'+imgName,await blob.arrayBuffer());
  const doc=[
   '# 链接卡片验收','',
   '> [!link-card]','> url: https://www.investor.gov/','> title: Investor.gov — 投资者教育','> description: 美国 SEC 的投资者教育门户','> site: investor.gov','> favicon: http://127.0.0.1:1/missing.ico','',
   '> [!link-card]','> url: https://example.com/page','> title: Compact 卡片','> image: '+imgName,'> site: example.com','',
   '> [!link-card]','> url: https://example.com/large','> title: Large 卡片','> image: '+imgName,'> layout: large','> site: example.com','',
   '> [!link-card]','> title: 没有 url 的卡片','',
  ].join('\n');
  const file=await app.vault.create(folder+'/链接卡片验收.md',doc);
  leaf=app.workspace.getLeaf('tab');
  await leaf.openFile(file,{active:false,state:{mode:'preview'}});await leaf.loadIfDeferred();
  await wait(500);
  let cards=[];
  for(let n=0;n<50&&cards.length<3;n++){await wait(150);cards=[...leaf.view.containerEl.querySelectorAll('.fl-linkcard')];}
  check(cards.length===3,'three link cards render in reading view');
  check(leaf.view.containerEl.querySelectorAll('.callout[data-callout="link-card"]').length===4,'card without url degrades to a plain callout');
  const [c1,c2,c3]=cards;
  check(c1.dataset.layout==='text','card without image resolves to text layout');
  const hit1=c1.querySelector('a.fl-linkcard-hit');
  check(hit1?.getAttribute('href')==='https://www.investor.gov/','card anchor keeps the url');
  check(hit1?.getAttribute('target')==='_blank','card anchor opens in a new tab');
  check(c1.querySelector('.fl-linkcard-title')?.textContent==='Investor.gov — 投资者教育','title field renders');
  check(c1.querySelector('.fl-linkcard-desc')?.textContent==='美国 SEC 的投资者教育门户','description field renders');
  check(c1.querySelector('.fl-linkcard-site')?.textContent==='investor.gov','site field renders');
  check(c2.dataset.layout==='compact','card with image resolves to compact layout');
  check(!!c2.querySelector('.fl-linkcard-thumb img'),'compact layout shows the thumb image');
  check(c3.dataset.layout==='large','explicit layout: large wins');
  check(!!c3.querySelector('.fl-linkcard-cover img'),'large layout shows the cover image');
  // favicon 请求必然失败（127.0.0.1:1）→ 图被移除、字母方块补上
  let glyph=null;
  for(let n=0;n<20&&!glyph;n++){await wait(150);glyph=c1.querySelector('.fl-linkcard-glyph');}
  check(!!glyph,'failed favicon falls back to the letter glyph');
  check(!c1.querySelector('.fl-linkcard-favicon'),'failed favicon image is removed');
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  if(plugin.settings.linkCard!==wasEnabled){plugin.settings.linkCard=wasEnabled;await plugin.saveSettings();}
  try{const view=leaf?.view;if(view&&view.save)await view.save();}catch(e){}
  try{await leaf?.setViewState({type:'empty',active:false});}catch(e){}
  try{leaf?.detach();}catch(e){}
  try{await app.fileManager.trashFile(owned);}catch(e){}
 }
})()
