import {prepareBackground} from "./background.js";
// Turns a PDF or plain text into blocks of styled text, and text into drawable characters.
// Port of the reading half of python/write_handwriting.py.

// pdf.js 4.10.38, served from this site (locally patched for text visibility in clipped Form XObjects) so nothing loads from a third party.
const PDFJS = new URL("../vendor/pdfjs/", import.meta.url).href;
const MAX_PDF_PAGES = 300;
const MAX_RENDER_SIDE = 4000;

export const REPLACE = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"', "„": '"',
  "′": "'", "″": '"', "«": '"', "»": '"',
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  "•": "-", "▪": "-", "●": "-", "◦": "-", "": "-",
  "…": "...", " ": " ", "\t": " ", "ﬁ": "fi", "ﬂ": "fl",
  "×": "x", "→": "->", "←": "<-", "½": "1/2", "¼": "1/4", "¾": "3/4",
  "﻿": "", "​": "", "‌": "", "‍": "", "­": "", "\x00": "", "\r": "",
};
const SUP = Object.fromEntries([..."⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿⁱ"]
  .map((c, i) => [c, "0123456789-+ni"[i]]));
const SUB = Object.fromEntries([..."₀₁₂₃₄₅₆₇₈₉₋₊ₐₑₒₓ"]
  .map((c, i) => [c, "0123456789-+aeox"[i]]));
export const DRAWN = new Set(["·", "☉", "⊕", "°", "√"]);
const LIST_ITEM = /^([-•▪●◦]|([1-9]\d{0,2}|[a-zA-Z])[.)])\s/;
const MONO_HINTS = /mono|courier|consolas|menlo|code/i;
const BOLD_HINTS = /bold|black|heavy|semibold/i;
const isAlnum = (c) => /[\p{L}\p{N}]/u.test(c);

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    pdfjs = await import(`${PDFJS}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.clipfix.min.mjs`;
  }
  return pdfjs;
}

export async function openPdf(bytes) {
  const { getDocument } = await lib();
  const doc = await getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`That PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
  return doc;
}

/** Renders one PDF page to a canvas (used for scanned sheets). */
export async function renderPdfPage(doc, n, targetWidth) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(targetWidth / base.width, MAX_RENDER_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

const runText = (runs) => runs.map((r) => r[0]).join("").replaceAll("​", "");

function stripRuns(runs) {
  runs = runs.map((r) => [...r]);
  while (runs.length && !runs.at(-1)[0].replaceAll("​", "").trim()) runs.pop();
  if (runs.length) runs.at(-1)[0] = runs.at(-1)[0].replaceAll("​", "").trimEnd();
  return runs;
}

function joinLines(lines) {
  const out = [];
  for (const runs of lines) {
    const text = runText(runs).trim();
    if (!out.length || LIST_ITEM.test(text)) { out.push([...runs]); continue; }
    const prev = runText(out.at(-1));
    if (prev.endsWith("-") && !prev.endsWith(" -") && /^\p{Ll}/u.test(text)) {
      const last = out.at(-1).at(-1);
      last[0] = last[0].slice(0, -1);
      out.at(-1).push(...runs);
    } else {
      out.at(-1).push([" ", false], ...runs);
    }
  }
  return out;
}

function fontInfo(page, fontName, styles) {
  let name = "";
  try { name = page.commonObjs.get(fontName)?.name || ""; } catch { /* font not loaded */ }
  const family = styles[fontName]?.fontFamily || "";
  return { bold: BOLD_HINTS.test(name), mono: family === "monospace" || MONO_HINTS.test(name) };
}

/** Blocks: { kind: 'para'|'mono', lines: [[text, bold], ...][] } */
export async function pdfToBlocks(doc) {
  const groups = [];
  const sizes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    await page.getOperatorList(); // loads fonts so their names (and boldness) are known
    const { items, styles } = await page.getTextContent();

    const lines = [];
    let line = null;
    for (const it of items) {
      if (typeof it.str !== "string") continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      const y = it.transform[5];
      if (line && Math.abs(y - line.y) > size * 0.5) { lines.push(line); line = null; }
      if (!line) line = { y, size: 0, runs: [], chars: 0, mono: 0, bold: 0 };
      if (it.str) {
        const f = fontInfo(page, it.fontName, styles);
        const visible = it.str.replaceAll("​", "").trim().length;
        line.runs.push([it.str, f.bold]);
        line.chars += visible;
        line.mono += f.mono ? visible : 0;
        line.bold += f.bold ? visible : 0;
        if (visible) { line.size = Math.max(line.size, size); sizes.push(Math.round(size * 10) / 10); }
      }
      if (it.hasEOL) { lines.push(line); line = null; }
    }
    if (line) lines.push(line);

    // Consecutive lines of the same kind form a group; a big vertical gap starts a new one.
    let group = null;
    let prevY = null;
    // pdf.js ends lines with empty marker items; those aren't real blank lines.
    for (const ln of lines.filter((l) => l.runs.length)) {
      const mono = ln.chars ? ln.mono / ln.chars > 0.5 : group?.mono ?? false;
      const gap = prevY === null ? 0 : Math.abs(prevY - ln.y);
      const lineSize = ln.size || group?.size || 10;
      if (!group || mono !== group.mono || gap > lineSize * 1.9) {
        group = { mono, lines: [], chars: 0, bold: 0, size: 0 };
        groups.push(group);
      }
      group.lines.push(ln.runs);
      group.chars += ln.chars;
      group.bold += ln.bold;
      group.size = Math.max(group.size, ln.size);
      prevY = ln.y;
    }
  }
  const real = groups.filter((g) => g.chars);
  if (!real.length) throw new Error("No text found in that PDF. If it's a scan or photo, it has no real text to copy.");

  const counts = new Map();
  sizes.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1));
  const body = [...counts].sort((a, b) => b[1] - a[1])[0][0];

  return real.map((g) => {
    let lines = g.lines;
    const heading = g.bold / g.chars > 0.9 || g.size > body * 1.2;
    if (heading) lines = lines.map((runs) => runs.map(([t]) => [t, true]));
    return g.mono
      ? { kind: "mono", heading, lines: lines.map(stripRuns) }
      : { kind: "para", heading, lines: joinLines(lines.map(stripRuns).filter((r) => runText(r).trim())) };
  });
}

export function textToBlocks(text) {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => ({ kind: "para", lines: p.trim().split("\n").map((l) => [[l, false]]) }));
}

export { runText };

/** Text -> [char, position, bold, dotAbove][]; understands x_sub, x^sup, x^(...), ⁸ and ₂. */
export function toChars(text, bold, known, unknown, pos = "base", literal = false) {
  const out = [];
  const isKnown = (c) => known.has(c) || DRAWN.has(c) || c === " ";
  const classify = (c, p) => {
    if(c==="‐"||c==="‑")c="-";
    if(c==="\u00ad")return;
    if (known.has(c)) { out.push([c, p, bold, false]); return; }
    c = /[\p{C}\sﬁﬂ]/u.test(c) ? (REPLACE[c] ?? c) : c;
    if ([...c].length !== 1) { for (const x of c) classify(x, p); return; }
    if (SUP[c]) out.push([SUP[c], "sup", bold, false]);
    else if (SUB[c]) out.push([SUB[c], "sub", bold, false]);
    else if (c === "∛") { out.push(["3", "sup", bold, false], ["√", p, bold, false]); }
    else if (isKnown(c)) out.push([c, p, bold, false]);
    else {
      const nfd = c.normalize("NFD");
      const base = nfd.replace(/\p{M}/gu, "");
      if (/[\p{Extended_Pictographic}\p{C}]/u.test(c)) {
        unknown.set(c, (unknown.get(c) || 0) + 1);
      } else {
        out.push([c, p, bold, false]); // drawn with a fallback handwriting font
      }
    }
  };

  const chars = [...text.normalize("NFC")];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    const prev = i ? chars[i - 1] : " ";
    const attached = isAlnum(prev) || ")☉⊕".includes(prev);
    if (!literal && c === "_" && attached && i + 1 < chars.length && isAlnum(chars[i + 1])) {
      let j = i + 1;
      while (j < chars.length && isAlnum(chars[j])) j++;
      out.push(...toChars(chars.slice(i + 1, j).join(""), bold, known, unknown, pos === "base" ? "sub" : pos));
      i = j;
      continue;
    }
    if (!literal && c === "^" && i + 1 < chars.length) {
      if (chars[i + 1] === "(") {
        let depth = 0, j = i + 1;
        for (; j < chars.length; j++) {
          depth += chars[j] === "(" ? 1 : chars[j] === ")" ? -1 : 0;
          if (depth === 0) break;
        }
        out.push(...toChars(chars.slice(i + 2, j).join(""), bold, known, unknown, "sup"));
        i = j + 1;
        continue;
      }
      let j = i + 1 + ("+-−".includes(chars[i + 1]) ? 1 : 0);
      while (j < chars.length && isAlnum(chars[j])) j++;
      if (j > i + 1) {
        out.push(...toChars(chars.slice(i + 1, j).join(""), bold, known, unknown, "sup"));
        i = j;
        continue;
      }
    }
    classify(c, pos);
    i++;
  }
  return out;
}

/** Extract the original page geometry, and render only its non-text graphics. */
export async function pdfToPositioned(doc, progress = () => {}, clean = true) {
  const api = await lib();
  const pages = [];
  let count = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    progress(i, doc.numPages);
    const page = await doc.getPage(i);
    const vp = page.getViewport({scale: 1});
    const {items} = await page.getTextContent();
    const runs = [];
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const t = api.Util.transform(vp.transform, it.transform);
      const mm = 25.4 / 72;
      const angle = Math.atan2(t[1], t[0]);
      runs.push({text: it.str, x: t[4]*mm, y: t[5]*mm, width: Math.abs(it.width)*mm,
        height: (Math.hypot(t[2],t[3]) || it.height || 10)*mm, angle});
      count += it.str.length;
    }
    api.setHandwriteHideText(true);
    let bg;
    try { bg = await renderPdfPage(doc, i, Math.min(2200, vp.width * 2)); }
    finally { api.setHandwriteHideText(false); }
    const width=vp.width*25.4/72,height=vp.height*25.4/72;
    const prepared=prepareBackground(bg,runs,width,height,clean);
    const image=new Image(),ruleFree=new Image();image.src=prepared.original;ruleFree.src=prepared.without;await Promise.all([image.decode(),ruleFree.decode()]);
    bg.width=bg.height=0;
    pages.push({width,height,runs,image,ruleFree,rules:prepared.lines});
    page.cleanup();
  }
  if (!count) throw new Error('No selectable text found. OCR is not included; use a searchable PDF.');
  return pages;
}
