import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const root=new URL('../',import.meta.url).pathname;
const code=process.argv[2];
if (!code) throw new Error('Supply an eval snippet or setup');
const bundle=await build({stdin:{contents:'export * from "./src/comment-core"; export * from "./src/image-core";',resolveDir:root},bundle:true,write:false,format:'iife',globalName:'__flCore',platform:'browser',target:'es2020'});
const setup=String.raw`
 if (window.__flRun) throw new Error('Existing acceptance fixture must be cleaned first');
 const plugin=app.plugins.plugins['feishu-lite'], core=window.__flCore;
 const previousLeaf=app.workspace.activeLeaf;
 const folder='_Feishu Lite 验收-'+Date.now(); await app.vault.createFolder(folder);
 const canvas=document.createElement('canvas'); canvas.width=1280; canvas.height=720;
 const ctx=canvas.getContext('2d'); ctx.fillStyle='#eef4ff'; ctx.fillRect(0,0,1280,720); ctx.fillStyle='#1849a9'; ctx.fillRect(60,70,1160,110);
 ctx.fillStyle='#ffffff'; ctx.font='48px sans-serif'; ctx.fillText('Feishu Lite 图片编辑验收',90,140);
 ctx.fillStyle='#263238'; ctx.font='36px sans-serif'; ctx.fillText('这张原图用于验证裁剪、箭头、方框和文字',90,290);
 ctx.fillStyle='#c6d8fa'; ctx.fillRect(90,360,480,230); ctx.fillStyle='#263238'; ctx.fillText('源码截图区域',150,480); ctx.fillStyle='#ffca80'; ctx.fillRect(650,360,500,230); ctx.fillStyle='#263238'; ctx.fillText('报错说明区域',710,480);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const original=await app.vault.createBinary(folder+'/fl-accept-original.png',await blob.arrayBuffer());
 const second=await app.vault.createBinary(folder+'/fl-accept-second.png',await blob.arrayBuffer());
 const doc='# 功能验收\n\n读到这句话时可以留下疑问，并在后续补充回复\n\n重新关联时保留原始摘录\n\n- 列表结构保持完整\n\n> 引用结构保持完整\n\n> [!img-2]\n> ![['+original.path+']]\n> ![['+second.path+']]\n';
 const file=await app.vault.create(folder+'/功能验收.md',doc), target=await app.vault.create(folder+'/迁移目标.md','目标笔记原有内容\n');
 const leaf=app.workspace.getLeaf('tab'); await leaf.openFile(file,{state:{mode:'source'}}); await app.workspace.revealLeaf(leaf);
 window.__flRun={folder,file,target,original,second,previousLeaf,leaf,outputs:[],checks:[],errors:[]};
 window.__flOldError=console.error; console.error=(...args)=>{window.__flRun?.errors.push(args.map(a=>String(a)).join(' '));window.__flOldError(...args)};
 window.__flAssert=(condition,label)=>{if(!condition)throw new Error(label);window.__flRun.checks.push(label)};
 const renderer=leaf.view.previewMode.renderer;
 const m=plugin.comments.message('解析器验收');
 for(const [name,text,from,to,expected] of [['heading','# 标题\n',2,4,'<h1'],['list','- 第一项\n',2,5,'<ul'],['quote','> 引用\n',2,4,'<blockquote']]){
  const annotated=core.parseComments(core.addComment(text,from,to,m,core.commentId())).body;
  let parsed;renderer.parseSync.call({text:annotated,parseFinish:(_,p)=>{parsed=p}});
  window.__flAssert(parsed.sections.some(s=>s.html.includes(expected)),name+' structure survives annotation in actual Markdown parser');
 }
 return JSON.stringify({folder,editorReady:!!leaf.view.editor?.cm,checks:window.__flRun.checks});
`;
const scripts={layout:'image-layout.runtime.js',cleanup:'cleanup-runtime.js',toolbar:'image-toolbar.runtime.js',native:'image-native.runtime.js',arrow:'image-arrow.runtime.js'};
const input=code==='setup' ? setup : scripts[code] ? (['toolbar','native','arrow'].includes(code)?'return await ':'')+readFileSync(root+'tests/'+scripts[code],'utf8') : code;
const result=execFileSync('obsidian',['vault=new_obsidian','eval','code=(async()=>{'+bundle.outputFiles[0].text+';window.__flCore=__flCore;'+input+'})()'],{encoding:'utf8',maxBuffer:4*1024*1024});
process.stdout.write(result);
