import {importVector,vectorProfile,vectorRecord,surfaceVector} from "./vector.js";
// Keeps the handwriting profile in this browser (IndexedDB) and moves it in and out as a file.

import { CHARSET } from "./layout.js";
import {validateSurface,BASE} from "./surface.js";
import {median,SMALL} from "./normalize.js";

const DB = "handwrite-pdf";
const STORE = "profiles";
const KEY = "mine";
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_COPIES = 24;
const MAX_GLYPH_PX = 600;
const MAX_PNG_CHARS = 400_000;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const conn = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = conn.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    conn.close();
  }
}

export const saveProfile = (p) => tx("readwrite", (s) => s.put(p, KEY));
export const deleteProfile = () => tx("readwrite", (s) => s.delete(KEY));
export async function loadProfile() {
  try {
    return (await tx("readonly", (s) => s.get(KEY))) || null;
  } catch {
    return null; // storage blocked (private window etc.): the app still works for this visit
  }
}

function glyphToPng(g) {
  const c = document.createElement("canvas");
  c.width = g.w;
  c.height = g.h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.data.length; i++) {
    const v = 255 - g.data[i];
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function exportProfile(p) {
  if(Object.values(p.glyphs).flat().every(g=>g.paths))return new Blob([JSON.stringify(vectorProfile(p))],{type:"application/json"});
  const glyphs = {};
  for (const [ch, copies] of Object.entries(p.glyphs)) {
    glyphs[ch] = copies.map((g) => g.paths ? {vector:vectorRecord(g)} : ({ png: glyphToPng(g), wMm: g.wMm, hMm: g.hMm, topMm: g.topMm, off: Boolean(g.off) }));
  }
  const body = JSON.stringify({ app: "handwrite-pdf", version: 1, ppm: p.ppm, created: p.created, origin: "baseline", glyphs });
  return new Blob([body], { type: "application/json" });
}

const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function pngToGlyph(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width < 1 || img.height < 1 || img.width > MAX_GLYPH_PX || img.height > MAX_GLYPH_PX) {
        reject(new Error("A letter image in that file has an impossible size."));
        return;
      }
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const data = new Uint8Array(c.width * c.height);
      for (let i = 0; i < data.length; i++) data[i] = 255 - px[i * 4];
      resolve({ w: c.width, h: c.height, data });
    };
    img.onerror = () => reject(new Error("A letter image in that file couldn't be read."));
    img.src = src;
  });
}

/** Parses and strictly validates an exported profile file. */
export async function importProfile(file) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is too big to be a handwriting profile.");
  let raw;
  try {
    const text=await file.text();
    if(/\.svg$/i.test(file.name||'' )||file.type==='image/svg+xml'){
      const doc=new DOMParser().parseFromString(text,'image/svg+xml');
      const meta=doc.querySelector('metadata[id="handwrite-vector-profile"]');
      if(!meta)throw Error('SVG enthält kein Vektorprofil. Bitte das JSON aus dem Vektorstudio verwenden.');
      raw=JSON.parse(meta.textContent);
    }else raw=JSON.parse(text);
  } catch(err) {
    throw new Error(err.message?.startsWith("SVG enthält")?err.message:"That isn't a handwriting profile file.");
  }
  if(raw?.app === "handwrite-vector") return importVector(raw);
  if(raw?.app === "surface-schriftstudio") {validateSurface(raw);return surfaceVector(raw);}
  if (!raw || raw.app !== "handwrite-pdf" || raw.version !== 1 || !num(raw.ppm, 4, 40) ||
      typeof raw.glyphs !== "object" || raw.glyphs === null || Array.isArray(raw.glyphs)) {
    throw new Error("That isn't a handwriting profile file.");
  }
  const glyphs = {};
  for (const [ch, copies] of Object.entries(raw.glyphs)) {
    if ([...ch].length !== 1 || !CHARSET.includes(ch) || !Array.isArray(copies) || copies.length > MAX_COPIES) {
      throw new Error("That profile file has unexpected contents.");
    }
    glyphs[ch] = [];
    for (const g of copies) {
      if(g?.vector){
        const vg=importVector({app:'handwrite-vector',version:2,units:'mm',coordinates:'local-mm',glyphs:{[ch]:[g.vector]}}).glyphs[ch][0];
        vg.topMm=g.vector.topMm;glyphs[ch].push(vg);continue;
      }
      if (!g || typeof g.png !== "string" || !g.png.startsWith("data:image/png;base64,") || g.png.length > MAX_PNG_CHARS ||
          !num(g.wMm, 0.001, 40) || !num(g.hMm, 0.001, 40) || !num(g.topMm, -40, 40)) {
        throw new Error("That profile file has unexpected contents.");
      }
      const img = await pngToGlyph(g.png);
      glyphs[ch].push({ ...img, wMm: g.wMm, hMm: g.hMm, topMm: g.topMm, off: g.off === true });
    }
  }
  // Older Surface raster exports use the top of the 19 mm writing pad as origin.
  // Legacy scanner/photo exports use a baseline-relative origin already.
  const bottom=median([...SMALL].flatMap(ch=>(glyphs[ch]||[]).filter(g=>!g.off).map(g=>g.topMm+g.hMm)));
  const surfaceOrigin=raw.origin==="surface-pad" || (!raw.origin && (/mein-handschriftprofil/i.test(file.name||"") || bottom>6));
  if(surfaceOrigin)for(const gs of Object.values(glyphs))for(const g of gs)g.topMm-=BASE;
  if (!Object.values(glyphs).some(gs=>gs.length)) throw new Error("That profile file has no letters in it.");
  return { app: "handwrite-pdf", version: 1, ppm: raw.ppm, created: num(raw.created, 0, 1e15) ? raw.created : Date.now(), glyphs };
}
