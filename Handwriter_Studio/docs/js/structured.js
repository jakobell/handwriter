// Small, dependency-free Markdown and DOCX readers. DOCX supports body paragraphs and tables.
import {textToBlocks} from './textin.js';
const cells = line => line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
export function markdownToBlocks(text) {
  const lines=text.replace(/\r\n?/g,'\n').split('\n'), out=[]; let pending=[];
  const flush=()=>{if(pending.length){out.push(...textToBlocks(pending.join('\n')));pending=[];}};
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(l.includes('|')&&i+1<lines.length&&cells(lines[i+1]).every(x=>/^:?-{3,}:?$/.test(x))&&cells(l).length===cells(lines[i+1]).length){
      flush();const rows=[cells(l)]; i++;
      while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim())rows.push(cells(lines[++i]));
      out.push({kind:'table',rows,header:true});
    }else if(/^#{1,6}\s+/.test(l)){flush();out.push({kind:'para',heading:true,lines:[[[l.replace(/^#{1,6}\s+/,''),true]]]});}
    else pending.push(l);
  }
  flush();return out;
}
async function zipEntry(buffer,name){
  const view=new DataView(buffer), bytes=new Uint8Array(buffer), dec=new TextDecoder();
  let end=buffer.byteLength-22;
  while(end>=Math.max(0,buffer.byteLength-65557)&&view.getUint32(end,true)!==0x06054b50)end--;
  if(end<0||view.getUint32(end,true)!==0x06054b50)throw new Error('Invalid DOCX ZIP.');
  let pos=view.getUint32(end+16,true), count=view.getUint16(end+10,true);
  for(let i=0;i<count;i++){
    if(view.getUint32(pos,true)!==0x02014b50)throw new Error('Invalid ZIP directory.');
    const method=view.getUint16(pos+10,true), size=view.getUint32(pos+20,true), raw=view.getUint32(pos+24,true), len=view.getUint16(pos+28,true), ext=view.getUint16(pos+30,true), comment=view.getUint16(pos+32,true), local=view.getUint32(pos+42,true);
    if(dec.decode(bytes.subarray(pos+46,pos+46+len))===name){
      if(raw>20*1024*1024||size>20*1024*1024)throw new Error('DOCX XML too large.');
      const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true), data=bytes.slice(start,start+size);
      if(method===0)return dec.decode(data);
      if(method!==8)throw new Error('Unsupported ZIP compression.');
      const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader=stream.getReader(), chunks=[];let n=0;
      for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>20*1024*1024){await reader.cancel();throw new Error('DOCX XML too large.');}chunks.push(value);}
      return new Blob(chunks).text();
    }pos+=46+len+ext+comment;
  }throw new Error('DOCX document.xml missing.');
}
export async function docxToBlocks(buffer){
  const xml=await zipEntry(buffer,'word/document.xml'), doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('Invalid DOCX XML.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body=doc.getElementsByTagNameNS(ns,'body')[0]; if(!body)throw new Error('DOCX body missing.');
  const txt=node=>Array.from(node.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent).join('');
  const blocks=[];
  for(const child of body.children){
    if(child.localName==='p'){
      const text=txt(child), style=child.getElementsByTagNameNS(ns,'pStyle')[0]?.getAttributeNS(ns,'val')||'', heading=/heading|überschrift/i.test(style);
      if(text.trim())blocks.push({kind:'para',heading,lines:[[[text,heading]]]});
    }else if(child.localName==='tbl'){
      const rows=Array.from(child.children).filter(x=>x.localName==='tr').map(row=>Array.from(row.children).filter(x=>x.localName==='tc').map(cell=>Array.from(cell.children).filter(x=>x.localName==='p').map(txt).join(' ')));
      if(rows.length)blocks.push({kind:'table',rows,header:false});
    }
  }return blocks;
}
