const run=window.__flRun;
if(!run || !/^_Feishu Lite 验收-\d+$/.test(run.folder)) throw new Error('No owned acceptance fixture');
const result={controlledChecks:run.checks.length,errors:run.errors.slice(),trashed:[]};
app.plugins.plugins['feishu-lite'].imageTools.closeToolbar(false);
for(const leaf of app.workspace.getLeavesOfType('markdown')) if(leaf.view.file?.path.startsWith(run.folder+'/')) {
 const view=leaf.view;if(view.save)await view.save();
 await leaf.setViewState({type:'empty',active:false});
 for(let n=0;n<100 && view.saving;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(view.saving)throw new Error('验收笔记仍在保存，临时文件已保留');
 leaf.detach();
}
for(const path of new Set(run.outputs)) {
 if(!path.split('/').pop().startsWith('fl-accept-')) throw new Error('Unexpected acceptance output path');
 const file=app.vault.getAbstractFileByPath(path);if(file){await app.fileManager.trashFile(file);result.trashed.push(path);}
}
const folder=app.vault.getAbstractFileByPath(run.folder);if(folder){await app.fileManager.trashFile(folder);result.trashed.push(run.folder);}
if(window.__flOldError) console.error=window.__flOldError;
delete window.__flRun;delete window.__flAssert;delete window.__flCore;delete window.__flOldError;
return JSON.stringify(result);
