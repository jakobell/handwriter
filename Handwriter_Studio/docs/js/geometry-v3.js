import {normalizeGlyphs,median,SMALL} from './normalize.js';
// Shared v3 geometry: millimetres, y down, baseline 0, x origin at left ink edge.
export const round4=n=>Math.round(n*10000)/10000;
export function pathData(pts){return pts.map(([x,y],i)=>`${i?'L':'M'}${round4(x)} ${round4(y)}`).join(' ')+(pts.length===1?' L'+round4(pts[0][0])+' '+round4(pts[0][1]):'');}
export function svgPath(p){return `<path d="${pathData(p.pts)}" fill="none" stroke="currentColor" stroke-width="${round4(p.widthMm)}" stroke-linecap="round" stroke-linejoin="round"/>`;}
// Sample the exact midpoint-quadratic curves shown during capture; no bitmap involved.
export function captureGlyph(strokes,slot){
 const paths=[];
 for(const s of strokes){if(!s.points.length)continue;
  const p=s.points.map(([x,y])=>[x*18,y*19]);const pts=[p[0]];
  if(s.polyline){paths.push({widthMm:s.thickness*.018,pts:p});continue;}
  for(let i=1;i<p.length-1;i++){const a=pts.at(-1),b=p[i],c=[(b[0]+p[i+1][0])/2,(b[1]+p[i+1][1])/2];const steps=Math.max(2,Math.min(16,Math.ceil((Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-b[0],c[1]-b[1]))/.10)));for(let j=1;j<=steps;j++){const t=j/steps,u=1-t;pts.push([u*u*a[0]+2*u*t*b[0]+t*t*c[0],u*u*a[1]+2*u*t*b[1]+t*t*c[1]]);}}
  if(p.length>1)pts.push(p.at(-1));paths.push({widthMm:s.thickness*.018,pts});
 }
 if(!paths.length)return null;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of paths)for(const [x,y] of p.pts){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 const pad=.12;
 return {widthMm:Math.max(.24,maxX-minX+2*pad),heightMm:Math.max(.24,maxY-minY+2*pad),topMm:minY-pad-19*.72,source:'original-strokes',slot,paths:paths.map(p=>({...p,pts:p.pts.map(([x,y])=>[x-minX+pad,y-minY+pad])}))};
}
// Bake class-aware normalization into geometry, not the pen. Crop x and retain aspect ratios.
export function normalizedRecords(records){
 const internal=Object.fromEntries(Object.entries(records).map(([ch,gs])=>[ch,gs.map(g=>{
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of g.paths)for(const [x,y] of p.pts){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const pad=.12,w=maxX-minX+2*pad,h=maxY-minY+2*pad;
  return {...g,wMm:w,hMm:h,topMm:g.topMm+minY-pad,paths:g.paths.map(p=>({...p,pts:p.pts.map(([x,y])=>[x-minX+pad,y-minY+pad])}))};
 })]));
 const norm=normalizeGlyphs(internal,{position:true,size:true});
 const xHeight=median([...SMALL].flatMap(c=>(norm[c]||[]).filter(g=>!g.off).map(g=>g.hMm)));
 const active=Object.entries(norm).flatMap(([ch,gs])=>gs.filter(g=>!g.off).map(g=>({ch,g})));
 const small=active.filter(({ch})=>SMALL.includes(ch));const base=small.length?median(small.map(({g})=>g.topMm+g.hMm)):0;
 const scale=xHeight>0?2.5/xHeight:1;
 return Object.fromEntries(Object.entries(norm).map(([ch,gs])=>[ch,gs.map((g,i)=>{
  const old=internal[ch][i],sx=g.wMm/old.wMm*scale,sy=g.hMm/old.hMm*scale;
  const paths=g.paths.map(p=>{const pts=p.pts.map(([x,y])=>[round4(x*sx),round4(y*sy)]);return {widthMm:round4(p.widthMm),pts,d:pathData(pts)};});
  return {widthMm:round4(g.wMm*scale),heightMm:round4(g.hMm*scale),topMm:round4((g.topMm-base)*scale),xOffsetMm:0,off:!!g.off,source:g.source||'vector',...(Number.isInteger(g.slot)?{slot:g.slot}:{}),paths};
 })]));
}
export function makeV3(records,extra={}){return {app:'handwrite-vector',version:3,units:'mm',coordinates:'local-mm',origin:'baseline',normalized:true,variantTarget:5,created:Date.now(),...extra,glyphs:normalizedRecords(records)};}
export function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function profileSvg(profile){
 const rows=Object.entries(profile.glyphs),w=130,h=12+rows.length*12;
 let body=`<rect width="${w}" height="${h}" fill="white"/><text x="4" y="7" font-size="4" font-family="sans-serif">Handschriftprofil · V3 · 5 Varianten</text>`;
 rows.forEach(([ch,gs],i)=>{const y=17+i*12;body+=`<text x="4" y="${y}" font-size="4" font-family="sans-serif">${esc(ch)}</text>`;gs.forEach((g,j)=>{const x=16+(g.slot??j)*22;body+=`<path d="M${x-2} ${y}h18" stroke="#ddd" stroke-width=".1"/><g transform="translate(${x} ${y+g.topMm})" color="#24334d">${g.paths.map(svgPath).join('')}</g>`;});});
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><metadata id="handwrite-vector-profile">${esc(JSON.stringify(profile))}</metadata>${body}</svg>`;
}
