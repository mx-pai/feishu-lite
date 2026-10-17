// 链接粘贴选择菜单 + 悬浮转换条回归（编辑器级交互，不依赖阅读视图渲染）。
// 抓取统一用不可达地址（127.0.0.1:1）走「失败兜底」路径：不依赖外网，断言可重复。
// 断言读编辑器缓冲区（editor.getValue），不受磁盘落盘延迟影响。
(async()=>{
 const plugin=app.plugins.plugins["feishu-lite"];
 const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms??100));
 const folder="_Feishu Lite 链接粘贴验收-"+Date.now();await app.vault.createFolder(folder);const owned=app.vault.getAbstractFileByPath(folder);
 const file=await app.vault.create(folder+"/粘贴验收.md","# t\n\n\n");
 const prevLeaf=app.workspace.activeLeaf;
 const wasPasteMenu=plugin.settings.linkPasteMenu,wasHover=plugin.settings.linkHoverBar;
 let leaf=null;
 try{
  if(!wasPasteMenu){plugin.settings.linkPasteMenu=true;await plugin.saveSettings();}
  if(!wasHover){plugin.settings.linkHoverBar=true;await plugin.saveSettings();}
  leaf=app.workspace.getLeaf("tab");
  await leaf.openFile(file,{active:false,state:{mode:"source"}});await leaf.loadIfDeferred();
  try{app.workspace.setActiveLeaf(leaf,{focus:false});}catch(e){try{app.workspace.setActiveLeaf(leaf,false);}catch(e2){}}
  await sleep(300);
  const view=leaf.view,editor=view.editor;
  const firePaste=(text,html)=>{const dt=new DataTransfer();if(text!=null)dt.setData("text/plain",text);if(html)dt.setData("text/html",html);
   const evt=new ClipboardEvent("paste",{clipboardData:dt,cancelable:true,bubbles:true});app.workspace.trigger("editor-paste",evt,editor,view);return evt;};
  const menuItems=()=>[...document.querySelectorAll(".menu .menu-item")];
  const clickIn=el=>{for(const t of["mousedown","mouseup","click"])el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true}));};
  const clickMenu=label=>{const it=menuItems().find(el=>el.textContent.includes(label));if(!it)return false;clickIn(it);return true;};
  const waitFor=async(fn,ms)=>{const t0=Date.now();while(Date.now()-t0<(ms??15000)){if(fn())return true;await sleep(250);}return false;};
  const reset=async text=>{editor.setValue(text);await sleep(120);};
  // 清掉可能残留的悬浮条（异常中断遗留），避免干扰断言
  document.querySelectorAll(".fl-linkhover").forEach(el=>el.remove());
  const menuShown=()=>waitFor(()=>menuItems().length>0,4000); // 菜单 DOM 挂载等一拍，不做固定时长假设

  // ① 粘贴裸链接 → 菜单出现（三项），点「普通链接」→ 原地插入并关菜单
  await reset("# t\n\n");editor.setCursor({line:2,ch:0});
  let evt=firePaste("http://127.0.0.1:1/");
  check(evt.defaultPrevented,"lone-link paste is claimed");
  await menuShown();
  check(menuItems().length===3,"paste menu shows three options");
  check(clickMenu("普通链接"),"plain option is present");
  await sleep(300);
  check(editor.getValue()==="# t\n\nhttp://127.0.0.1:1/","plain option inserts the url in place");
  await waitFor(()=>menuItems().length===0,4000);
  check(menuItems().length===0,"menu closes after picking");
  check(editor.getCursor().ch===19,"cursor lands after the inserted url");

  // ② Esc 关闭 = 普通链接（粘贴内容不丢）
  await reset("# t\n\n");editor.setCursor({line:2,ch:0});
  firePaste("http://127.0.0.1:1/");
  await menuShown();
  await sleep(250); // 菜单按键处理就绪一拍，Esc 才收得到
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  await waitFor(()=>menuItems().length===0,4000);
  check(menuItems().length===0,"escape closes the menu");
  check(editor.getValue()==="# t\n\nhttp://127.0.0.1:1/","escape falls back to the plain link");

  // ③ 「标题链接」：抓取失败 → 兜底普通链接
  await reset("# t\n\n");editor.setCursor({line:2,ch:0});
  firePaste("http://127.0.0.1:1/");
  await menuShown();
  check(clickMenu("标题链接"),"title-link option is present");
  await waitFor(()=>editor.getValue().includes("http://127.0.0.1:1/"));
  check(editor.getValue()==="# t\n\nhttp://127.0.0.1:1/","title link falls back to plain when the fetch fails");

  // ④ 「链接卡片」：抓取失败 → 兜底基础卡片块
  await reset("# t\n\n");editor.setCursor({line:2,ch:0});
  firePaste("http://127.0.0.1:1/");
  await menuShown();
  check(clickMenu("链接卡片"),"card option is present");
  await waitFor(()=>editor.getValue().includes("[!link-card]"));
  check(editor.getValue()==="# t\n\n> [!link-card]\n> url: http://127.0.0.1:1/","card option inserts a minimal card on fetch failure");

  // ⑤ 代码块内 / 富文本粘贴：让位（不接管、不弹菜单）
  await reset("# t\n\n```\n\n```\n");editor.setCursor({line:3,ch:0});
  evt=firePaste("http://127.0.0.1:1/");
  await sleep(300);
  check(!evt.defaultPrevented,"paste inside a code fence is left alone");
  check(menuItems().length===0,"no menu inside a code fence");
  await reset("# t\n\n");editor.setCursor({line:2,ch:0});
  evt=firePaste("http://127.0.0.1:1/","<a href=\"http://127.0.0.1:1/\">x</a>");
  await sleep(300);
  check(!evt.defaultPrevented,"rich-text (html) paste is left to Obsidian");
  check(menuItems().length===0,"no menu for rich-text paste");

  // ⑥ 悬浮裸链接 → 转换条出现 → 点「卡片」→ 原地转换、条收起
  await reset("# t\n\n看这个 http://127.0.0.1:1/ 好\n");
  const cm=editor.cm;
  check(!!cm,"editor exposes the CodeMirror view");
  const line3=cm.state.doc.line(3);
  const coords=cm.coordsAtPos(line3.from+7);
  check(!!coords,"hover anchor coordinates are readable");
  cm.contentDOM.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,cancelable:true,clientX:(coords.left+coords.right)/2,clientY:(coords.top+coords.bottom)/2}));
  await waitFor(()=>!!document.querySelector(".fl-linkhover"),4000);
  const bar=document.querySelector(".fl-linkhover");
  check(!!bar,"hovering a link shows the convert bar");
  check(bar&&bar.querySelectorAll(".fl-linkhover-btn").length===2,"convert bar offers card / title");
  const cardBtn=bar&&[...bar.querySelectorAll(".fl-linkhover-btn")].find(b=>b.getAttribute("data-act")==="card");
  clickIn(cardBtn);
  await waitFor(()=>editor.getValue().includes("[!link-card]"));
  check(editor.getValue()==="# t\n\n看这个\n\n> [!link-card]\n> url: http://127.0.0.1:1/\n\n好\n","hover card converts the url in place");
  check(!document.querySelector(".fl-linkhover"),"convert bar hides after the click");
  return JSON.stringify({passed:checks.length,checks});
 }finally{
  if(plugin.settings.linkPasteMenu!==wasPasteMenu){plugin.settings.linkPasteMenu=wasPasteMenu;await plugin.saveSettings();}
  if(plugin.settings.linkHoverBar!==wasHover){plugin.settings.linkHoverBar=wasHover;await plugin.saveSettings();}
  try{if(prevLeaf)app.workspace.setActiveLeaf(prevLeaf,{focus:false});}catch(e){}
  try{const view=leaf?.view;if(view&&view.save)await view.save();}catch(e){}
  try{await leaf?.setViewState({type:"empty",active:false});}catch(e){}
  try{leaf?.detach();}catch(e){}
  try{await app.fileManager.trashFile(owned);}catch(e){}
 }
})()
