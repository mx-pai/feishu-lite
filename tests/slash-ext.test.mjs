import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
// slash-ext.ts 零运行时依赖（obsidian 仅类型引入）→ 直接 bundle，无需 mock obsidian
const built=await build({entryPoints:[root+'src/slash-ext.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['obsidian']});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const base=()=>({id:'demo:run',name:'示例',keys:['demo','sf'],run:()=>{}});

test('validate accepts a minimal item and rejects broken contracts',()=>{
	assert.equal(m.validateFlSlashItem(base()),null);
	assert.equal(m.validateFlSlashItem({...base(),hint:'静态',secondary:true}),null);
	assert.equal(m.validateFlSlashItem({...base(),hint:()=>'x'}),null);
	assert.match(m.validateFlSlashItem(null),/对象/);
	assert.match(m.validateFlSlashItem({...base(),id:''}),/id/);
	assert.match(m.validateFlSlashItem({...base(),id:'  '}),/id/);
	assert.match(m.validateFlSlashItem({...base(),name:' '}),/name/);
	assert.match(m.validateFlSlashItem({...base(),keys:[]}),/keys/);
	assert.match(m.validateFlSlashItem({...base(),keys:['ok',3]}),/keys/);
	assert.match(m.validateFlSlashItem({...base(),keys:['']}),/keys/);
	assert.match(m.validateFlSlashItem({...base(),run:null}),/run/);
	assert.match(m.validateFlSlashItem({...base(),hint:42}),/hint/);
	assert.match(m.validateFlSlashItem({...base(),secondary:'yes'}),/secondary/);
});

test('resolveHint evaluates functions per render and never throws',()=>{
	assert.equal(m.resolveHint({hint:'静态'}),'静态');
	assert.equal(m.resolveHint({hint:()=>'动态'}),'动态');
	assert.equal(m.resolveHint({hint:undefined}),'');
	assert.equal(m.resolveHint({hint:()=>{throw new Error('boom')}}),'');
});

test('adapt maps to internal shape: namespaced id, plugin arg dropped, rest forwarded',()=>{
	const calls=[];
	const hint=()=>'h';
	const item={id:'demo:run',name:'示例',keys:['demo','sf'],secondary:true,hint,run:(editor,file)=>calls.push([editor,file])};
	const adapted=m.adaptFlSlashItem(item);
	assert.equal(adapted.id,'ext:demo:run');
	assert.equal(adapted.name,'示例');
	assert.deepEqual(adapted.keys,['demo','sf']);
	assert.equal(adapted.secondary,true);
	assert.equal(adapted.hint,hint); // 函数型 hint 原样保留，交给渲染点求值
	const editor={},file={path:'a.md'};
	adapted.run('PLUGIN',editor,file);
	assert.deepEqual(calls,[[editor,file]]);
});

test('adapted run keeps async rejections visible to the caller',async()=>{
	const adapted=m.adaptFlSlashItem({id:'x',name:'x',keys:['x'],run:async()=>{throw new Error('fail');}});
	await assert.rejects(Promise.resolve().then(()=>adapted.run(null,null,null)),/fail/);
});
