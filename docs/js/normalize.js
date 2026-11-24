// Render-time, non-destructive normalization. All coordinates are in mm.
export const SMALL = 'acemnorsuvwxz';
const CAPS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASC='bdfhklt';
const DESC='gpqy';
const UMLAUT_SMALL='äöü';
const UMLAUT_CAP='ÄÖÜ';
const DIGITS='0123456789';
const SUPERS='¹²³⁰⁴⁵⁶⁷⁸⁹⁺⁻';
const SUBS='₀₁₂₃₄₅₆₇₈₉₊₋';
const medianOf = values => {const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?(s[(s.length-1)>>1]+s[s.length>>1])/2:0;};
export const median = medianOf;

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

export function normalizeGlyphs(glyphs,{position=false,size=false}={}){
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
