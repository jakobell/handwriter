// Schriftstudio Surface v1: normalized pointer coordinates, 18 × 19 mm, baseline 72%.
import {CHARSET} from './layout.js';
export const SURFACE_PPM=12, W=216,H=228, BASE=19*.72;
export function validateSurface(raw){
 if(!raw||raw.app!=='surface-schriftstudio'||raw.version!==1||!raw.samples||typeof raw.samples!=='object'||Array.isArray(raw.samples))throw Error('Ungültige Schriftstudio-Projektdatei.');
 const entries=Object.entries(raw.samples);let total=0;
 if(entries.length>CHARSET.length)throw Error('Zu viele Zeichen.');
 for(const [ch,variants] of entries){
  if([...ch].length!==1||!CHARSET.includes(ch)||!Array.isArray(variants)||![4,5].includes(variants.length))throw Error('Unbekanntes Zeichen oder ungültige Varianten.');
  for(const strokes of variants){if(!Array.isArray(strokes)||strokes.length>200)throw Error('Ungültige Strichliste.');for(const s of strokes){if(!s||!Number.isFinite(s.thickness)||s.thickness<3||s.thickness>30||!Array.isArray(s.points)||!s.points.length||s.points.length>10000||!s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1)))throw Error('Ungültige Strichdaten.');total+=s.points.length;if(total>2000000)throw Error('Projekt enthält zu viele Punkte.');}}
 }
 return entries;
}
export function rasterizeSurface(strokes){
 if(!strokes.length)return null;
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='white';ctx.fillRect(0,0,W,H);ctx.fillStyle='#24334d';ctx.strokeStyle='#24334d';ctx.lineCap='round';ctx.lineJoin='round';
 for(const {points:pts,thickness} of strokes){const x=p=>p[0]*W,y=p=>p[1]*H;ctx.lineWidth=Math.max(1,thickness/1000*W);ctx.beginPath();if(pts.length===1){ctx.arc(x(pts[0]),y(pts[0]),ctx.lineWidth/2,0,Math.PI*2);ctx.fill();continue;}ctx.moveTo(x(pts[0]),y(pts[0]));for(let i=1;i<pts.length-1;i++)ctx.quadraticCurveTo(x(pts[i]),y(pts[i]),(x(pts[i])+x(pts[i+1]))/2,(y(pts[i])+y(pts[i+1]))/2);ctx.lineTo(x(pts.at(-1)),y(pts.at(-1)));ctx.stroke();}
 const px=ctx.getImageData(0,0,W,H).data;let x0=W,y0=H,x1=-1,y1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(px[(y*W+x)*4]<235){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 if(x1<0)return null;x0=Math.max(0,x0-2);y0=Math.max(0,y0-2);x1=Math.min(W-1,x1+2);y1=Math.min(H-1,y1+2);
 const w=x1-x0+1,h=y1-y0+1,data=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data[y*w+x]=255-px[((y+y0)*W+x+x0)*4];
 return {w,h,data,wMm:w/SURFACE_PPM,hMm:h/SURFACE_PPM,topMm:y0/SURFACE_PPM-BASE,off:false};
}
export function importSurface(raw){const glyphs={};for(const [ch,variants] of validateSurface(raw)){const gs=variants.map(rasterizeSurface).filter(Boolean);if(gs.length)glyphs[ch]=gs;}if(!Object.keys(glyphs).length)throw Error('Das Schriftstudio-Projekt enthält keine Zeichnungen.');return {app:'handwrite-pdf',version:1,ppm:SURFACE_PPM,created:Date.now(),glyphs};}
