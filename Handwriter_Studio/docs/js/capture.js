
/* Schriftstudio: finger-first handwriting capture, entirely client-side. */
(() => {
  'use strict';

// Render-time, non-destructive normalization. All coordinates are in mm.
const SMALL = 'acemnorsuvwxz';
const CAPS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASC='bdfhklt';
const DESC='gpqy';
const UMLAUT_SMALL='äöü';
const UMLAUT_CAP='ÄÖÜ';
const DIGITS='0123456789';
const SUPERS='¹²³⁰⁴⁵⁶⁷⁸⁹⁺⁻';
const SUBS='₀₁₂₃₄₅₆₇₈₉₊₋';
const medianOf = values => {const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?(s[(s.length-1)>>1]+s[s.length>>1])/2:0;};
const median = medianOf;

const metricsOf=g=>({top:g.topMm,bottom:g.topMm+g.hMm,height:g.hMm,center:g.topMm+g.hMm/2});
function classify(ch){
 if(SMALL.includes(ch))return 'x';
 if(UMLAUT_SMALL.includes(ch))return 'x-dia';
 if(CAPS.includes(ch)||ch==='ẞ')return 'cap';
 if(UMLAUT_CAP.includes(ch))return 'cap-dia';
 if(ASC.includes(ch)||ch==='ß')return 'asc';
 if(DESC.includes(ch))return 'desc';
 if(ch==='i')return 'i';
 if(ch==='j')return 'j';
 if(DIGITS.includes(ch))return 'digit';
 if(SUPERS.includes(ch)||'\'"*‘’“”°'.includes(ch))return 'sup';
 if(SUBS.includes(ch))return 'sub';
 return 'other';
}

function deriveStats(active){
 const pick=(chars)=>active.filter(({ch})=>chars.includes(ch)).map(({g})=>metricsOf(g));
 const byClass=(name)=>active.filter(({ch})=>classify(ch)===name).map(({g})=>metricsOf(g));
 const xMetrics=pick(SMALL);
 const allMetrics=active.map(({g})=>metricsOf(g));
 const xh=medianOf(xMetrics.map(m=>m.height)) || medianOf(allMetrics.map(m=>m.height)) || 2.5;
 const base=xMetrics.length?medianOf(xMetrics.map(m=>m.bottom)):allMetrics.length?medianOf(allMetrics.map(m=>m.bottom)):0;
 const capH=medianOf(byClass('cap').map(m=>m.height)) || xh*1.85;
 const ascH=medianOf(byClass('asc').map(m=>m.height)) || xh*1.55;
 const digitH=medianOf(byClass('digit').map(m=>m.height)) || Math.max(xh*1.45,capH*0.92);
 const xDiaH=medianOf(byClass('x-dia').map(m=>m.height)) || xh*1.22;
 const iH=medianOf(byClass('i').map(m=>m.height)) || xh*1.28;
 const jH=medianOf(byClass('j').map(m=>m.height)) || xh*1.62;
 const capDiaH=medianOf(byClass('cap-dia').map(m=>m.height)) || capH*1.12;
 const descBottoms=byClass('desc').map(m=>m.bottom);
 const descDepthMeasured=descBottoms.length?medianOf(descBottoms)-base:NaN;
 const descDepth=Math.min(xh*.85,Math.max(xh*0.22, Number.isFinite(descDepthMeasured)?descDepthMeasured:xh*0.35));
 const descH=medianOf(byClass('desc').map(m=>m.height)) || (xh + descDepth);
 const supH=medianOf(byClass('sup').map(m=>m.height)) || xh*0.75;
 const subH=medianOf(byClass('sub').map(m=>m.height)) || xh*0.72;
 return {base,xh,capH,ascH,digitH,xDiaH,iH,jH,capDiaH,descDepth,descH,supH,subH};
}

function targetHeight(ch,stats){
 switch(classify(ch)){
  case 'x': return stats.xh;
  case 'x-dia': return stats.xDiaH;
  case 'cap': return stats.capH;
  case 'cap-dia': return stats.capDiaH;
  case 'asc': return stats.ascH;
  case 'desc': return stats.descH;
  case 'i': return stats.iH;
  case 'j': return stats.jH;
  case 'digit': return stats.digitH;
  case 'sup': return stats.supH;
  case 'sub': return stats.subH;
  default: return 0;
 }
}

function anchorFraction(ch,stats){
 switch(classify(ch)){
  case 'x':
  case 'x-dia':
  case 'cap':
  case 'cap-dia':
  case 'asc':
  case 'digit': return 1;
  case 'desc': return (stats.descH-stats.descDepth)/stats.descH;
  case 'j': return (stats.jH-stats.descDepth)/stats.jH;
  case 'i': return 1;
  case 'sup': return 0;
  case 'sub': return 1;
  default: return .5;
 }
}

function normalizedTop(ch,h,stats,byChar){
  if(classify(ch)==='x'||classify(ch)==='x-dia'||classify(ch)==='cap'||classify(ch)==='cap-dia'||classify(ch)==='asc'||classify(ch)==='i'||classify(ch)==='digit'||ch==='ß'||/[äöüÄÖÜẞ]/u.test(ch)) return stats.base-h;
  if(classify(ch)==='desc'||classify(ch)==='j') return stats.base+stats.descDepth-h;
  if('.,:;!?%#@&/€£¥¢§'.includes(ch)) return stats.base-h+({',':h*.45,';':h*.2}[ch]||0);
  if('()[]{}'.includes(ch)) return stats.base+stats.xh*.2-h;
  if('_'.includes(ch)) return stats.base+stats.xh*.15-h;
  if('-=+<>−–—×÷±≤≥≠≈→←↑↓↔⇒⇔·•⊕~'.includes(ch)) return stats.base-stats.xh*.5-h/2;
  if(classify(ch)==='sup') return stats.base-stats.capH;
  if('„‚'.includes(ch)) return stats.base-h*.5;
  if(classify(ch)==='sub') return stats.base+stats.xh*.25-h;
  return medianOf(byChar.get(ch)||[])-h/2;
}

function normalizeGlyphs(glyphs,{position=false,size=false}={}){
 const result=Object.fromEntries(Object.entries(glyphs).map(([ch,gs])=>[ch,gs.map(g=>({...g}))]));
 const active=Object.entries(result).flatMap(([ch,gs])=>gs.filter(g=>!g.off&&g.hMm>0&&g.wMm>0).map(g=>({ch,g})));
 const stats=deriveStats(active);
 const byChar=new Map();
 for(const {ch,g} of active){if(!byChar.has(ch))byChar.set(ch,[]);byChar.get(ch).push(g.topMm+g.hMm/2);}
 for(const [ch,gs] of Object.entries(result)) for(const g of gs){
  if(!(g.hMm>0&&g.wMm>0))continue;
  const currentAnchor=g.topMm+g.hMm*anchorFraction(ch,stats);
  if(size){
    const target=targetHeight(ch,stats);
    if(target>0){const scale=target/g.hMm;g.wMm*=scale;g.hMm=target;if(!position)g.topMm=currentAnchor-g.hMm*anchorFraction(ch,stats);} 
  }
  if(position)g.topMm=normalizedTop(ch,g.hMm,stats,byChar);
 }
 return result;
}

// Shared v3 geometry: millimetres, y down, baseline 0, x origin at left ink edge.
const round4=n=>Math.round(n*10000)/10000;
function pathData(pts){return pts.map(([x,y],i)=>`${i?'L':'M'}${round4(x)} ${round4(y)}`).join(' ')+(pts.length===1?' L'+round4(pts[0][0])+' '+round4(pts[0][1]):'');}
function svgPath(p){return `<path d="${pathData(p.pts)}" fill="none" stroke="currentColor" stroke-width="${round4(p.widthMm)}" stroke-linecap="round" stroke-linejoin="round"/>`;}
// Sample the exact midpoint-quadratic curves shown during capture; no bitmap involved.
function captureGlyph(strokes,slot){
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
function normalizedRecords(records){
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
function makeV3(records,extra={}){return {app:'handwrite-vector',version:3,units:'mm',coordinates:'local-mm',origin:'baseline',normalized:true,variantTarget:5,created:Date.now(),...extra,glyphs:normalizedRecords(records)};}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function profileSvg(profile){
 const rows=Object.entries(profile.glyphs),w=130,h=12+rows.length*12;
 let body=`<rect width="${w}" height="${h}" fill="white"/><text x="4" y="7" font-size="4" font-family="sans-serif">Handschriftprofil · V3 · 5 Varianten</text>`;
 rows.forEach(([ch,gs],i)=>{const y=17+i*12;body+=`<text x="4" y="${y}" font-size="4" font-family="sans-serif">${esc(ch)}</text>`;gs.forEach((g,j)=>{const x=16+(g.slot??j)*22;body+=`<path d="M${x-2} ${y}h18" stroke="#ddd" stroke-width=".1"/><g transform="translate(${x} ${y+g.topMm})" color="#24334d">${g.paths.map(svgPath).join('')}</g>`;});});
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><metadata id="handwrite-vector-profile">${esc(JSON.stringify(profile))}</metadata>${body}</svg>`;
}

  const GROUPS = [
    { id: 'lower', name: 'Kleinbuchstaben', label: 'Kleinbuchstabe', chars: [...'abcdefghijklmnopqrstuvwxyzäöüß'] },
    { id: 'upper', name: 'Großbuchstaben', label: 'Großbuchstabe', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ'] },
    { id: 'digits', name: 'Zahlen', label: 'Ziffer', chars: [...'0123456789'] },
    { id: 'punct', name: 'Satz- & Sonderzeichen', label: 'Sonderzeichen', chars: [...'.,;:!?\'"„“()[]{}-–/\\&@#%‰+=*$€£<>_|~^°…§'] },
    { id: 'math', name: 'Mathematik & Symbole', label: 'Mathematisches Zeichen', chars: [...'×÷±≤≥≠≈∞√∑∫→←↑↓↔²³µπΩΔαβγ'] }
  ];
  const ITEMS = GROUPS.flatMap((g) => g.chars.map((ch) => ({ char: ch, group: g })));
  const LETTER_NAMES = {
    ' ': 'Leerzeichen', '.': 'Punkt', ',': 'Komma', ';': 'Semikolon', ':': 'Doppelpunkt', '!': 'Ausrufezeichen', '?': 'Fragezeichen',
    '"': 'Anführungszeichen', "'": 'Apostroph', '„': 'Anführungszeichen unten', '“': 'Anführungszeichen oben',
    '(': 'Klammer auf', ')': 'Klammer zu', '[': 'Eckige Klammer auf', ']': 'Eckige Klammer zu',
    '{': 'Geschweifte Klammer auf', '}': 'Geschweifte Klammer zu', '-': 'Bindestrich', '–': 'Gedankenstrich',
    '/': 'Schrägstrich', '\\': 'Umgekehrter Schrägstrich', '&': 'Und', '@': 'At-Zeichen', '#': 'Raute',
    '%': 'Prozent', '‰': 'Promille', '+': 'Plus', '=': 'Gleich', '*': 'Stern', '$': 'Dollar', '€': 'Euro',
    '£': 'Pfund', '<': 'Kleiner als', '>': 'Größer als', '_': 'Unterstrich', '|': 'Senkrechter Strich',
    '~': 'Tilde', '^': 'Zirkumflex', '°': 'Grad', '…': 'Auslassungspunkte', '§': 'Paragraph',
    '×': 'Mal', '÷': 'Geteilt', '±': 'Plusminus', '≤': 'Kleiner gleich', '≥': 'Größer gleich',
    '≠': 'Ungleich', '≈': 'Ungefähr gleich', '∞': 'Unendlich', '√': 'Wurzel', '∑': 'Summe', '∫': 'Integral',
    '→': 'Pfeil nach rechts', '←': 'Pfeil nach links', '↑': 'Pfeil nach oben', '↓': 'Pfeil nach unten',
    '↔': 'Pfeil in beide Richtungen', '²': 'Hoch zwei', '³': 'Hoch drei', 'µ': 'Mikro',
    'π': 'Pi', 'Ω': 'Omega', 'Δ': 'Delta', 'α': 'Alpha', 'β': 'Beta', 'γ': 'Gamma',
    '0': 'Null', '1': 'Eins', 'I': 'Großes i', 'l': 'Kleines L', 'O': 'Großes O'
  };
  const el = (id) => document.getElementById(id);
  const pads = [...document.querySelectorAll('.writing-pad')];
  const cards = [...document.querySelectorAll('.pad-card')];
  const PALETTE = '#24334d';
  const DB_NAME = 'finger-schriftstudio-v1';
  const DB_STORE = 'projects';
  const KEY = 'current';
  const STORAGE_FALLBACK = 'finger-schriftstudio-v1-autosave';
  const PPM = 12, G_W = 18 * PPM, G_H = 19 * PPM;
  const state = { index: 0, samples: {}, width: 9, lastSlot: 0 };
  let drawing = null;
  let toastHandle = null;
  let saveInFlight = Promise.resolve();

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const current = () => ITEMS[state.index];
  const five = (ch) => state.samples[ch] || [[], [], [], [], []];
  const used = (strokes) => Array.isArray(strokes) && strokes.some((s) => s && s.points && s.points.length);
  const countVariants = (ch) => five(ch).filter(used).length;
  const doneCount = () => ITEMS.filter((it) => countVariants(it.char) === 5).length;
  const strokeCount = () => ITEMS.reduce((n, it) => n + countVariants(it.char), 0);
  function currentSamples() {
    const ch = current().char;
    if (!state.samples[ch]) state.samples[ch] = [[], [], [], [], []];
    return state.samples[ch];
  }
  function showToast(message) {
    const node = el('toast');
    node.textContent = message;
    node.classList.add('visible');
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => node.classList.remove('visible'), 3400);
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB nicht verfügbar'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onerror = () => reject(req.error || new Error('Speicherfehler'));
      req.onblocked = () => reject(new Error('Speicher blockiert'));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function idbCall(mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = action(tx.objectStore(DB_STORE));
      tx.oncomplete = () => { const result = request && request.result; db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }
  let revision = 0, savedRevision = 0, storageFailed = false;
  function saveStatus(message, error=false) {
    const node=el('saveStatus'); node.textContent=message; node.dataset.error=String(error); const inline=el('saveInline');if(inline){inline.textContent=message;inline.dataset.error=String(error);}
  }
  async function loadLocal() {
    let a=null,b=null;
    try { a=JSON.parse(localStorage.getItem(STORAGE_FALLBACK)||'null'); } catch {}
    try { b=await idbCall('readonly', store=>store.get(KEY)); } catch {}
    return [b,a].filter(x=>x?.samples).sort((x,y)=>(y.revision||0)-(x.revision||0))[0]||null;
  }
  function persist() {
    revision=Math.max(Date.now(),revision+1);
    const snapshot={index:state.index,width:state.width,samples:structuredClone(state.samples),revision};
    let local=false;
    try { localStorage.setItem(STORAGE_FALLBACK,JSON.stringify(snapshot)); local=true; } catch {}
    if(local){savedRevision=revision;storageFailed=false;saveStatus('Lokal gespeichert');}
    else saveStatus('Wird gespeichert …');
    saveInFlight=saveInFlight.catch(()=>{}).then(async()=>{
      let database=false;
      try{await idbCall('readwrite',store=>store.put(snapshot,KEY));database=true;}catch{}
      if(database||local)savedRevision=Math.max(savedRevision,snapshot.revision);
      if(snapshot.revision===revision){storageFailed=!(database||local);saveStatus(storageFailed?'Nicht gespeichert – JSON sichern!':'Lokal gespeichert',storageFailed);if(storageFailed)showToast('Speicher nicht verfügbar. Bitte JSON-Sicherung herunterladen.');}
      return database||local;
    });
    return saveInFlight;
  }

  function drawCurve(ctx, pts, width, height, thickness, polyline=false) {
    if (!pts || pts.length === 0) return;
    const x = (p) => p[0] * width;
    const y = (p) => p[1] * height;
    ctx.save();
    ctx.lineWidth = Math.max(1, (thickness || 9) / 1000 * width);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE;
    ctx.fillStyle = PALETTE;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(x(pts[0]), y(pts[0]), ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    } else if (polyline) {
      ctx.beginPath();ctx.moveTo(x(pts[0]),y(pts[0]));for(const p of pts.slice(1))ctx.lineTo(x(p),y(p));ctx.stroke();
    } else if (pts.length === 2) {
      ctx.beginPath(); ctx.moveTo(x(pts[0]), y(pts[0])); ctx.lineTo(x(pts[1]), y(pts[1])); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x(pts[0]), y(pts[0]));
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(x(pts[i]), y(pts[i]), (x(pts[i]) + x(pts[i + 1])) / 2, (y(pts[i]) + y(pts[i + 1])) / 2);
      }
      const last = pts[pts.length - 1]; ctx.lineTo(x(last), y(last)); ctx.stroke();
    }
    ctx.restore();
  }
  function drawStrokes(ctx, arr, w, h) {
    for (const s of arr || []) drawCurve(ctx, s.points, w, h, s.thickness,s.polyline);
  }
  function paintPad(slot) {
    const c = pads[slot];
    const r = c.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (!w || !h) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const pxW = Math.round(w * dpr), pxH = Math.round(h * dpr);
    if (c.width !== pxW || c.height !== pxH) { c.width = pxW; c.height = pxH; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#e7e8f2'; ctx.lineWidth = 1; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(13, h * 0.72); ctx.lineTo(w - 13, h * 0.72); ctx.stroke(); ctx.setLineDash([]);
    drawStrokes(ctx, currentSamples()[slot], w, h);
  }
  function redraw() { pads.forEach((_, i) => paintPad(i)); }
  function updateProgress() {
    const completed = doneCount();
    const percentage = 100 * strokeCount() / (ITEMS.length * 5);
    const count = countVariants(current().char);
    el('completedCount').textContent = completed;
    el('totalCount').textContent = `/ ${ITEMS.length} Zeichen`;
    el('progressFill').style.width = `${percentage}%`;
    el('progressTrack').setAttribute('aria-valuenow', String(Math.round(percentage)));
    el('progressPercent').textContent = `${Math.round(percentage)} % · ${strokeCount()} / ${ITEMS.length*5} Varianten`;
    el('variantCountTop').textContent = `${count} / 5 Varianten für dieses Zeichen`;
    el('completionPill').textContent = `${count} / 5`;
    cards.forEach((card, i) => card.classList.toggle('filled', used(currentSamples()[i])));
  }
  function makeOptions(select, options) {
    select.replaceChildren(...options.map(({ value, label }) => {
      const o = document.createElement('option'); o.value = value; o.textContent = label; return o;
    }));
  }
  function setIndex(next, save = true) {
    if(drawing){drawing=null;}
    state.index = clamp(next, 0, ITEMS.length - 1);
    const it = current();
    el('characterPosition').textContent = `${state.index + 1} / ${ITEMS.length}`;
    el('charCategory').textContent = it.group.label;
    el('characterSymbol').textContent = it.char;
    el('characterSymbol').classList.toggle('symbol-small', '„“[…]⇔→←↑↓∫∑'.includes(it.char));
    el('characterName').textContent = LETTER_NAMES[it.char] || (it.group.id === 'upper' ? `Großes ${it.char}` : it.group.id === 'lower' ? `Kleines ${it.char}` : it.group.id === 'digits' ? `Ziffer ${it.char}` : `Zeichen ${it.char}`);
    el('prevChar').disabled = state.index === 0;
    el('nextChar').disabled = state.index === ITEMS.length - 1;
    el('categorySelect').value = it.group.id;
    makeOptions(el('characterSelect'), ITEMS.filter((x) => x.group.id === it.group.id).map((x) => ({ value: x.char, label: `${x.char} — ${LETTER_NAMES[x.char] || x.char}` })));
    el('characterSelect').value = it.char;
    updateProgress(); redraw();
    if (save) persist();
  }
  function nextOpen() {
    for (let n = 1; n <= ITEMS.length; n++) {
      const ix = (state.index + n) % ITEMS.length;
      if (countVariants(ITEMS[ix].char)<5) { setIndex(ix); return; }
    }
    showToast('Alle Zeichen haben bereits alle 5 Varianten.');
  }
  function position(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)];
  }
  function onPointerDown(e) {
    if (drawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const samples = currentSamples()[slot];
    if (samples.length > 200) { showToast('Maximal 200 Striche pro Feld.'); return; }
    state.lastSlot = slot;
    drawing = { pointerId: e.pointerId, slot, char: current().char, stroke: { thickness: state.width, points: [position(e, e.currentTarget)] } };
    samples.push(drawing.stroke);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    paintPad(slot); updateProgress();
  }
  function onPointerMove(e) {
    if (!drawing || drawing.pointerId !== e.pointerId || drawing.slot !== Number(e.currentTarget.dataset.slot)) return;
    const events = e.getCoalescedEvents?.() || []; if(!events.length)events.push(e);
    for (const event of events) {
      const point = position(event, e.currentTarget), pts = drawing.stroke.points;
      if(pts.length>=10000)break;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.001) pts.push(point);
      if (pts.length > 10000) break;
    }
    e.preventDefault(); paintPad(drawing.slot);
  }
  function onPointerEnd(e) {
    if (!drawing || drawing.pointerId !== e.pointerId || drawing.slot !== Number(e.currentTarget.dataset.slot)) return;
    if(e.type==='pointerup')onPointerMove(e);
    try { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* Capture may already be gone */ }
    drawing = null;
    updateProgress(); persist();
  }
  function eraseSlot(slot) {
    currentSamples()[slot] = [];
    updateProgress(); paintPad(slot); persist();
  }
  function undo() {
    const slot = state.lastSlot;
    const arr = currentSamples()[slot];
    if (!arr.length) { showToast('In diesem Feld gibt es keinen Strich zum Zurücknehmen.'); return; }
    arr.pop(); paintPad(slot); updateProgress(); persist();
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function buildProfile(backup=false) {
    const glyphs={};
    for(const it of ITEMS){const gs=five(it.char).map((strokes,slot)=>captureGlyph(strokes,slot)).filter(Boolean);if(gs.length)glyphs[it.char]=gs;}
    if(!Object.keys(glyphs).length)throw Error('Zeichne zuerst mindestens eine Variante.');
    const extra=backup?{capture:{currentIndex:state.index,strokeWidth:state.width,samples:Object.fromEntries(Object.entries(state.samples).map(([ch,gs])=>[ch,gs.map(strokes=>strokes.map(s=>({...s,d:pathData(s.points.map(([x,y])=>[x*18,y*19]))})))]))}}:{};
    return makeV3(glyphs,extra);
  }
  function exportCompatible(){try{const p=buildProfile();download(new Blob([JSON.stringify(p)],{type:'application/json'}),'Mein_Handschriftprofil_V3.json');showToast('Normalisiertes SVG-Vektorprofil exportiert. Direkt im Handwriter laden.');}catch(e){showToast(e.message);}}
  function exportProject(){try{const p=buildProfile(true);download(new Blob([JSON.stringify(p)],{type:'application/json'}),'Schriftstudio_Projekt_V3.json');showToast('Vektorprojekt mit Originalstrichen gesichert.');}catch(e){showToast(e.message);}}
  function validateProject(value) {
    if (!value || value.app !== 'surface-schriftstudio' || value.version !== 1 || typeof value.samples !== 'object' || !value.samples || Array.isArray(value.samples)) throw new Error('Ungültige Projektdatei.');
    const known = new Set(ITEMS.map((it) => it.char));
    const result = {};
    for (const [ch, fourVariants] of Object.entries(value.samples)) {
      if (!known.has(ch) || !Array.isArray(fourVariants) || ![4,5].includes(fourVariants.length)) throw new Error('Projekt enthält unbekannte Zeichen oder Felder.');
      result[ch] = Array.from({length:5},(_,i)=>fourVariants[i]||[]).map((strokes) => {
        if (!Array.isArray(strokes) || strokes.length > 200) throw new Error('Zu viele Striche in einer Variante.');
        return strokes.map((s) => {
          if (!s || !Number.isFinite(s.thickness) || s.thickness < 3 || s.thickness > 30 || !Array.isArray(s.points) || s.points.length > 10000 || !s.points.length || !s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('Ungültige Strichdaten.');
          return { thickness: s.thickness, points: s.points, ...(s.polyline?{polyline:true}:{}) };
        });
      });
    }
    return result;
  }
  async function loadProject(file) {
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('Die Projektdatei ist zu groß.');
    const data = JSON.parse(await file.text());
    let samples;
    if(data.app==='handwrite-vector'&&[2,3].includes(data.version)){
      if(data.capture?.samples){samples=validateProject({app:'surface-schriftstudio',version:1,samples:data.capture.samples});}
      else {
        if(!data.glyphs||typeof data.glyphs!=='object')throw Error('Keine Vektorzeichen vorhanden.');
        const rec=data.version===3&&data.normalized?data.glyphs:normalizedRecords(data.glyphs);
        const all=Object.values(rec).flat();const maxW=Math.max(1,...all.map(g=>g.widthMm)),maxAbove=Math.max(1,...all.map(g=>-g.topMm)),maxBelow=Math.max(1,...all.map(g=>g.topMm+g.heightMm));
        const factor=Math.min(2.5,15/maxW,12/maxAbove,4.6/maxBelow);samples={};
        for(const [ch,gs] of Object.entries(rec)){if(!ITEMS.some(it=>it.char===ch))continue;const slots=[[],[],[],[],[]];gs.slice(0,5).forEach((g,i)=>{if(g.off)return;const n=Number.isInteger(g.slot)&&g.slot>=0&&g.slot<5?g.slot:i;slots[n]=g.paths.map(p=>({thickness:clamp(p.widthMm/.018,3,30),polyline:true,points:p.pts.map(([x,y])=>[clamp((9-g.widthMm*factor/2+x*factor)/18,0,1),clamp(.72+(g.topMm+y)*factor/19,0,1)])}));});samples[ch]=slots;}
        samples=validateProject({app:'surface-schriftstudio',version:1,samples});
      }
    }else samples=validateProject(data);
    if (Object.keys(state.samples).some((ch) => countVariants(ch) > 0) && !window.confirm('Deine bisherigen Zeichnungen durch dieses Projekt ersetzen?')) return;
    state.samples = samples;
    state.width = clamp(Number(data.capture?.strokeWidth??data.strokeWidth) || 9, 5, 15);
    el('strokeWidth').value = state.width;
    updateStrokeLabel();
    setIndex(Number.isInteger(data.capture?.currentIndex??data.currentIndex) ? (data.capture?.currentIndex??data.currentIndex) : 0);
    showToast('Projekt erfolgreich geladen. Du kannst an deinen Zeichnungen weiterarbeiten.');
  }

  function exportPdf(){try{const p=buildProfile();download(new Blob([profileSvg(p)],{type:'image/svg+xml'}),'Mein_Handschriftprofil_V3.svg');showToast('SVG-Übersicht mit eingebettetem Vektorprofil exportiert.');}catch(e){showToast(e.message);}}
  function updateStrokeLabel() {
    const val = state.width;
    el('strokeValue').textContent = val <= 6 ? 'Fein' : val >= 12 ? 'Kräftig' : 'Normal';
  }
  function setup() {
    makeOptions(el('categorySelect'), GROUPS.map((g) => ({ value: g.id, label: `${g.name} (${g.chars.length})` })));
    pads.forEach((pad, slot) => {
      pad.addEventListener('pointerdown', onPointerDown);
      pad.addEventListener('pointermove', onPointerMove);
      pad.addEventListener('pointerup', onPointerEnd);
      pad.addEventListener('pointercancel', onPointerEnd);
      cards[slot].querySelector('.trash-btn').addEventListener('click', () => eraseSlot(slot));
    });
    el('prevChar').addEventListener('click', () => setIndex(state.index - 1));
    el('nextChar').addEventListener('click', () => setIndex(state.index + 1));
    el('nextOpen').addEventListener('click', nextOpen);
    el('undoStroke').addEventListener('click', undo);
    el('categorySelect').addEventListener('change', (e) => {
      const ix = ITEMS.findIndex((it) => it.group.id === e.target.value && countVariants(it.char) < 5);
      setIndex(ix >= 0 ? ix : ITEMS.findIndex((it) => it.group.id === e.target.value));
    });
    el('characterSelect').addEventListener('change', (e) => setIndex(ITEMS.findIndex((it) => it.char === e.target.value)));
    el('strokeWidth').addEventListener('input', (e) => { state.width = Number(e.target.value); updateStrokeLabel(); persist(); });
    el('exportProfile').addEventListener('click', exportProject);
    el('useInWriter').addEventListener('click', async () => {
      const button=el('useInWriter');button.disabled=true;
      try {
        const profile=buildProfile(true);await persist();
        const {importProfile,saveProfile,loadProfile}=await import('./profile.js');
        const existing=await loadProfile();
        if(existing&&!window.confirm('Das aktuell im Handwriter verwendete Profil durch deine Schriftstudio-Zeichnungen ersetzen?'))return;
        const imported=await importProfile(new Blob([JSON.stringify(profile)],{type:'application/json'}));
        await saveProfile(imported);window.location.assign('index.html');
      } catch(e){showToast('Übernahme fehlgeschlagen: '+e.message+'. Bitte JSON exportieren und im Handwriter importieren.');}
      finally{button.disabled=false;}
    });
    el('backupProject').addEventListener('click', exportProject);
    el('restoreProject').addEventListener('click', () => el('projectFile').click());
    el('projectFile').addEventListener('change', async (e) => {
      try { if (e.target.files[0]) await loadProject(e.target.files[0]); }
      catch (err) { showToast('Projekt konnte nicht geladen werden: ' + (err.message || 'Unbekannter Fehler')); }
      e.target.value = '';
    });
    el('resetAll').addEventListener('click', () => {
      const d = el('confirmDialog');
      if (typeof d.showModal === 'function') { d.showModal(); }
      else if (window.confirm('Wirklich alle Zeichen löschen?')) resetAll();
    });
    el('confirmDialog').addEventListener('close', () => { if (el('confirmDialog').returnValue === 'confirm') resetAll(); });
    window.addEventListener('keydown', (e) => {
      if (['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || e.altKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(state.index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(state.index - 1); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });
    new ResizeObserver(redraw).observe(el('padGrid'));
    window.addEventListener('resize', redraw);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&drawing)persist();});
    window.addEventListener('pagehide',()=>{if(drawing)persist();});
    window.addEventListener('beforeunload',e=>{if(storageFailed||savedRevision<revision){e.preventDefault();e.returnValue='';}});
    window.addEventListener('storage',e=>{if(e.key===STORAGE_FALLBACK&&e.newValue){try{if(JSON.parse(e.newValue).revision>revision)showToast('Schriftstudio ist auch in einem anderen Tab geöffnet. Bitte nur einen Tab bearbeiten und diesen neu laden.');}catch{}}});
  }
  async function resetAll() {
    state.samples = {};
    setIndex(0);
    await persist();
    showToast('Alle Zeichnungen wurden auf diesem Gerät gelöscht.');
  }
  async function init() {
    const saved = await loadLocal();
    revision=savedRevision=saved?.revision||0;
    if (saved && saved.samples && typeof saved.samples === 'object') {
      try {
        state.samples = validateProject({ app: 'surface-schriftstudio', version: 1, samples: saved.samples });
        state.width = clamp(Number(saved.width) || 9, 5, 15);
        state.index = Number.isInteger(saved.index) ? saved.index : 0;
      } catch { state.samples = {}; }
    }
    el('strokeWidth').value = state.width; updateStrokeLabel();
    setup();
    setIndex(state.index, false);
    saveStatus(saved?'Fortschritt wiederhergestellt':'Bereit · Autosave aktiv');
    // Test-only readonly hooks, not required for normal use.
    window.schriftstudio = Object.freeze({ get total() { return ITEMS.length; }, get completed() { return doneCount(); }, get variants() { return countVariants(current().char); }, get character() { return current().char; } });
  }
  init().catch((err) => { console.error(err); showToast('Die Anwendung konnte nicht initialisiert werden.'); });
})();

