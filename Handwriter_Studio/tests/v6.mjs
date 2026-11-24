import assert from 'node:assert/strict';
import fs from 'node:fs';
import {captureGlyph,makeV3,profileSvg,pathData} from '../docs/js/geometry-v3.js';
import {importVector,drawVector} from '../docs/js/vector.js';
import {importProfile,exportProfile} from '../docs/js/profile.js';
import {markdownToBlocks} from '../docs/js/structured.js';
const strokes=(x,y,scale)=>[{thickness:9,points:[[x,y],[x+.07*scale,y-.12*scale],[x+.14*scale,y]]}];
const records={a:Array.from({length:5},(_,i)=>captureGlyph(strokes(.12+i*.08,.5+i*.05,.8+i*.15),i)),A:[captureGlyph(strokes(.3,.7,2),0)],g:[captureGlyph(strokes(.3,.8,1.8),0)],'.':[captureGlyph([{thickness:9,points:[[.4,.7]]}],0)]};
const v3=makeV3(records);assert.equal(v3.version,3);assert.equal(v3.variantTarget,5);
for(const g of v3.glyphs.a){assert.equal(g.heightMm,2.5);assert.equal(g.topMm,-2.5);assert.equal(g.xOffsetMm,0);assert.equal(g.paths[0].d,pathData(g.paths[0].pts));assert.equal(g.paths[0].widthMm,.162);}
assert.ok(v3.glyphs.A[0].heightMm>2.5);assert.ok(v3.glyphs.g[0].topMm+v3.glyphs.g[0].heightMm>0);assert.ok(v3.glyphs['.'][0].heightMm<1);
assert.ok(profileSvg(v3).includes('<metadata id="handwrite-vector-profile">'));assert.ok(!JSON.stringify(v3).includes('data:image/png'));
const p=await importProfile(new Blob([JSON.stringify(v3)]));const p2=await importProfile(exportProfile(p));assert.deepEqual(p2.glyphs,p.glyphs);
const mock=(a)=>({widths:[],getTransform(){return {a,b:0,c:0,d:a,e:0,f:0}},save(){},restore(){},setTransform(){},beginPath(){},moveTo(){},lineTo(){},stroke(){this.widths.push(this.lineWidth)},arc(x,y,r){this.widths.push(r*2)},fill(){}});
for(const a of [.1,.4,1,2]){const c=mock(a);drawVector(c,p.glyphs.a[0],a*25,a*25,10,{widthMm:.27});assert.deepEqual(c.widths,[2.7]);}
globalThis.document={createElement:()=>({getContext:()=>({measureText:()=>({actualBoundingBoxLeft:0,actualBoundingBoxRight:55,actualBoundingBoxAscent:70})})})};
const {Hand,layout,layoutPositioned,PAPER}=await import('../docs/js/writer.js');
const input=process.argv[2];const profile=input?importVector(JSON.parse(fs.readFileSync(input,'utf8'))):p;const hand=new Hand(profile);
const text=Array.from({length:26},()=>('aAga aaga aaga 123. '.repeat(48)+'\n\n')).join('')+'\n| a | A | g |\n| --- | --- | --- |\n'+Array.from({length:40},()=> '| '+('aaga '.repeat(10))+'| '+('ag '.repeat(6))+'| ag |').join('\n');
const blocks=markdownToBlocks(text);const opts={size:1.4,paper:'a3-landscape',seed:137};
const nofit=layout(blocks,hand,opts);const count=out=>out.pages.flatMap(p=>p.ops).filter(o=>['img','shape','text'].includes(o.t)).length;
for(const fitPages of [1,2,3]){const out=layout(blocks,hand,{...opts,fitPages});assert.ok(out.pages.length<=fitPages);assert.equal(count(out),count(nofit));assert.ok(out.pages.every(p=>p.ops.length));console.log('Reflow',fitPages,'->',out.pages.length,'size',out.size,'glyphs',count(out));}
const source=Array.from({length:9},(_,i)=>({width:210,height:297,image:{},ruleFree:{},runs:[{text:'aAga 123',x:12,y:30+i*3,height:4,width:35,angle:0}]}));
const original=layoutPositioned(source,hand,opts);const glyphCount=ops=>ops.reduce((n,o)=>n+(o.t==='group'?glyphCount(o.ops):['img','shape','text'].includes(o.t)?1:0),0);
for(const fitPages of [1,2,4,12]){const out=layoutPositioned(source,hand,{...opts,fitPages});assert.equal(out.pages.length,Math.min(fitPages,source.length));assert.equal(out.pages.flatMap(p=>p.ops).length,source.length);assert.equal(glyphCount(out.pages.flatMap(p=>p.ops)),glyphCount(original.pages.flatMap(p=>p.ops)));for(const page of out.pages){const [W,H]=PAPER[opts.paper];assert.deepEqual(page.dimensions,[W,H]);for(const op of page.ops){const bg=op.ops[0];assert.ok(op.x>=0&&op.y>=0&&op.x+op.sx*bg.w<=W+1e-6&&op.y+op.sy*bg.h<=H+1e-6);}}console.log('Original',fitPages,'->',out.pages.length,'source pages',source.length,'minScale',out.minScale);}
console.log('OK: five SVG variants, baseline/size normalization, roundtrip, absolute pen width, no dropped glyphs in squeeze, 9-page layout');
