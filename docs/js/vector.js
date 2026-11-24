import {pathData,captureGlyph,makeV3} from "./geometry-v3.js";
import {VectorEngine} from "./vector-engine.js";
// Vektorstudio v2 adapter. Source geometry is immutable; layout dimensions are separate.
import {median,SMALL} from './normalize.js';
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function importVector(raw){
 if(raw?.app!=='handwrite-vector'||![2,3].includes(raw.version)||raw.units!=='mm'||raw.coordinates!=='local-mm'||!raw.glyphs||Array.isArray(raw.glyphs)||typeof raw.glyphs!=='object')throw Error('Ungültiges Vektorprofil (v2/v3).');
 const glyphs=Object.create(null);let points=0,count=0;
 for(const [ch,gs] of Object.entries(raw.glyphs)){
  if([...ch].length!==1||!Array.isArray(gs)||gs.length>24)throw Error('Ungültige Zeichenvarianten.');
  glyphs[ch]=gs.map(g=>{
   if(!g||!finite(g.widthMm,.001,80)||!finite(g.heightMm,.001,80)||!finite(g.topMm,-100,100)||!Array.isArray(g.paths)||!g.paths.length||g.paths.length>2000)throw Error('Ungültige Vektorgeometrie.');
   const paths=g.paths.map(p=>{
    if(!p||!finite(p.widthMm,0,20)||!Array.isArray(p.pts)||!p.pts.length||p.pts.length>20000)throw Error('Ungültiger Vektorpfad.');
    points+=p.pts.length;if(points>3000000)throw Error('Zu viele Vektorpunkte.');
    const pts=p.pts.map(q=>{if(!Array.isArray(q)||q.length!==2||!q.every(v=>finite(v,-100,100)))throw Error('Ungültige Pfadkoordinaten.');return [...q];});
    if(raw.version===3&&p.d!=null&&p.d!==pathData(pts))throw Error('SVG-Pfad und Vektorkoordinaten stimmen nicht überein.');
    return {widthMm:p.widthMm,pts};
   }); count++;
   return {wMm:g.widthMm,hMm:g.heightMm,topMm:g.topMm,vectorW:g.widthMm,vectorH:g.heightMm,paths,off:g.off===true,source:g.source,...(Number.isInteger(g.slot)?{slot:g.slot}:{})};
  });
 }
 if(!count)throw Error('Vektorprofil enthält keine Zeichen.');
 // Surface exports use pad-top; legacy raster vectors may be baseline-relative.
 const active=Object.entries(glyphs).flatMap(([ch,gs])=>gs.filter(g=>!g.off).map(g=>({ch,g})));
 const small=active.filter(({ch})=>SMALL.includes(ch));
 const base=median((small.length?small:active).map(({g})=>g.topMm+g.hMm));
 // A common translation preserves the individual position deviations.
 if(raw.origin!=="baseline")for(const gs of Object.values(glyphs))for(const g of gs)g.topMm-=base;
 return {app:'handwrite-pdf',version:1,ppm:12,created:Date.now(),glyphs};
}
export function vectorRecord(g){
 const sx=g.wMm/g.vectorW,sy=g.hMm/g.vectorH;
 return {widthMm:g.wMm,heightMm:g.hMm,topMm:g.topMm,xOffsetMm:0,off:!!g.off,source:g.source||'vector',...(Number.isInteger(g.slot)?{slot:g.slot}:{}),paths:g.paths.map(p=>{const pts=p.pts.map(([x,y])=>[x*sx,y*sy]);return {widthMm:p.widthMm,pts,d:pathData(pts)};})};
}
export function vectorProfile(p){return {app:'handwrite-vector',version:3,units:'mm',coordinates:'local-mm',origin:'baseline',created:p.created,source:'handwriter/v6',glyphs:Object.fromEntries(Object.entries(p.glyphs).map(([ch,gs])=>[ch,gs.map(vectorRecord)]))};}
// Compute local paths in final canvas pixels, including all nested page/run transforms.
// Pen width is deliberately measured in final physical mm, not transformed geometry.
export function drawVector(ctx,g,w,h,pxPerMm,{stroke=1,widthMm=null,x=0,y=0}={}){
 const m=ctx.getTransform(), sx=w/g.vectorW,sy=h/g.vectorH;
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.lineCap='round';ctx.lineJoin='round';
 for(const p of g.paths){
  const pts=p.pts.map(([a,b])=>{const u=a*sx-w/2,v=b*sy-h/2;return [m.a*u+m.c*v+m.e+x*pxPerMm,m.b*u+m.d*v+m.f+y*pxPerMm];});
  ctx.lineWidth=Math.max(.04,widthMm??p.widthMm*stroke)*pxPerMm;ctx.beginPath();
  if(pts.length===1){ctx.arc(...pts[0],ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
  else{ctx.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)ctx.lineTo(...pts[i]);ctx.stroke();}
 }
 ctx.restore();
}

// Convert already imported raster samples without round-tripping through PNG or changing originals.
export async function vectorizeRasterProfile(profile,onProgress=()=>{}){
 const glyphs={};const entries=Object.entries(profile.glyphs);let done=0,converted=0,skipped=0;
 for(const [ch,gs] of entries){
  glyphs[ch]=gs.map(g=>{
   if(g.paths)return g;
   const w=g.w+2,h=g.h+2,mask=new Uint8Array(w*h);
   for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++)mask[(y+1)*w+x+1]=g.data[y*g.w+x]>=90?1:0;
   const rec=VectorEngine.rasterMaskToGlyph(mask,w,h,{wMm:g.wMm*w/g.w,hMm:g.hMm*h/g.h,topMm:g.topMm-g.hMm/g.h,off:g.off},{simplify:.65});
   if(!rec){skipped++;return g;}
   converted++;return {wMm:rec.widthMm,hMm:rec.heightMm,vectorW:rec.widthMm,vectorH:rec.heightMm,topMm:rec.topMm,off:rec.off,source:rec.source,paths:rec.paths};
  });
  onProgress(++done,entries.length);if(done%4===0)await new Promise(r=>setTimeout(r,0));
 }
 return {profile:{...profile,glyphs},converted,skipped};
}
export function surfaceVector(raw){
 const glyphs=Object.fromEntries(Object.entries(raw.samples).map(([ch,gs])=>[ch,gs.map((g,i)=>captureGlyph(g,i)).filter(Boolean)]).filter(([,gs])=>gs.length));
 return importVector(makeV3(glyphs));
}
