import assert from 'node:assert/strict';
import {normalizeGlyphs} from '../docs/js/normalize.js';
import {validateSurface} from '../docs/js/surface.js';
const g=(w,h,y)=>({wMm:w,hMm:h,topMm:y,data:new Uint8Array([255]),off:false});
const raw={a:[g(2,2,-2),g(4,4,-2)],e:[g(3,3,-3)],A:[g(4,6,-6)],g:[g(3,4,-2)],b:[g(2.4,4.6,-4.6)],1:[g(1.2,4.8,-4.8)],'.':[g(.4,.4,0)]};
assert.deepEqual(normalizeGlyphs(raw),raw);
const pos=normalizeGlyphs(raw,{position:true});
assert.equal(pos.a[0].topMm+pos.a[0].hMm,pos.a[1].topMm+pos.a[1].hMm);
assert.equal(pos.a[0].hMm,2);
assert.ok(pos.g[0].topMm+pos.g[0].hMm>pos.a[0].topMm+pos.a[0].hMm);
const sizes=normalizeGlyphs(raw,{size:true});
assert.equal(sizes.a[0].hMm,3); // x-height median from a/e
assert.equal(sizes.a[1].hMm,3);
assert.equal(sizes.a[0].wMm,3);
assert.equal(sizes.a[0].topMm+sizes.a[0].hMm,0); // preserve bottom for normal letters
assert.equal(sizes.A[0].hMm,6); // capital keeps capital target height
assert.equal(sizes.b[0].hMm,4.6); // ascender target derived per class
assert.equal(sizes['1'][0].hMm,4.8); // digits get their own target height
assert.equal(sizes['.'][0].hMm,.4); // punctuation untouched by size normalization
const both=normalizeGlyphs(raw,{position:true,size:true});
assert.equal(both.a[0].topMm,both.a[1].topMm);
assert.ok(both.A[0].hMm>both.a[0].hMm); // class-aware heights
assert.ok(both.b[0].hMm>both.a[0].hMm); // ascender taller than x-height
assert.ok(both.g[0].topMm+both.g[0].hMm>both.a[0].topMm+both.a[0].hMm); // descender drops lower
assert.equal(raw.a[0].hMm,2);
assert.equal(validateSurface({app:'surface-schriftstudio',version:1,samples:{a:[[{thickness:9,points:[[.3,.2],[.4,.5]]}],[],[],[]]}}).length,1);
assert.throws(()=>validateSurface({app:'surface-schriftstudio',version:1,samples:{a:[[{thickness:9,points:[[2,0]]}],[],[],[]]}}));
console.log('OK: class-aware normalization, descenders, digits, punctuation, no mutation, Surface validation');
