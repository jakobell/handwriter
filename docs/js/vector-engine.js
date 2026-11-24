(function(root){
'use strict';
const APP='handwrite-vector', VERSION=2;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const median=a=>{const b=a.filter(finite).sort((x,y)=>x-y);return b.length?b[(b.length-1)>>1]:0;};
const LIMIT=600, MAX_COPIES=8;
const tick=()=>new Promise(r=>setTimeout(r,0));
const optsDefaults={threshold:145,simplify:0.65,maxside:180};
const isGlyphKey=k=>[...k].length===1;
const svgEsc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const fmt=n=>Number(n).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');

function validateInput(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Ungültiges JSON-Objekt.');
 if(raw.app==='surface-schriftstudio'&&raw.version===1){
   if(!raw.samples||typeof raw.samples!=='object'||Array.isArray(raw.samples))throw Error('Keine Fingerstriche gefunden.');
   let count=0;
   for(const [ch,copies] of Object.entries(raw.samples)){
     if(!isGlyphKey(ch)||!Array.isArray(copies)||copies.length>MAX_COPIES)throw Error('Ungültige Zeichenvarianten im Projekt.');
     for(const strokes of copies){
       if(!Array.isArray(strokes)||strokes.length>220)throw Error('Ungültige Anzahl von Strichen.');
       for(const s of strokes){
         if(!s||!finite(s.thickness)||s.thickness<0||s.thickness>50||!Array.isArray(s.points)||s.points.length>15000)throw Error('Ungültige Strichdaten.');
         for(const p of s.points)if(!Array.isArray(p)||p.length!==2||!p.every(v=>finite(v)&&v>=0&&v<=1))throw Error('Ungültige Koordinaten.');
       }
       count+=strokes.length;
     }
   }
   if(count===0)throw Error('Dieses Schriftstudio-Projekt enthält noch keine Zeichnungen.');
   return 'strokes';
 }
 if(raw.app==='handwrite-pdf'&&raw.version===1){
   if(!finite(raw.ppm)||raw.ppm<1||raw.ppm>50||!raw.glyphs||typeof raw.glyphs!=='object'||Array.isArray(raw.glyphs))throw Error('Ungültiges handwrite-pdf-Profil.');
   for(const [ch,copies] of Object.entries(raw.glyphs)){
     if(!isGlyphKey(ch)||!Array.isArray(copies)||copies.length>MAX_COPIES)throw Error('Ungültige Glyph-Daten.');
     for(const g of copies){
       if(!g||typeof g.png!=='string'||!g.png.startsWith('data:image/png;base64,')||g.png.length>2e6||![g.wMm,g.hMm,g.topMm].every(finite)||g.wMm<0||g.wMm>80||g.hMm<0||g.hMm>80)throw Error('Ungültiges Glyph-Bild.');
     }
   }
   if(!Object.keys(raw.glyphs).length)throw Error('Das Profil enthält keine Zeichen.');
   return 'raster';
 }
 if(raw.app===APP&&raw.version===VERSION){
   if(!raw.glyphs||typeof raw.glyphs!=='object'||Array.isArray(raw.glyphs))throw Error('Ungültiges Vektorprofil.');
   for(const [ch,copies] of Object.entries(raw.glyphs)){
     if(!isGlyphKey(ch)||!Array.isArray(copies)||copies.length>MAX_COPIES)throw Error('Ungültiges Vektorprofil.');
     for(const g of copies){
       if(!g||![g.widthMm,g.heightMm,g.topMm].every(finite)||g.widthMm<0||g.widthMm>80||g.heightMm<0||g.heightMm>80||!Array.isArray(g.paths))throw Error('Ungültige Vektorglyphe.');
       for(const p of g.paths){
         if(!finite(p.widthMm)||p.widthMm<0||p.widthMm>20||!Array.isArray(p.pts)||!p.pts.length||p.pts.length>20000||!p.pts.every(q=>Array.isArray(q)&&q.length===2&&q.every(finite)))throw Error('Ungültige Pfaddaten.');
       }
     }
   }
   return 'vector';
 }
 throw Error('Nicht unterstütztes Profil. Lade mein-handschriftprofil.json oder schriftstudio-projekt.json aus unserem Schriftstudio hoch.');
}

function vectorizeOriginal(strokes){
 const all=[],raw=[];
 for(const s of strokes){
   if(!s.points.length)continue;
   const pts=s.points.map(([x,y])=>[x*18,y*19]);
   const widthMm=clamp(s.thickness*18/1000,0.045,3);
   raw.push({pts,widthMm});
   for(const p of pts)all.push([p[0],p[1],widthMm/2]);
 }
 if(!all.length)return null;
 let minX=18,minY=19,maxX=0,maxY=0;
 for(const p of all){minX=Math.min(minX,p[0]-p[2]);maxX=Math.max(maxX,p[0]+p[2]);minY=Math.min(minY,p[1]-p[2]);maxY=Math.max(maxY,p[1]+p[2]);}
 minX=clamp(minX,0,18);maxX=clamp(maxX,0,18);minY=clamp(minY,0,19);maxY=clamp(maxY,0,19);
 return {widthMm:Math.max(0.1,maxX-minX),heightMm:Math.max(0.1,maxY-minY),topMm:minY,off:false,source:'original-strokes',paths:raw.map(p=>({widthMm:p.widthMm,pts:p.pts.map(([x,y])=>[+(x-minX).toFixed(4),+(y-minY).toFixed(4)])}))};
}

function pngToMask(src,maxside,threshold){
 return new Promise((resolve,reject)=>{
  const im=new Image();
  im.onerror=()=>reject(Error('Bild im JSON konnte nicht gelesen werden.'));
  im.onload=()=>{
    if(!im.width||!im.height||im.width>LIMIT||im.height>LIMIT){reject(Error('Ein Bild hat eine ungültige Größe.'));return;}
    const s=Math.min(1,maxside/Math.max(im.width,im.height));
    const w=Math.max(1,Math.round(im.width*s)),h=Math.max(1,Math.round(im.height*s));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const cx=c.getContext('2d',{willReadFrequently:true});cx.fillStyle='#fff';cx.fillRect(0,0,w,h);cx.drawImage(im,0,0,w,h);
    const data=cx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
    const cutoff=255-threshold;
    for(let i=0;i<mask.length;i++){
      const j=i*4;const lum=.2126*data[j]+.7152*data[j+1]+.0722*data[j+2];
      mask[i]=lum<cutoff?1:0;
    }
    resolve({w,h,mask});
  };
  im.src=src;
 });
}

function skeletonize(input,w,h){
 const mask=new Uint8Array(input),del=[];
 let pass=0,changed=true;
 while(changed&&pass++<110){
  changed=false;
  for(let step=0;step<2;step++){
    del.length=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;if(!mask[i])continue;
      const p2=mask[i-w],p3=mask[i-w+1],p4=mask[i+1],p5=mask[i+w+1],p6=mask[i+w],p7=mask[i+w-1],p8=mask[i-1],p9=mask[i-w-1];
      const n=p2+p3+p4+p5+p6+p7+p8+p9;
      if(n<2||n>6)continue;
      const a=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);
      if(a!==1)continue;
      if(step===0){if(p2*p4*p6||p4*p6*p8)continue;}
      else if(p2*p4*p8||p2*p6*p8)continue;
      del.push(i);
    }
    if(del.length){changed=true;for(const i of del)mask[i]=0;}
  }
 }
 return mask;
}

function distanceMap(mask,w,h){
 const d=new Float32Array(mask.length),INF=100000;
 for(let i=0;i<d.length;i++)d[i]=mask[i]?INF:0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!mask[i])continue;
  let v=d[i];if(x>0)v=Math.min(v,d[i-1]+1);
  if(y>0){v=Math.min(v,d[i-w]+1);if(x>0)v=Math.min(v,d[i-w-1]+1.414);if(x<w-1)v=Math.min(v,d[i-w+1]+1.414);}
  d[i]=v;
 }
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
  const i=y*w+x;if(!mask[i])continue;
  let v=d[i];if(x<w-1)v=Math.min(v,d[i+1]+1);
  if(y<h-1){v=Math.min(v,d[i+w]+1);if(x>0)v=Math.min(v,d[i+w-1]+1.414);if(x<w-1)v=Math.min(v,d[i+w+1]+1.414);}
  d[i]=v;
 }
 return d;
}
const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function traceSkeleton(m,w,h){
 const ids=[],nei=new Map();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!m[i])continue;
  ids.push(i);
  const arr=[];
  for(const [dx,dy] of dirs){
    const nx=x+dx,ny=y+dy;
    if(nx<0||ny<0||nx>=w||ny>=h||!m[ny*w+nx])continue;
    // Avoid redundant diagonal links where the skeleton already has an
    // orthogonal connection. Otherwise one curve produces dozens of
    // fake junctions instead of a continuous centerline.
    if(dx&&dy&&(m[y*w+nx]||m[ny*w+x]))continue;
    arr.push(ny*w+nx);
  }
  nei.set(i,arr);
 }
 const seen=new Set(),out=[];
 const edge=(a,b)=>a<b?`${a}-${b}`:`${b}-${a}`;
 const walk=(start,next)=>{
   const p=[start],guard=ids.length+1;
   let prev=start,cur=next,n=0;
   seen.add(edge(prev,cur));
   while(n++<guard){
     p.push(cur);
     if(cur===start)break;
     const ns=nei.get(cur)||[];
     const avail=ns.filter(j=>j!==prev&&!seen.has(edge(cur,j)));
     if(!avail.length)break;
     // Keep continuity at junctions but stop to avoid spur mixing
     if(ns.length!==2)break;
     const following=avail[0];seen.add(edge(cur,following));prev=cur;cur=following;
   }
   return p;
 };
 for(const id of ids)if((nei.get(id)||[]).length!==2){
  const ns=nei.get(id);
  if(!ns.length)out.push([id]);
  for(const n of ns)if(!seen.has(edge(id,n)))out.push(walk(id,n));
 }
 for(const id of ids)for(const n of nei.get(id)||[])if(!seen.has(edge(id,n)))out.push(walk(id,n));
 return out.filter(p=>p.length).map(p=>p.map(i=>[i%w,Math.floor(i/w),i]));
}
function segDist(p,a,b){
 const vx=b[0]-a[0],vy=b[1]-a[1],len=vx*vx+vy*vy;
 if(len===0)return Math.hypot(p[0]-a[0],p[1]-a[1]);
 const t=clamp(((p[0]-a[0])*vx+(p[1]-a[1])*vy)/len,0,1);
 return Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);
}
function rdp(points,eps){
 if(points.length<=2||eps<=0)return points;
 const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
 const stack=[[0,points.length-1]];
 while(stack.length){
  const [a,b]=stack.pop();let best=0,bi=-1;
  for(let i=a+1;i<b;i++){const d=segDist(points[i],points[a],points[b]);if(d>best){best=d;bi=i;}}
  if(best>eps){keep[bi]=1;stack.push([a,bi],[bi,b]);}
 }
 return points.filter((_,i)=>keep[i]);
}
function rasterMaskToGlyph(originalMask,w,h,g,opt){
 let sxMin=w,syMin=h,sxMax=-1,syMax=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(originalMask[y*w+x]){sxMin=Math.min(sxMin,x);syMin=Math.min(syMin,y);sxMax=Math.max(sxMax,x);syMax=Math.max(syMax,y);}
 if(sxMax<0)return null;
 const skel=skeletonize(originalMask,w,h);
 // Very small dots can vanish entirely during thinning. Restore one
 // centroid pixel so that punctuation is not silently discarded.
 if(!skel.some(v=>v)) {
   const mx=Math.round((sxMin+sxMax)/2),my=Math.round((syMin+syMax)/2);
   skel[my*w+mx]=1;
 }
 const dist=distanceMap(originalMask,w,h),traces=traceSkeleton(skel,w,h);
 const sxMm=g.wMm/w,syMm=g.hMm/h;
 const widthMm=Math.max(0.05,(sxMax-sxMin+1)*sxMm),heightMm=Math.max(0.05,(syMax-syMin+1)*syMm),topMm=g.topMm+syMin*syMm;
 const paths=[];
 for(const path of traces){
  const px=rdp(path,opt.simplify);
  if(!px.length)continue;
  const radii=path.map(q=>dist[q[2]]).filter(d=>d>0&&d<200);
  const rad=median(radii)||1;
  const pen=clamp((2*rad-0.8)*Math.min(sxMm,syMm),0.06,2.8);
  paths.push({widthMm:+pen.toFixed(4),pts:px.map(([x,y])=>[+((x-sxMin+.5)*sxMm).toFixed(4),+((y-syMin+.5)*syMm).toFixed(4)])});
 }
 if(!paths.length)return null;
 return {widthMm:+widthMm.toFixed(4),heightMm:+heightMm.toFixed(4),topMm:+topMm.toFixed(4),off:g.off===true,source:'raster-skeleton',paths};
}
async function vectorize(raw,options,onProgress=()=>{}){
 const mode=validateInput(raw),opt={...optsDefaults,...options};
 if(mode==='vector')return structuredClone(raw);
 const src=mode==='raster'?raw.glyphs:raw.samples;
 const pairs=Object.entries(src).flatMap(([ch,copies])=>copies.map((copy,i)=>({ch,copy,i})).filter(z=>mode==='raster'?!!z.copy:z.copy.some(s=>s.points&&s.points.length)));
 const out={app:APP,version:VERSION,units:'mm',coordinates:'local-mm',created:Date.now(),source:mode==='raster'?'handwrite-pdf/v1':'surface-schriftstudio/v1',profileName:'Meine Handschrift',glyphs:{}};
 if(!pairs.length)throw Error('Keine ausgefüllten Schriftproben gefunden.');
 const total=pairs.length;
 for(let k=0;k<pairs.length;k++){
  const {ch,copy}=pairs[k];
  let glyph;
  if(mode==='strokes')glyph=vectorizeOriginal(copy);
  else{
   const m=await pngToMask(copy.png,opt.maxside,opt.threshold);
   glyph=rasterMaskToGlyph(m.mask,m.w,m.h,copy,opt);
  }
  if(glyph){if(!out.glyphs[ch])out.glyphs[ch]=[];out.glyphs[ch].push(glyph);}
  if(k%3===0||k===total-1){onProgress((k+1)/total,`Vektorisiere ${ch} · ${k+1} / ${total}`);await tick();}
 }
 if(!Object.keys(out.glyphs).length)throw Error('Keine Buchstabenstriche erkannt. Probiere die Erkennungsschwelle zu erhöhen.');
 return out;
}

function metrics(profile){
 const keys='acemnorsuvwxz', gs=[...keys].flatMap(ch=>profile.glyphs[ch]||[]).filter(g=>!g.off);
 const all=Object.values(profile.glyphs).flat().filter(g=>!g.off);
 const use=gs.length?gs:all;
 const xh=median(use.map(g=>g.heightMm))||3.5;
 const base=median(use.map(g=>g.topMm+g.heightMm))||13.5;
 const adv=median(use.map(g=>g.widthMm))||2.3;
 return {xh,base,adv};
}
function rng(seed){let x=(seed>>>0)||1;return ()=>{x+=0x6d2b79f5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function normalizedSettings(opt){
 const n=(key,d)=>Number.isFinite(+opt[key])?+opt[key]:d;
 return {textSize:n('textSize',4.2),strokeScale:n('strokeScale',1),xShift:n('xShift',0),yShift:n('yShift',0),jitter:n('jitter',.35),rotation:n('rotation',1.5),letterSpace:n('letterSpace',.5),sizeJitter:n('sizeJitter',3),seed:n('seed',23)};
}
// Lay out text in *world mm*. Only geometry is scaled, not the stroke width.
function layoutText(profile,content,opt={}){
 const o=normalizedSettings(opt),r=rng(o.seed),m=metrics(profile),scale=o.textSize/Math.max(.1,m.xh);
 const pageW=190,pageH=114,margin=9,ops=[],unknown=new Set();
 const step=Math.max(8,o.textSize*2.65);let baseline=15.5,x=margin;
 const text=String(content).slice(0,9000);
 const used={};
 for(const ch of text){
  if(ch==='\r')continue;
  if(ch==='\n'){baseline+=step;x=margin;if(baseline>pageH-5)break;continue;}
  if(ch===' '){x+=Math.max(1.1,m.adv*scale*.8);continue;}
  const candidates=(profile.glyphs[ch]||[]).filter(g=>!g.off&&g.paths&&g.paths.length);
  if(!candidates.length){
    unknown.add(ch);
    const w=Math.max(1.2,m.adv*scale);
    if(x+w>pageW-margin){baseline+=step;x=margin;}
    if(baseline>pageH-4)break;
    ops.push({fallback:ch,x,y:baseline});x+=w+o.letterSpace;continue;
  }
  const i=(used[ch]||0)%candidates.length;used[ch]=i+1;
  const g=candidates[(i+Math.floor(r()*candidates.length))%candidates.length];
  const letterScale=scale*(1+(r()*2-1)*o.sizeJitter/100);
  const aw=Math.max(.2,g.widthMm*letterScale),height=Math.max(.2,g.heightMm*letterScale);
  if(x+aw>pageW-margin){baseline+=step;x=margin;}
  if(baseline>pageH-4)break;
  const dx=(r()*2-1)*o.jitter,dy=(r()*2-1)*o.jitter;
  const xx=x+o.xShift+dx,yy=baseline+o.yShift+(g.topMm-m.base)*letterScale+dy;
  ops.push({g,x:xx,y:yy,scale:letterScale,angle:(r()*2-1)*o.rotation*Math.PI/180,strokeScale:o.strokeScale});
  x+=aw+o.letterSpace+Math.max(.12,o.textSize*.07);
 }
 return {ops,pageW,pageH,unknown:[...unknown],settings:o};
}
function worldPoints(g,p,x,y,scale,angle){
 const cx=g.widthMm*scale/2,cy=g.heightMm*scale/2,ca=Math.cos(angle),sa=Math.sin(angle);
 return p.pts.map(q=>{
   const xx=q[0]*scale-cx,yy=q[1]*scale-cy;
   return [x+cx+xx*ca-yy*sa,y+cy+xx*sa+yy*ca];
 });
}
function drawVectorGlyph(ctx,g,x,y,scale=1,strokeScale=1,angle=0,ink='#263252'){
 ctx.save();ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineJoin='round';ctx.lineCap='round';
 for(const p of g.paths){
  const pts=worldPoints(g,p,x,y,scale,angle);
  if(!pts.length)continue;
  ctx.lineWidth=Math.max(.04,p.widthMm*strokeScale); // never multiply by `scale`
  if(pts.length===1){ctx.beginPath();ctx.arc(pts[0][0],pts[0][1],ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
  else{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.stroke();}
 }
 ctx.restore();
}
function drawPage(canvas,profile,text,settings){
 const result=layoutText(profile,text,settings),s=canvas.width/result.pageW;
 canvas.height=Math.round(result.pageH*s);
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.setTransform(s,0,0,s,0,0);
 ctx.strokeStyle='#f0f0f9';ctx.lineWidth=.1;
 for(let yy=5;yy<result.pageH;yy+=5){ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(result.pageW,yy);ctx.stroke();}
 for(const op of result.ops){
  if(op.fallback){ctx.fillStyle='#b6bbca';ctx.font='3mm sans-serif';ctx.fillText(op.fallback,op.x,op.y);continue;}
  drawVectorGlyph(ctx,op.g,op.x,op.y,op.scale,op.strokeScale,op.angle);
 }
 return result;
}
function pathSvg(g,p,x,y,scale,angle,strokeScale){
 const pts=worldPoints(g,p,x,y,scale,angle);
 if(!pts.length)return '';
 const sw=fmt(Math.max(.04,p.widthMm*strokeScale));
 if(pts.length===1)return `<circle cx="${fmt(pts[0][0])}" cy="${fmt(pts[0][1])}" r="${fmt(p.widthMm*strokeScale/2)}" fill="#263252"/>`;
 const d=pts.map((q,i)=>(i?'L':'M')+fmt(q[0])+','+fmt(q[1])).join(' ');
 return `<path d="${d}" fill="none" stroke="#263252" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}
function svgFromText(profile,text,settings){
 const result=layoutText(profile,text,settings);
 const body=result.ops.map(op=>op.fallback?`<text x="${fmt(op.x)}" y="${fmt(op.y)}" fill="#a1a7b5" font-size="3">${svgEsc(op.fallback)}</text>`:op.g.paths.map(p=>pathSvg(op.g,p,op.x,op.y,op.scale,op.angle,op.strokeScale)).join('\n')).join('\n');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="190mm" height="114mm" viewBox="0 0 190 114"><rect width="190" height="114" fill="white"/>${body}</svg>`;
}
function svgAtlas(profile){
 const keys=Object.keys(profile.glyphs).sort((a,b)=>a.localeCompare(b,'de'));
 const rowH=23,W=195,H=10+keys.length*rowH;
 let body='<rect width="100%" height="100%" fill="white"/>';
 keys.forEach((ch,i)=>{
  const y=7+i*rowH;
  body+=`<text x="3" y="${fmt(y+8)}" fill="#444" font-size="5">${svgEsc(ch)}</text>`;
  for(let j=0;j<4;j++){
   const g=profile.glyphs[ch][j]; if(!g)continue;
   const f=Math.min(1.3,27/Math.max(.2,g.widthMm),16/Math.max(.2,g.heightMm));
   const x=19+j*43+(38-g.widthMm*f)/2;
   body+=g.paths.map(p=>pathSvg(g,p,x,y+1,f,0,1)).join('');
  }
  body+=`<path d="M1 ${fmt(y+rowH-1)}H194" fill="none" stroke="#e1e1ee" stroke-width=".15"/>`;
 });
 return `<svg xmlns="http://www.w3.org/2000/svg" width="195mm" height="${H}mm" viewBox="0 0 195 ${H}">${body}</svg>`;
}
function count(profile){
 const copies=Object.values(profile.glyphs).flat();
 return {chars:Object.keys(profile.glyphs).length,copies:copies.length,paths:copies.reduce((n,g)=>n+g.paths.length,0),points:copies.reduce((n,g)=>n+g.paths.reduce((s,p)=>s+p.pts.length,0),0)};
}
const engine={APP,VERSION,validateInput,vectorize,vectorizeOriginal,rasterMaskToGlyph,skeletonize,traceSkeleton,rdp,layoutText,drawPage,drawVectorGlyph,svgFromText,svgAtlas,count,metrics,normalizedSettings};
root.VectorEngine=engine;
if(typeof module==='object'&&module.exports)module.exports=engine;
})(typeof window!=='undefined'?window:globalThis);

export const VectorEngine=globalThis.VectorEngine;
