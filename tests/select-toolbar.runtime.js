/* Run with Obsidian's eval command in a live Vault. No user note is modified.
   Obsidian CLI is background-only, so hasFocus is controlled for the isolated
   CodeMirror view; this does not assert OS-level mouse/touch focus behavior. */
(async () => {
  const source = app.workspace.getLeavesOfType("markdown").find(l => l.view.editor?.cm)?.view.editor.cm;
  if (!source) throw new Error("Open one Markdown editing pane before running");
  const registered = source.plugins.find(p => p.value?.buttons && p.value?.measureReq)?.spec.plugin.extension;
  if (!registered) throw new Error("Feishu Lite selection toolbar extension is missing");
  const host = document.body.createDiv();
  host.style.cssText = "position:fixed;left:30px;top:70px;width:380px;background:var(--background-primary);z-index:99";
  const originalSetting = app.plugins.plugins["feishu-lite"].settings.selectToolbar;
  const originalComments = app.plugins.plugins["feishu-lite"].settings.commentsEnabled;
  const checks = [];
  let view;
  const wait = async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    // A background Obsidian window can suspend requestAnimationFrame.
    // Drive the real CodeMirror measurement queue in this isolated view.
    view.measure();
  };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    app.plugins.plugins["feishu-lite"].settings.selectToolbar = true;
    view = new source.constructor({ state: source.state.constructor.create({
      doc: "工具条回归测试\n第二行文字", extensions: [registered]
    }), parent: host });
    Object.defineProperty(view, "hasFocus", { configurable: true, get: () => true });
    view.dispatch({selection:{anchor:0,head:4}});
    await wait();
    const bar = view.plugins.find(p => p.value?.buttons)?.value;
    assert(bar?.shown && bar.dom?.parentElement === document.body, "single-line toolbar mounts in body and displays");
    assert(bar.dom.querySelectorAll(".fl-selbar-dot").length === 7, "all seven highlight colors render");
    bar.dom.querySelector(".fl-hl-red").click();
    assert(view.state.doc.toString() === "=={red}工具条回==归测试\n第二行文字", "red highlight writes expected Markdown");
    bar.dom.querySelector(".fl-hl-blue").click();
    assert(view.state.doc.toString() === "=={blue}工具条回==归测试\n第二行文字", "recolor replaces markers without nesting");
    bar.dom.querySelector(".fl-hl-blue").click();
    assert(view.state.doc.toString() === "工具条回归测试\n第二行文字", "second click removes active highlight");
    bar.dom.querySelector(".fl-selbar-code").click();
    assert(view.state.doc.toString() === "`工具条回`归测试\n第二行文字", "inline-code button writes expected Markdown");
    bar.dom.querySelector(".fl-selbar-strike").click();
    assert(view.state.doc.toString() === "~~工具条回~~归测试\n第二行文字", "switching format removes old code markers");
    bar.dom.querySelector(".fl-selbar-strike").click();
    assert(view.state.doc.toString() === "工具条回归测试\n第二行文字", "strike button toggles off");
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
    assert(!bar.shown, "Escape dismisses toolbar");
    view.dispatch({selection:{anchor:1,head:5}});
    await wait();
    assert(bar.shown, "changing selection restores dismissed toolbar");
    view.dispatch({selection:{anchor:0,head:11}});
    await wait();
    assert(bar.shown, "multi-line selection exposes annotation entry");
    assert(bar.dom.querySelector(".fl-selbar-comment"), "annotation button is available");
    assert(bar.dom.querySelector(".fl-selbar-code").classList.contains("is-disabled"), "inline formatting is disabled for multi-line ranges");
    app.plugins.plugins["feishu-lite"].settings.commentsEnabled = false;
    view.dispatch({selection:{anchor:0,head:10}});
    await wait();
    assert(!bar.shown, "multi-line toolbar is suppressed when annotations are disabled");
    app.plugins.plugins["feishu-lite"].settings.commentsEnabled = originalComments;
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:"```js\nconst value = 1\n```"},selection:{anchor:6,head:11}});
    await wait();
    assert(!bar.shown, "fenced-code selection is excluded");
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:"工具条回归测试"},selection:{anchor:0,head:4}});
    app.plugins.plugins["feishu-lite"].settings.selectToolbar = false;
    view.dispatch({selection:{anchor:1,head:4}});
    await wait();
    assert(!bar.shown, "disabled setting suppresses toolbar");
    app.plugins.plugins["feishu-lite"].settings.selectToolbar = true;
    view.dispatch({selection:{anchor:0,head:4}});
    await wait();
    assert(bar.shown, "enabled setting restores toolbar");
    const dom = bar.dom;
    view.destroy(); view = null;
    assert(!dom.isConnected, "destroy removes toolbar and releases view listeners");
    return JSON.stringify({passed:checks.length,checks});
  } finally {
    view?.destroy(); host.remove();
    app.plugins.plugins["feishu-lite"].settings.selectToolbar = originalSetting;
    app.plugins.plugins["feishu-lite"].settings.commentsEnabled = originalComments;
  }
})()
