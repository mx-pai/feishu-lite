import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
// selection-ext.ts 零运行时依赖（obsidian 仅类型引入）→ 直接 bundle，无需 mock obsidian
const built=await build({entryPoints:[root+'src/selection-ext.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['obsidian']});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const base=()=>({id:'demo:translate',label:'译',run:()=>{}});

test('validate accepts a minimal item and rejects broken contracts',()=>{
	assert.equal(m.validateFlSelectionAction(base()),null);
	assert.equal(m.validateFlSelectionAction({...base(),title:'提示',multiLine:true}),null);
	assert.match(m.validateFlSelectionAction(null),/对象/);
	assert.match(m.validateFlSelectionAction({...base(),id:''}),/id/);
	assert.match(m.validateFlSelectionAction({...base(),id:'  '}),/id/);
	assert.match(m.validateFlSelectionAction({...base(),label:' '}),/label/);
	assert.match(m.validateFlSelectionAction({...base(),title:42}),/title/);
	assert.match(m.validateFlSelectionAction({...base(),multiLine:'yes'}),/multiLine/);
	assert.match(m.validateFlSelectionAction({...base(),run:null}),/run/);
});

test('adapt prefixes the id namespace and keeps run/editor passthrough',()=>{
	let got='none';
	const adapted=m.adaptFlSelectionAction({...base(),multiLine:true,run:(ed)=>{got=ed===null?'null':'editor';}});
	assert.equal(adapted.id,'ext:demo:translate');
	assert.equal(adapted.label,'译');
	assert.equal(adapted.multiLine,true);
	adapted.run(null);
	assert.equal(got,'null');
});

test('async run rejections stay visible to the caller (no silent swallow in adapt)',async()=>{
	const adapted=m.adaptFlSelectionAction({...base(),run:()=>Promise.reject(new Error('boom'))});
	await assert.rejects(()=>Promise.resolve().then(()=>adapted.run(null)),/boom/);
});
