import {drawVector,vectorizeRasterProfile} from "./vector.js";
import {normalizeGlyphs,median,SMALL} from "./normalize.js";
import { markdownToBlocks, docxToBlocks } from "./structured.js";
import { CHARSET, LABELS } from "./layout.js";
import { openPdf, pdfToBlocks, textToBlocks, pdfToPositioned } from "./textin.js?v=6.1";
import { Hand, layout, layoutPositioned, drawPage, PAPER, INKS } from "./writer.js";
import { jpegPagesToPdf, canvasToJpeg } from "./pdfout.js";
import { saveProfile, loadProfile, deleteProfile, exportProfile, importProfile } from "./profile.js";

const MB = 1024 * 1024;
const LIMITS = { sheetFiles: 16, sheetBytes: 25 * MB, sheetPdfPages: 16, docBytes: 50 * MB, txtBytes: 2 * MB, textChars: 400_000 };
const PREVIEW_PAGES = 12;
const SPLIT_MAX_PAGES = 10;
const THUMB_PX_PER_MM = 4;

const $ = (id) => document.getElementById(id);
const state = { profile: null, source: null, result: null, busy: true };

// ------------------------------------------------------------------ small helpers

const tick = () => new Promise((r) => setTimeout(r, 0));

function setStatus(el, lines) {
  el.replaceChildren(...lines.map(([kind, text]) => {
    const p = document.createElement("p");
    p.className = `line ${kind}`;
    p.textContent = text;
    return p;
  }));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const isPdfFile = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

async function hasPdfMagic(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return new TextDecoder("latin1").decode(head).includes("%PDF-");
}

const safeName = (name) => name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} _()-]+/gu, "").trim().slice(0, 60) || "document";

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function pressGroup(groupEl, value) {
  for (const b of groupEl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
}
const pressed = (groupEl) => groupEl.querySelector('button[aria-pressed="true"]')?.dataset.value;

// ------------------------------------------------------------------ theme

function currentTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

$("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch { /* storage blocked: theme lasts for this visit */ }
  renderGlyphs();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderGlyphs());

$("import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || state.busy) return;
  state.busy = true; updateGenerate();
  try {
    if (!/\.json$/i.test(file.name)) throw Error("Bitte eine JSON-Profildatei auswählen.");
    const p = await importProfile(file);
    if (state.profile && !confirm("Aktuelles Profil durch die importierten Schriftproben ersetzen?")) return;
    const saved = await useProfile(p, true);
    const count=Object.values(p.glyphs).reduce((n,gs)=>n+gs.length,0);
    setStatus($("learn-status"), [[saved ? "ok" : "note", `${Object.keys(p.glyphs).length} Zeichen mit ${count} Varianten importiert.${saved ? " Lokal gespeichert." : " Nur für diese Sitzung – bitte JSON sichern."}`]]);
  } catch (err) {
    setStatus($("learn-status"), [["err", err.message]]);
  } finally { state.busy = false; updateGenerate(); }
});

$("vectorize-profile").addEventListener("click",async()=>{
 if(!state.profile||state.busy)return;
 if(!confirm("Rasterzeichen näherungsweise in Vektorpfade umwandeln? Exportiere bei Bedarf vorher das Originalprofil."))return;
 state.busy=true;updateGenerate();$("vectorize-profile").disabled=true;
 try{const result=await vectorizeRasterProfile(state.profile,(n,total)=>setStatus($("learn-status"),[["busy",`Vektorisiere ${n} / ${total} Zeichen…`]]));
 await useProfile(result.profile,true);state.result=null;$("result").hidden=true;$("reshuffle").hidden=true;
 setStatus($("learn-status"),[["ok",`${result.converted} Rastervarianten vektorisiert. ${result.skipped} leere/ungeeignete Rastervarianten unverändert.`]]);
 }catch(e){setStatus($("learn-status"),[["err",e.message]]);}finally{state.busy=false;$("vectorize-profile").disabled=false;updateGenerate();}
});
$("export-profile").addEventListener("click", () => {
  if (state.profile) download(exportProfile(state.profile), "handwriting-profile.json");
});

$("delete-profile").addEventListener("click", async () => {
  if (!confirm("Delete your handwriting from this browser? Export it first if you want to keep it.")) return;
  try { await deleteProfile(); } catch { setStatus($("learn-status"),[["err","Profil konnte nicht aus dem Browserspeicher gelöscht werden."]]); return; }
  state.profile = null;
  
  previewNormalization();
  state.result = null;
  $("profile-panel").hidden = true;
  $("result").hidden = true;
  $("reshuffle").hidden = true;
  setStatus($("learn-status"), [["ok", "Deleted."]]);
  updateGenerate();
});

async function useProfile(profile, persist) {
  state.result=null;$("result").hidden=true;$("reshuffle").hidden=true;
  state.profile = profile;
  
  let saved = true;
  if (persist) {
    try {
      await saveProfile(profile);
    } catch {
      saved = false;
      setStatus($("learn-status"), [["err", "This browser won't let the page save, so your letters only last until you close it. Export them to keep them."]]);
    }
  }
  renderGlyphs();
  previewNormalization();
  updateGenerate();
  return saved;
}

function glyphCanvas(g, color) {
  if(g.paths){
    const c=document.createElement('canvas'),s=12;
    c.width=Math.max(1,Math.ceil(g.wMm*s));c.height=Math.max(1,Math.ceil(g.hMm*s));
    const ctx=c.getContext('2d');ctx.strokeStyle=color;ctx.fillStyle=color;ctx.translate(c.width/2,c.height/2);
    drawVector(ctx,g,c.width,c.height,s);
    c.style.height=`${Math.min(40,g.hMm*THUMB_PX_PER_MM)}px`;return c;
  }
  const c = document.createElement("canvas");
  c.width = g.w;
  c.height = g.h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, g.w, g.h);
  const img = ctx.getImageData(0, 0, g.w, g.h);
  for (let i = 0; i < g.data.length; i++) img.data[i * 4 + 3] = g.data[i];
  ctx.putImageData(img, 0, 0);
  // Same scale for every glyph so a period looks small next to a W.
  c.style.height = `${Math.min(40, g.hMm * THUMB_PX_PER_MM)}px`;
  return c;
}

function renderGlyphs() {
  const p = state.profile;
  if (!p) return;
  $("vectorize-profile").hidden = Object.values(p.glyphs).flat().every(g => g.paths);
  const color = getComputedStyle(document.body).color;
  const grid = $("glyph-grid");
  const cells = [];
  const missing = [];
  for (const ch of Object.keys(p.glyphs)) {
    const copies = p.glyphs[ch] || [];
    if (!copies.length) { missing.push(LABELS[ch] || ch); continue; }
    const cell = document.createElement("div");
    cell.className = "glyph-cell";
    const label = document.createElement("div");
    label.className = "ch";
    label.textContent = LABELS[ch] || ch;
    const row = document.createElement("div");
    row.className = "copies";
    copies.forEach((g, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "copy";
      b.setAttribute("aria-pressed", String(!g.off));
      b.setAttribute("aria-label", `${LABELS[ch] || ch}, copy ${i + 1}`);
      b.append(glyphCanvas(g, color));
      b.addEventListener("click", async () => {
        g.off = !g.off;
        b.setAttribute("aria-pressed", String(!g.off));
        summarize();  previewNormalization(); staleLayout();
        try { await saveProfile(p); } catch { /* kept in memory for this visit */ }
      });
      row.append(b);
    });
    cell.append(label, row);
    cells.push(cell);
  }
  grid.replaceChildren(...cells);
  if (missing.length) {
    const m = document.createElement("p");
    m.className = "missing";
    m.textContent = `Not learned yet: ${missing.join("  ")}. Those will be written in a stand-in font.`;
    grid.append(m);
  }
  summarize();
  $("profile-panel").hidden = false;
}

function summarize() {
  const p = state.profile;
  const learned = Object.keys(p.glyphs).filter((c) => (p.glyphs[c] || []).some((g) => !g.off)).length;
  $("profile-summary").textContent = `${learned} Zeichen erfasst · ${Object.values(p.glyphs).flat().filter(g=>g.paths&&!g.off).length} aktive Vektorvarianten`;
}

// ------------------------------------------------------------------ step 3: the document

function selectTab(which) {
  staleLayout();
  const pdf = which === "pdf";
  $("tab-pdf").setAttribute("aria-selected", String(pdf));
  $("tab-text").setAttribute("aria-selected", String(!pdf));
  $("source-pdf").hidden = !pdf;
  $("source-text").hidden = pdf;
  updateGenerate();
}
$("tab-pdf").addEventListener("click", () => selectTab("pdf"));
$("tab-text").addEventListener("click", () => selectTab("text"));
$("doc-text").addEventListener("input",()=>{staleLayout();updateGenerate();});

const usingText = () => $("tab-text").getAttribute("aria-selected") === "true";

function paperFromPoints(w, h) {
  return Object.keys(PAPER).reduce((best,k)=>Math.hypot(PAPER[k][0]-w*25.4/72,PAPER[k][1]-h*25.4/72)<Math.hypot(PAPER[best][0]-w*25.4/72,PAPER[best][1]-h*25.4/72)?k:best,"a4");
}

const localPaper = () => (/^en-(US|CA)|^es-(MX|US)$/.test(navigator.language || "") ? "letter" : "a4");

$("doc-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || state.busy) return;
  state.busy=true; staleLayout();
  const status = $("write-status");
  state.source?.doc?.destroy();
  state.source = null;
  $("doc-name").textContent = "PDF, DOCX, Markdown oder TXT auswählen";
  updateGenerate();
  try {
    if (isPdfFile(file)) {
      if (file.size > LIMITS.docBytes) throw new Error("That PDF is over 50 MB.");
      if (!(await hasPdfMagic(file))) throw new Error("That file isn't a real PDF.");
      setStatus(status, [["busy", "Opening the PDF…"]]);
      const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
      state.source = { kind: "pdf", doc, name: file.name, paper: paperFromPoints(vp.width, vp.height) };
      setStatus(status, []);
    } else if (/\.docx$/i.test(file.name)) {
      if(file.size>LIMITS.docBytes)throw new Error("DOCX too large.");
      state.source={kind:"docx",blocks:await docxToBlocks(await file.arrayBuffer()),name:file.name};
      setStatus(status,[]);
    } else if (file.type === "text/plain" || /\.(txt|md|markdown)$/i.test(file.name)) {
      if (file.size > LIMITS.txtBytes) throw new Error("That text file is over 2 MB.");
      const text = await file.text();
      if (text.length > LIMITS.textChars) throw new Error("That text file is too long.");
      state.source = { kind: "txt", text, name: file.name };
      setStatus(status, []);
    } else {
      throw new Error("Pick PDF, DOCX, Markdown or TXT.");
    }
    $("doc-name").textContent = file.name;
  } catch (err) {
    setStatus(status, [["err", err.message]]);
  }
  state.busy=false;
  updateGenerate();
});

function updateGenerate() {
  const hasSource = usingText() ? $("doc-text").value.trim().length > 0 : Boolean(state.source);
  $("generate").disabled = !state.profile || !hasSource || state.busy;
  for(const id of ["doc-input","import-input","tab-pdf","tab-text","delete-profile","vectorize-profile"]) $(id).disabled=state.busy;
}

for (const id of ["ink", "paper"]) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (b) pressGroup($(id), b.dataset.value);
  });
}

$("size").addEventListener("input", () => {
  $("size-out").textContent = `${Math.round(Number($("size").value) * 100)}%`;
});

function readPen(){return {widthMm:Number($("pen-stroke").value),x:Number($("pen-x").value),y:Number($("pen-y").value)};}
for(const id of ['pen-stroke','pen-x','pen-y']) $(id).addEventListener('input',()=>{
  $(id+'-out').textContent=Number($(id).value).toFixed(2)+' mm';
  previewNormalization();if(state.result){state.result.pen=readPen();showResult();}
});
function readNormalization(){return {position:$("norm-position").checked,size:$("norm-size").checked};}
function previewNormalization(){
  const c=$("norm-preview"), hint=$("norm-preview-hint"), p=state.profile;
  c.hidden=!p;if(!p){hint.textContent="Importiere ein Profil für die Vorschau.";return;}
  const glyphs=normalizeGlyphs(p.glyphs,readNormalization());
  const gs=[...new Set('aenAgp1.,→'+Object.keys(glyphs).join(''))].flatMap(ch=>(glyphs[ch]||[]).filter(g=>!g.off).slice(0,3).map(g=>({ch,g}))).slice(0,18);
  const base=median([...SMALL].flatMap(ch=>(glyphs[ch]||[]).filter(g=>!g.off).map(g=>g.topMm+g.hMm)));
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  const total=gs.reduce((n,{g})=>n+g.wMm,0), max=Math.max(1,...gs.map(({g})=>Math.max(Math.abs(g.topMm-base),Math.abs(g.topMm+g.hMm-base))));
  const scale=Math.min(13,40/max,(c.width-30-gs.length*6)/Math.max(1,total));const baseline=65;
  ctx.strokeStyle='#b8c0cc';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(8,baseline);ctx.lineTo(c.width-8,baseline);ctx.stroke();ctx.setLineDash([]);let x=12;
  for(const {ch,g} of gs){if(g.paths){ctx.save();ctx.strokeStyle=ctx.fillStyle='#1c307d';ctx.translate(x+g.wMm*scale/2,baseline+(g.topMm-base+g.hMm/2)*scale);drawVector(ctx,g,g.wMm*scale,g.hMm*scale,scale,readPen());ctx.restore();}else{const im=glyphCanvas(g,'#1c307d');ctx.drawImage(im,x,baseline+(g.topMm-base)*scale,g.wMm*scale,g.hMm*scale);}ctx.fillStyle='#687386';ctx.font='11px sans-serif';ctx.fillText(ch,x,110);x+=g.wMm*scale+6;}
  hint.textContent='Vorschau auf gemeinsamer Grundlinie · ohne Zufallsvariation. Für die PDF-Ausgabe erneut „Dokument schreiben“ wählen.';
}
for(const id of ['norm-position','norm-size']) $(id).addEventListener('change',()=>{previewNormalization(); staleLayout();});

function staleLayout(){if(state.result){state.result=null;$("result").hidden=true;$("reshuffle").hidden=true;setStatus($("write-status"),[["note","Layout geändert. Erneut „Dokument schreiben“ drücken."]]);}}
for(const id of ['fit','fit-pages','size','layout-mode','outline-clean','doc-text'])$(id).addEventListener('change',staleLayout);
$('paper').addEventListener('click',staleLayout);
function readOptions() {
  const size = Math.min(1.4, Math.max(0.5, Number($("size").value) || 1));
  const pagesRaw = Math.round(Number($("fit-pages").value));
  const fitPages = $("fit").checked ? Math.min(100, Math.max(1, Number.isFinite(pagesRaw) ? pagesRaw : 2)) : 0;
  const inkKey = pressed($("ink")) === "blue" ? "blue" : "black";
  let paper = pressed($("paper"));
  const autoPaper=paper==="auto";
  if (!PAPER[paper]) paper = state.source?.kind === "pdf" && !usingText() ? state.source.paper : localPaper();
  const natural=Object.fromEntries(["slope","wave","vertical","rotation","scale","spacing","table"].map(k=>[k,Number($("nat-"+k).value)/100]));
  return { pen:readPen(), normalization:readNormalization(), size, fitPages, ink: INKS[inkKey], paper, autoPaper, natural, outlineClean:$("outline-clean").checked, mode:$("layout-mode").value };
}

for(const k of ["slope","wave","vertical","rotation","scale","spacing","table"]) $("nat-"+k).oninput=()=>$("nat-"+k+"-out").textContent=$("nat-"+k).value+"%";

async function sourceBlocks() {
  if (usingText()) {
    const text = $("doc-text").value.slice(0, LIMITS.textChars);
    return { blocks: markdownToBlocks(text), name: "pasted text" };
  }
  const s = state.source;
  if (s.kind === "txt") return { blocks: markdownToBlocks(s.text), name: s.name };
  if(s.kind==="docx")return {blocks:s.blocks,name:s.name};
  s.blocks ||= await pdfToBlocks(s.doc);
  return { blocks: s.blocks, name: s.name };
}


async function generate(seed) {
  if (state.busy || !state.profile) return;
  state.busy = true;
  state.result=null;$("result").hidden=true;
  updateGenerate();
  $("reshuffle").disabled = true;
  const status = $("write-status");
  try {
    setStatus(status, [["busy", "Reading the text…"]]);
    await tick();
    const opts = readOptions();
    const hand = new Hand(state.profile,opts.normalization);
    const positioned=!usingText()&&state.source?.kind==="pdf"&&opts.mode==="original";
    let blocks,name;
    if(positioned){name=state.source.name; if(!state.source.positioned||state.source.outlineClean!==opts.outlineClean){state.source.positioned=await pdfToPositioned(state.source.doc,(i,n)=>setStatus(status,[["busy",`Reading PDF page ${i}/${n}…`]]),opts.outlineClean);state.source.outlineClean=opts.outlineClean;}}
    else {({blocks,name}=await sourceBlocks());if(!blocks.length)throw new Error("There is no text to write.");}
    setStatus(status, [["busy", opts.fitPages ? "Finding the right size…" : "Writing…"]]);
    await tick();
    const out = positioned ? layoutPositioned(state.source.positioned,hand,{...opts,seed}) : layout(blocks, hand, {...opts,seed});
    state.result = { ...opts, ...out, sizeAsked: opts.size, seed, name };
    showResult();
    const notes = [];
    if (out.unknown.size) {
      const chars = [...out.unknown.keys()].slice(0, 12).join(" ");
      const count = [...out.unknown.values()].reduce((a, b) => a + b, 0);
      notes.push(["note", `Left out ${count} character${count === 1 ? "" : "s"} it can't write: ${chars}`]);
    }
    if(out.fallback?.size)notes.push(["note",`Not in your profile (fallback): ${[...out.fallback].join(" ")}`]);
    if(positioned&&opts.fitPages)notes.push(["note",`Original-Layout: ${state.source.positioned.length} Quellseiten auf ${out.pages.length} Zielseiten, kleinster Seitenmaßstab ${Math.round(out.minScale*100)} %. Drucklesbarkeit prüfen.`]);
    if(!positioned&&out.size<.5)notes.push(["note","Sehr kleine Schrift: Drucklesbarkeit prüfen. Bei Bedarf mehr Seiten oder dünneren Stift wählen."]);
    if(!positioned&&state.source?.kind==="pdf"&&!usingText())notes.push(["note","Reflow mode may lose table structure and graphics. Use Original layout to preserve them."]);
    setStatus(status, notes);
    $("reshuffle").hidden = false;
  } catch (err) {
    setStatus(status, [["err", err.message]]);
  } finally {
    state.busy = false;
    $("reshuffle").disabled = false;
    updateGenerate();
  }
}

$("generate").addEventListener("click", () => generate(randomSeed()));
$("reshuffle").addEventListener("click", () => generate(randomSeed()));

function showResult() {
  const r = state.result;
  const n = r.pages.length;
  let text = `${n} page${n === 1 ? "" : "s"}, ${r.autoPaper && r.mode==="original" && !r.fitPages && r.pages[0].dimensions ? "original size / auto" : r.paper.toUpperCase()}`;
  if(r.fitPages&&r.minScale!=null)text+=`, Seitenmaßstab min. ${Math.round(r.minScale*100)}%`;
  if (r.fitPages && r.size < r.sizeAsked) text += `, writing shrunk to ${Math.round(r.size * 100)}% to fit`;
  $("result-summary").textContent = text;
  const split = $("download-split");
  split.hidden = n < 2 || n > SPLIT_MAX_PAGES;
  split.textContent = n === 2 ? "Front and back" : "Each page";

  const previews = r.pages.slice(0, PREVIEW_PAGES).map((page, i) => {
    const fig = document.createElement("figure");
    fig.className = "preview";
    const c = document.createElement("canvas");
    drawPage(c, page, r.paper, 3, r.ink,r.pen);
    c.setAttribute("aria-label", `Page ${i + 1} preview`);
    const cap = document.createElement("span");
    cap.textContent = n === 2 ? (i ? "Back" : "Front") : `Page ${i + 1}`;
    fig.append(c, cap);
    return fig;
  });
  if (n > PREVIEW_PAGES) {
    const more = document.createElement("p");
    more.className = "muted small";
    more.textContent = `and ${n - PREVIEW_PAGES} more in the download`;
    previews.push(more);
  }
  $("previews").replaceChildren(...previews);
  $("result").hidden = false;
}

async function renderPdf(pages,r=state.result) {
  const dpi = r.fitPages || Object.values(state.profile?.glyphs||{}).flat().some(g=>g.paths) ? 300 : 200;
  const pxPerMm = dpi / 25.4;
  const canvas = document.createElement("canvas");
  const out = [];
  for (const page of pages) {
    const [wMm,hMm]=page.dimensions||PAPER[r.paper];
    drawPage(canvas, page, r.paper, pxPerMm, r.ink,r.pen);
    out.push({ jpeg: await canvasToJpeg(canvas, 0.88), widthPx: canvas.width, heightPx: canvas.height, widthMm: wMm, heightMm: hMm });
    await tick();
  }
  canvas.width = canvas.height = 0;
  return jpegPagesToPdf(out);
}

async function withButton(btn, label, fn) {
  const before = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (err) {
    setStatus($("write-status"), [["err", err.message]]);
  } finally {
    btn.disabled = false;
    btn.textContent = before;
  }
}

$("download-all").addEventListener("click", (e) => withButton(e.currentTarget, "Making PDF…", async () => {
  const r = state.result;
  download(await renderPdf(r.pages,r), `${safeName(r.name)}_handwritten.pdf`);
}));

$("download-split").addEventListener("click", (e) => withButton(e.currentTarget, "Making PDFs…", async () => {
  const r = state.result;
  const base = safeName(r.name);
  for (let i = 0; i < r.pages.length; i++) {
    const tag = r.pages.length === 2 ? (i ? "back" : "front") : `page${i + 1}`;
    download(await renderPdf([r.pages[i]],r), `${base}_handwritten_${tag}.pdf`);
    await new Promise((res) => setTimeout(res, 350));
  }
}));

// ------------------------------------------------------------------ start

for (const zone of document.querySelectorAll(".drop")) {
  zone.addEventListener("dragenter", () => zone.classList.add("over"));
  for (const ev of ["dragleave", "drop"]) zone.addEventListener(ev, () => zone.classList.remove("over"));
}

function looksLikeProfile(p) {
  return p && typeof p === "object" && p.app === "handwrite-pdf" && typeof p.ppm === "number" &&
    p.glyphs && typeof p.glyphs === "object" && !Array.isArray(p.glyphs);
}

(async () => {
  $("import-input").disabled=true;
  const saved = await loadProfile();
  if (looksLikeProfile(saved)) {
    try {
      await useProfile(saved, false);
    } catch {
      state.profile = null;
  
      $("profile-panel").hidden = true;
      setStatus($("learn-status"), [["err", "Gespeichertes Profil konnte nicht gelesen werden. Bitte JSON importieren."]]);
    }
  }
  state.busy = false;
  $("import-input").disabled=false;
  updateGenerate();
})();
