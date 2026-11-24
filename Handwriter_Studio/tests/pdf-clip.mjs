import assert from 'node:assert/strict';
import fs from 'node:fs';
// PDF.js runs its real worker in Node via the fake-worker transport. No canvas is needed for text extraction.
globalThis.DOMMatrix ??= class {};
globalThis.ImageData ??= class {};
globalThis.Path2D ??= class {};
const api = await import('../docs/vendor/pdfjs/pdf.min.mjs');
api.GlobalWorkerOptions.workerSrc = new URL('../docs/vendor/pdfjs/pdf.worker.clipfix.min.mjs', import.meta.url).href;
const stream=(dict,s)=>`<< ${dict} /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
// A full page is reused via two cropped wrappers; only their respective text must survive.
const objects=[
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> /Contents 4 0 R >>',
 stream('', 'q /A Do Q q /B Do Q'),
 stream('/Type /XObject /Subtype /Form /BBox [0 100 200 200] /Resources << /XObject << /Full 7 0 R >> >>','/Full Do'),
 stream('/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /XObject << /Full 7 0 R >> >>','/Full Do'),
 stream('/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /Font << /F 8 0 R >> >>','BT /F 12 Tf 1 0 0 1 20 150 Tm (Upper) Tj 1 0 0 1 20 50 Tm (Lower) Tj ET'),
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
async function extract(data){const d=await api.getDocument({data:new Uint8Array(data),disableFontFace:true,isEvalSupported:false}).promise;try{const pages=[];for(let i=1;i<=d.numPages;i++){const {items}=await (await d.getPage(i)).getTextContent();pages.push(items.filter(x=>x.str?.trim()));}return pages;}finally{await d.destroy();}}
const [page]=await extract(Buffer.from(pdf));assert.deepEqual(page.map(x=>x.str),['Upper','Lower']);console.log('OK: nested clipped forms, no duplicated text');
if(process.argv[2]){const pages=await extract(fs.readFileSync(process.argv[2]));const counts=pages.map(p=>p.map(i=>i.str).join('').replace(/\s/gu,'').length);assert.deepEqual(counts,[4517,4475,4936,5015,5127]);assert.ok(!pages[0].some(i=>i.str.includes('Prüfungskompakt')));console.log('OK: PATR PDF all five page character counts',counts);}
