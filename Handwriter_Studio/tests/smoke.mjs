import assert from 'node:assert/strict';
import {CHARSET, sheets, MAX_PAGES} from '../docs/js/layout.js';
import {toChars} from '../docs/js/textin.js';
import {markdownToBlocks} from '../docs/js/structured.js';
// Layout engine is independent of browser painting except for fallback font measurement.
globalThis.document={createElement:()=>({getContext:()=>({measureText:()=>({actualBoundingBoxLeft:0,actualBoundingBoxRight:55,actualBoundingBoxAscent:70})})})};
const {Hand,layout,layoutPositioned,PAPER}=await import('../docs/js/writer.js');
assert.equal(new Set(CHARSET).size,262); assert.equal(sheets().length,MAX_PAGES);assert.equal(MAX_PAGES,9);
const old='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?\'"()[]-/&@#%+=*$<>_';assert.ok(CHARSET.startsWith(old));
const known=new Set('aäöüßÄÖÜẞ€→²−');const txt='äöüßÄÖÜẞ€→²−';assert.equal(toChars(txt,false,known,new Map()).map(c=>c[0]).join(''),txt.normalize('NFC'));
assert.equal(toChars('ä→',false,new Set('a'),new Map()).map(c=>c[0]).join(''),'ä→');
const blocks=markdownToBlocks('# Test\n\n| Name | Value |\n| --- | --- |\n| äöü | 42 € → |');assert.equal(blocks[1].kind,'table');assert.equal(blocks[1].rows[1][1],'42 € →');
const glyph={w:12,h:20,data:new Uint8Array(240).fill(255),wMm:1,hMm:2,topMm:-2};const hand=new Hand({ppm:12,glyphs:Object.fromEntries([...CHARSET].map(c=>[c,[glyph]]))});
const out=layout(blocks,hand,{size:1,paper:'a3-landscape',fitPages:1,seed:12});assert.equal(out.pages.length,1);assert.ok(out.pages[0].ops.some(o=>o.t==='line'));assert.equal(out.fallback.size,0);
const source=[{width:200,height:100,image:{},runs:[{text:'äöü€→',x:10,y:20,height:4,width:30,angle:0}]}];const pos=layoutPositioned(source,hand,{paper:'a4',size:1,fitPages:0,autoPaper:true,seed:1});assert.deepEqual(pos.pages[0].dimensions,[200,100]);assert.equal(pos.pages[0].ops[0].ops[0].t,'background');assert.equal(pos.pages[0].ops[0].ops[1].ops.length,5);
const tiled=layoutPositioned([...source,...source,...source],hand,{paper:'a3-landscape',size:1,fitPages:1,seed:1});assert.equal(tiled.pages.length,1);assert.deepEqual(tiled.pages[0].dimensions,PAPER['a3-landscape']);assert.equal(tiled.pages[0].ops.length,3);
console.log('OK: charset, compatibility, Unicode, Markdown tables, reflow, positioned and tiled layout');
