// Exercise actual standalone capture script with a minimal browser API harness.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const script=fs.readFileSync(new URL('../docs/js/capture.js',import.meta.url),'utf8');
const events=new Map(),elements=new Map(),downloads=[];const context2d=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
function element(id){if(elements.has(id))return elements.get(id);const e={id,value:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){},append(){},remove(){},click(){},addEventListener(type,fn){events.set(id+':'+type,fn)},getBoundingClientRect(){return {width:180,height:190,left:0,top:0}},getContext(){return context2d},setPointerCapture(){},hasPointerCapture(){return false},querySelector(sel){return element(id+sel)}};elements.set(id,e);return e;}
const pads=Array.from({length:5},(_,i)=>{const p=element('pad'+i);p.dataset.slot=String(i);return p;});const cards=Array.from({length:5},(_,i)=>element('card'+i));const data=new Map();
const fake={console,Blob,structuredClone,URL:{createObjectURL(b){downloads.push(b);return 'blob:mock'},revokeObjectURL(){}},document:{addEventListener(){},getElementById:element,querySelectorAll(s){return s==='.writing-pad'?pads:cards},createElement(){return element('created')},body:element('body')},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},ResizeObserver:class{observe(){}},setTimeout:()=>0,clearTimeout(){},confirm:()=>true,addEventListener(){},devicePixelRatio:1};fake.window=fake;
vm.createContext(fake);vm.runInContext(script,fake);await new Promise(r=>setImmediate(r));assert.equal(fake.schriftstudio.total,135);assert.equal(fake.schriftstudio.variants,0);
for(let i=0;i<5;i++){const e={pointerType:'touch',pointerId:1,clientX:40+i*5,clientY:130,currentTarget:pads[i],preventDefault(){}};events.get('pad'+i+':pointerdown')(e);events.get('pad'+i+':pointermove')({...e,clientX:65+i*5,clientY:70});events.get('pad'+i+':pointerup')({...e,clientX:90+i*5});}
assert.equal(fake.schriftstudio.variants,5);assert.equal(fake.schriftstudio.completed,1);
events.get('exportProfile:click')();const p=JSON.parse(await downloads.at(-1).text());assert.equal(p.version,3);assert.equal(p.glyphs.a.length,5);assert.ok(p.glyphs.a.every(g=>g.topMm===-2.5&&g.paths[0].d.startsWith('M')));
assert.equal(p.capture.samples.a.length,5);
events.get('backupProject:click')();const backup=JSON.parse(await downloads.at(-1).text());assert.equal(backup.capture.samples.a.length,5);
events.get('card4.trash-btn:click')();assert.equal(fake.schriftstudio.variants,4);
await events.get('projectFile:change')({target:{files:[{size:1000,text:async()=>JSON.stringify(backup)}]}});assert.equal(fake.schriftstudio.variants,5);
events.get('nextChar:click')();const persisted=JSON.parse([...data.values()][0]);assert.equal(persisted.index,1);assert.equal(persisted.samples.a.filter(s=>s.length).length,5);assert.ok(persisted.revision>0);
// Simulate immediate reload using the same browser storage.
vm.runInContext(script,fake);await new Promise(r=>setImmediate(r));assert.equal(fake.schriftstudio.character,'b');events.get('prevChar:click')();assert.equal(fake.schriftstudio.variants,5);
events.get('card4.trash-btn:click')();vm.runInContext(script,fake);await new Promise(r=>setImmediate(r));assert.equal(fake.schriftstudio.variants,4);
if(process.argv[2]){await events.get('projectFile:change')({target:{files:[{size:1000,text:async()=>fs.readFileSync(process.argv[2],'utf8')}]}});assert.equal(fake.schriftstudio.variants,4);}
console.log('OK: capture, five slots, JSON export, backup/restore, immediate reload, navigation, deletion persistence');
