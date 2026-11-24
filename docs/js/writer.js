import {drawVector} from "./vector.js";
// Lays text out in someone's handwriting. Pages are display lists in mm, drawn at any resolution later.
// Port of the layout half of python/write_handwriting.py.

import { DRAWN, runText, toChars } from "./textin.js";
import {normalizeGlyphs} from "./normalize.js";

export const PAPER = { a4: [210, 297], letter: [215.9, 279.4], a3: [297, 420], "a3-landscape": [420, 297], "a4-landscape": [297, 210], a5: [148, 210] };
export const INKS = { black: "rgb(32, 32, 40)", blue: "rgb(28, 48, 125)" };
const SMALL_LETTERS = "acemnorsuvwxz";
const FALLBACK_FONT = '"Ink Free", "Segoe Print", "Bradley Hand", "Comic Sans MS", "Segoe UI Symbol", cursive';
const MIN_FIT_SIZE = 0.08;

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { uniform: (lo, hi) => lo + (hi - lo) * next(), int: (n) => Math.floor(next() * n) };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** A handwriting profile with measurements of how the person writes (all in sheet mm). */
export class Hand {
  constructor(profile, normalization={}) {
    this.ppm = profile.ppm;
    this.glyphs = {};
    for (const [ch, copies] of Object.entries(profile.glyphs)) {
      const active = copies.filter((g) => !g.off);
      if (active.length) this.glyphs[ch] = active.map((g) => ({ ...g }));
    }
    this.glyphs = normalizeGlyphs(this.glyphs, normalization);
    const all = (chars, f) => [...chars].flatMap((c) => (this.glyphs[c] || []).map(f));
    if (!all(SMALL_LETTERS, (g) => g).length) throw new Error("This handwriting profile has no small letters.");
    this.base = median(all(SMALL_LETTERS, (g) => g.topMm + g.hMm));
    for(const gs of Object.values(this.glyphs))for(const g of gs)g.topMm-=this.base;
    this.base=0;
    const active=Object.values(this.glyphs).flat();
    this.ascent=Math.max(...active.map(g=>-g.topMm),.1);
    this.descent=Math.max(...active.map(g=>g.topMm+g.hMm),.1);
    this.xh = median(all(SMALL_LETTERS, (g) => g.hMm));
    this.capTop = median(all("ABDEHKLMNRT", (g) => g.topMm)) || this.base - this.xh * 1.6;
    this.charW = median(all(SMALL_LETTERS, (g) => g.wMm));
    const dashes = this.glyphs["-"] || [];
    this.stroke = dashes.length
      ? median(dashes.map((g) => g.paths ? median(g.paths.map(p=>p.widthMm)) : g.data.reduce((s, v) => s + v, 0) / 255 / g.w / this.ppm))
      : 0.35;
    this.known = new Set(Object.keys(this.glyphs));
    // Original placement is preserved unless position normalization is enabled.

  }

  /** Marks written in an empty box float; place them relative to the real baseline instead. */
  placePunctuation() {
    const { base, xh, capTop } = this;
    const rules = [
      [".:!?%#@&/", (h) => base - h],
      ["$", (h) => base + 0.6 - h],
      ["()[]{}", (h) => base + 0.9 - h],
      [",", (h) => base - h * 0.55],
      [";", (h) => base - h * 0.8],
      ["_", (h) => base + 0.4 - h],
      ["-=+<>−–—×÷±≤≥≠≈→←↑↓↔⇒⇔·•", (h) => base - xh * 0.5 - h / 2],
      ["'\"*‘’“”°", () => capTop],
    ];
    rules.push(["⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻", () => capTop], ["₀₁₂₃₄₅₆₇₈₉₊₋", (h) => base + xh * .25 - h], ["€£¥¢§", (h) => base - h]);
    for (const [chars, top] of rules) {
      for (const c of chars) for (const g of this.glyphs[c] || []) g.topMm = top(g.hMm);
    }
  }
}

// Text measurement for fallback characters (Greek letters, ≈, ∫ ...), in units of a 100px font.
const measureCtx = document.createElement("canvas").getContext("2d");
const metricCache = new Map();
function metrics100(c) {
  if (!metricCache.has(c)) {
    measureCtx.font = `100px ${FALLBACK_FONT}`;
    const m = measureCtx.measureText(c);
    metricCache.set(c, { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent });
  }
  return metricCache.get(c);
}

const DEFAULT_NAT={slope:.35,wave:.25,vertical:.25,rotation:.30,scale:.25,spacing:.25,table:.5};
class Writer {
  constructor(hand, { size, paper, compact, seed, natural }) {
    this.hand = hand;
    this.nat={...DEFAULT_NAT,...natural};
    this.size = size;
    [this.pageW, this.pageH] = PAPER[paper];
    this.rng = rng(seed);
    this.jitter = rng(seed + 1);
    this.margin = compact ? { left: 7, right: 6, top: 7, bottom: 6 } : { left: 24, right: 18, top: 22, bottom: 20 };
    this.pitch = compact ? 2.05 : 2.6;
    this.paraGap = compact ? 0.5 : 0.6;
    this.xh = hand.xh * size;
    this.linePitch = Math.max(this.xh*this.pitch,(hand.ascent+hand.descent)*size*1.12);
    this.headroom=hand.ascent*size*1.18;this.footroom=hand.descent*size*1.18;
    this.right = this.pageW - this.margin.right;
    this.pages = [];
    this.last = {};
    this.boldSeg = null;
    this.newPage();
  }

  newPage() {
    this.page = { ops: [] };
    this.pages.push(this.page);
    this.y = this.margin.top + this.headroom;
    this.startLine();
  }

  startLine(indent = 0) {
    this.x = this.margin.left + indent + this.rng.uniform(-0.5, 0.5) * this.size;
    this.slope = this.rng.uniform(-1, 1) * this.nat.slope * 0.8 * this.linePitch / (this.right - this.margin.left);
    this.wave = [this.rng.uniform(0.04, 0.23) * this.nat.wave * this.linePitch, this.rng.uniform(12, 40), this.rng.uniform(0, 6.3)];
    this.lineX0 = this.x;
    this.lineId = (this.lineId || 0) + 1;
  }

  newline(extra = 0, indent = 0) {
    this.flushUnderline();
    this.y += this.linePitch * (1 + extra) + this.rng.uniform(-0.2, 0.2) * this.size;
    if (this.y + this.footroom > this.pageH - this.margin.bottom) this.newPage();
    this.startLine(indent);
  }

  line() {
    return { page: this.page, id: this.lineId, y: this.y, slope: this.slope, wave: this.wave, x0: this.lineX0 };
  }

  baseline(x, ln = this.line()) {
    const [amp, period, phase] = ln.wave;
    return ln.y + (x - ln.x0) * ln.slope + amp * Math.sin(x / period + phase);
  }

  pick(ch) {
    const copies = this.hand.glyphs[ch];
    const options = copies.map((_, i) => i).filter((i) => i !== this.last[ch]);
    const i = options.length ? options[this.rng.int(options.length)] : 0;
    this.last[ch] = i;
    return copies[i];
  }

  gap(pos) {
    const g = this.xh * (0.18+this.rng.uniform(-.18,.18)*this.nat.spacing);
    return pos === "base" ? g : g * 0.6;
  }

  space() { return this.xh * (0.875+this.rng.uniform(-.35,.35)*this.nat.spacing); }

  /** -> { adv, pieces: [{ op, dx, top }] } with top measured from the line origin, in mm. */
  plan([c, pos, , dot], fBase) {
    const h = this.hand;
    const f = fBase * (pos === "base" ? 1 : 0.62);
    const dy = h.base * (fBase - f) + (pos === "sup" ? -h.xh * fBase * 0.72 : pos === "sub" ? h.xh * fBase * 0.3 : 0);
    const realBase = dy + h.base * f;

    if (h.glyphs[c]) {
      const g = this.pick(c);
      const adv = g.wMm * f;
      const top = dy + g.topMm * f;
      const pieces = [{ op: { t: "img", g, w: g.wMm * f, h: g.hMm * f }, dx: 0, top }];
      if (dot && h.glyphs["."]) {
        const d = this.pick(".");
        const fd = f * 0.85;
        pieces.push({ op: { t: "img", g: d, w: d.wMm * fd, h: d.hMm * fd }, dx: adv / 2 - (d.wMm * fd) / 2, top: top - d.hMm * fd - 0.5 * f });
      }
      return { adv, pieces };
    }
    if (c === "·" && h.glyphs["."]) {
      const d = this.pick(".");
      const fd = f * 0.9;
      return { adv: d.wMm * fd, pieces: [{ op: { t: "img", g: d, w: d.wMm * fd, h: d.hMm * fd }, dx: 0, top: realBase - h.xh * f * 0.5 - (d.hMm * fd) / 2 }] };
    }
    const stroke = h.stroke * f;
    if (c === "☉" || c === "⊕") {
      const d = h.xh * f * 1.15;
      return { adv: d, pieces: [{ op: { t: "shape", kind: c, w: d, h: d, stroke }, dx: 0, top: realBase - d }] };
    }
    if (c === "°") {
      const d = h.xh * f * 0.45;
      return { adv: d, pieces: [{ op: { t: "shape", kind: c, w: d, h: d, stroke }, dx: 0, top: dy + h.capTop * f }] };
    }
    if (c === "√") {
      const w = h.xh * f * 1.1, hh = (h.base - h.capTop) * f;
      return { adv: w, pieces: [{ op: { t: "shape", kind: c, w, h: hh, stroke }, dx: 0, top: realBase - hh }] };
    }
    // Anything else: a handwriting-style system font, sized to this person's letters.
    const x = metrics100("x");
    const fontMm = (100 * h.xh * f) / (x.ascent || 50);
    const m = metrics100(c);
    const k = fontMm / 100;
    return {
      adv: Math.max(0.5, (m.left + m.right) * k),
      pieces: [{ op: { t: "text", c, fontMm, left: m.left * k }, dx: 0, top: realBase }],
    };
  }

  emit(pieces) {
    for (const { op, dx, top } of pieces) {
      const x = this.x + dx;
      const y = this.baseline(this.x) + top + this.jitter.uniform(-1,1)*this.xh*this.nat.vertical*.6;
      this.page.ops.push({ ...op, x, y, angle: (this.jitter.uniform(-8,8)*this.nat.rotation * Math.PI) / 180, alpha: this.jitter.uniform(0.82, 1) });
    }
  }

  word(chars, indent = 0) {
    const items = chars.map((ch) => {
      const { adv, pieces } = this.plan(ch, this.size * (1+this.rng.uniform(-.22,.22)*this.nat.scale));
      return { adv, pieces, gap: this.gap(ch[1]) };
    });
    const width = items.reduce((s, it, i) => s + it.adv + (i < items.length - 1 ? it.gap : 0), 0);
    if (this.x + width > this.right && this.x > this.lineX0 + 0.1) this.newline(0, indent);
    const x0 = this.x;
    for (const it of items) {
      if (this.x + it.adv > this.right + 1.5) this.newline(0, indent);
      this.emit(it.pieces);
      this.x += it.adv + it.gap;
    }
    const x1 = this.x - (items.length ? items.at(-1).gap : 0);
    if (chars.length && chars.every((c) => c[2])) this.markBold(x0, x1);
    else this.flushUnderline();
  }

  markBold(x0, x1) {
    const ln = this.line();
    if (this.boldSeg && this.boldSeg.ln.id === ln.id) this.boldSeg.x1 = x1;
    else {
      this.flushUnderline();
      this.boldSeg = { ln, x0, x1 };
    }
  }

  flushUnderline() {
    const seg = this.boldSeg;
    this.boldSeg = null;
    if (!seg) return;
    const pts = [];
    const steps = Math.max(2, Math.floor((seg.x1 - seg.x0) / 3));
    for (let i = 0; i <= steps; i++) {
      const x = seg.x0 + ((seg.x1 - seg.x0) * i) / steps;
      pts.push([x, this.baseline(x, seg.ln) + (this.hand.base + 0.9) * this.size + this.jitter.uniform(-0.1, 0.1) * this.size]);
    }
    seg.ln.page.ops.push({ t: "line", pts, width: this.hand.stroke * this.size * 0.9 });
  }

  writeWords(chars, indent = 0) {
    let word = [];
    for (const ch of [...chars, [" ", "base", false, false]]) {
      if (ch[0] === " ") {
        if (word.length) {
          this.word(word, indent);
          word = [];
          this.x += this.space();
        }
      } else word.push(ch);
    }
  }

  columnWidth(block) {
    const adv = this.hand.charW * this.size * 1.15 + this.xh * 0.18;
    let need = adv, lastCol = 1;
    for (const runs of block.lines) {
      const cells = [...runText(runs).matchAll(/\S+(?: \S+)*/g)].map((m) => [m.index, m[0]]);
      for (let i = 0; i + 1 < cells.length; i++) {
        need = Math.max(need, (cells[i][1].length * adv + 1.5 * this.xh) / (cells[i + 1][0] - cells[i][0]));
      }
      if (cells.length) lastCol = Math.max(lastCol, cells.at(-1)[0]);
    }
    const room = ((this.right - this.margin.left) * 0.85) / lastCol;
    return Math.min(need, Math.max(adv, room));
  }

  table(block, convert) {
    const rows = block.rows, cols = Math.max(...rows.map(r=>r.length));
    if (!cols) return;
    const left = this.margin.left, width = this.right-left, pad = Math.max(.15,this.xh*.45);
    const weights = Array.from({length:cols},(_,i)=>Math.max(3,Math.min(24,Math.max(...rows.map(r=>(r[i]||'').length)))));
    const sum = weights.reduce((a,b)=>a+b,0);
    const widths=weights.map(w=>width*(.4/cols+.6*w/sum));
    const xs=[left]; widths.forEach(w=>xs.push(xs.at(-1)+w));
    const wrap = (text, room, bold) => {
      const lines=[[]]; let used=0;
      for (const c of convert(text,bold)) {
        const plan = c[0]===' ' ? {adv:this.xh*.6,pieces:[]} : this.plan(c,this.size);
        const adv=plan.adv+this.xh*.12;
        if (used+adv>room && lines.at(-1).length) {lines.push([]);used=0;}
        lines.at(-1).push({ ...plan, x:used }); used+=adv;
      }
      return lines;
    };
    const line = (x1,y1,x2,y2) => this.page.ops.push({t:'line',pts:[[x1,y1],[(x1+x2)/2+this.jitter.uniform(-.45,.45)*this.nat.table,(y1+y2)/2+this.jitter.uniform(-.45,.45)*this.nat.table],[x2,y2]],width:Math.max(.12,this.hand.stroke*this.size*.7)});
    this.flushUnderline();
    for (let ri=0;ri<rows.length;ri++) {
      const cells=widths.map((w,i)=>wrap(rows[ri][i]||'',Math.max(.5,w-2*pad),ri===0&&block.header));
      const count=Math.max(...cells.map(c=>c.length)); let offset=0;
      while(offset<count) {
        let top=this.y-this.headroom;
        let slots=Math.floor((this.pageH-this.margin.bottom-top-2*pad)/this.linePitch);
        if(slots<1){this.newPage();top=this.y-this.headroom;slots=Math.max(1,Math.floor((this.pageH-this.margin.bottom-top-2*pad)/this.linePitch));}
        const take=Math.min(count-offset,slots), bottom=top+2*pad+take*this.linePitch;
        for(let j=0;j<cols;j++) for(let k=0;k<take;k++) for(const it of cells[j][offset+k]||[]) {
          for(const {op,dx,top:dy} of it.pieces) this.page.ops.push({...op,x:xs[j]+pad+it.x+dx,y:top+pad+this.headroom+k*this.linePitch+dy+this.jitter.uniform(-1,1)*this.xh*this.nat.vertical*.6+this.nat.wave*this.xh*.3*Math.sin(it.x/10)+this.nat.slope*this.xh*.2*(ri%2?1:-1)*it.x/Math.max(1,widths[j]),angle:this.jitter.uniform(-8,8)*this.nat.rotation*Math.PI/180,alpha:.95});
        }
        line(left,top,this.right,top);line(left,bottom,this.right,bottom);xs.forEach(x=>line(x,top,x,bottom));
        this.y=bottom+this.headroom; offset+=take; if(offset<count)this.newPage();
      }
    }
    this.newline(.3);
  }

  block(block, convert) {
    if(block.kind === 'table') { this.table(block,convert); return; }
    if (block.kind === "para") {
      block.lines.forEach((runs, n) => {
        if (n) this.newline();
        this.writeWords(runs.flatMap(([t, b]) => convert(t, b)));
      });
    } else {
      const colW = this.columnWidth(block);
      block.lines.forEach((runs, n) => {
        const text = runText(runs);
        if (n) this.newline(text.trim() ? 0 : -0.45);
        if (!text.trim()) return;
        const bold = runs.filter(([t]) => t.trim()).every(([, b]) => b);
        for (const m of text.matchAll(/\S+(?: \S+)*/g)) {
          const target = this.lineX0 + m.index * colW;
          if (target > this.x) this.x = Math.min(target, this.right - 5 * colW);
          this.writeWords(convert(m[0], bold), 2 * colW);
          this.x += this.space();
        }
      });
    }
    // Space goes between sections; a heading stays close to the text it introduces.
    this.newline(block.heading ? 0.08 : this.paraGap);
  }
}

/** Lays out all blocks. Returns { pages, unknown, size }. */
export function layout(blocks, hand, { size, paper, fitPages, seed, natural }) {
  const run = (s) => {
    const unknown = new Map(), fallback = new Set();
    const w = new Writer(hand, { size: s, paper, compact: Boolean(fitPages), seed, natural });
    const convert = (t, b) => { const chars=toChars(t,b,hand.known,unknown); for(const [c] of chars) if(c!==" "&&!hand.known.has(c)) fallback.add(c); return chars; };
    for (const b of blocks) w.block(b, convert);
    w.flushUnderline();
    const pages = w.pages.filter((p, i) => p.ops.length || i === 0);
    return { pages, unknown, fallback, size: s };
  };
  fitPages=Math.max(0,Math.floor(Number(fitPages)||0));
  if (!fitPages) return run(size);
  let best = run(size);
  if (best.pages.length <= fitPages) return best;
  let lo = Math.min(size,MIN_FIT_SIZE), hi = size;
  const smallest = run(lo);
  if (smallest.pages.length > fitPages) {
    throw new Error(`That doesn't fit on ${fitPages} page${fitPages > 1 ? "s" : ""} even with tiny writing. Try ${fitPages + 1}.`);
  }
  best = smallest;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const r = run(mid);
    if (r.pages.length <= fitPages) { best = r; lo = mid; } else hi = mid;
  }
  return best;
}

// ------------------------------------------------------------------ drawing

const tintCache = new WeakMap();
function tinted(g, ink) {
  let byInk = tintCache.get(g);
  if (!byInk) { byInk = new Map(); tintCache.set(g, byInk); }
  if (!byInk.has(ink)) {
    const c = document.createElement("canvas");
    c.width = g.w;
    c.height = g.h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, g.w, g.h);
    const img = ctx.getImageData(0, 0, g.w, g.h);
    for (let i = 0; i < g.data.length; i++) img.data[i * 4 + 3] = g.data[i];
    ctx.putImageData(img, 0, 0);
    byInk.set(ink, c);
  }
  return byInk.get(ink);
}

function shapePath(ctx, kind, w, h) {
  ctx.beginPath();
  if (kind === "√") {
    ctx.moveTo(0, 0.62 * h);
    ctx.lineTo(0.2 * w, 0.52 * h);
    ctx.lineTo(0.42 * w, h);
    ctx.lineTo(0.78 * w, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();
    return;
  }
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (kind === "☉") {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.max(ctx.lineWidth * 0.65, w * 0.13), 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "⊕") {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0.05 * h); ctx.lineTo(w / 2, 0.95 * h);
    ctx.moveTo(0.05 * w, h / 2); ctx.lineTo(0.95 * w, h / 2);
    ctx.stroke();
  }
}

/** Draws one laid-out page onto a canvas at the given pixels-per-mm. */
export function drawPage(canvas, page, paper, pxPerMm, ink, pen={}) {
  const [wMm, hMm] = page.dimensions || PAPER[paper];
  canvas.width = Math.round(wMm * pxPerMm);
  canvas.height = Math.round(hMm * pxPerMm);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = pxPerMm;
  function drawOps(ops) { for (const op of ops) {
    if (op.t === "group") {
      ctx.save(); ctx.translate(op.x*s,op.y*s); ctx.rotate(op.angle||0); ctx.scale(op.sx??1,op.sy??1); drawOps(op.ops); ctx.restore(); continue;
    }
    if (op.t === "background") { ctx.save(); ctx.globalAlpha=1; ctx.drawImage(op.image,0,0,op.w*s,op.h*s); ctx.restore(); continue; }
    if (op.t === "line") {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1, op.width * s);
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
      ctx.stroke();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = op.alpha;
    if (op.t === "img") {
      const w = op.w * s, h = op.h * s;
      ctx.translate(op.x * s + w / 2, op.y * s + h / 2);
      ctx.rotate(op.angle);
      if(op.g.paths) drawVector(ctx,op.g,w,h,s,pen);
      else ctx.drawImage(tinted(op.g, ink), -w / 2, -h / 2, w, h);
    } else if (op.t === "shape") {
      ctx.translate(op.x * s, op.y * s);
      ctx.rotate(op.angle);
      ctx.lineWidth = Math.max(1, op.stroke * s);
      ctx.scale(s, s);
      ctx.lineWidth = Math.max(1 / s, op.stroke);
      shapePath(ctx, op.kind, op.w, op.h);
    } else if (op.t === "text") {
      ctx.translate(op.x * s, op.y * s);
      ctx.rotate(op.angle);
      ctx.font = `${op.fontMm * s}px ${FALLBACK_FONT}`;
      ctx.fillText(op.c, op.left * s, 0);
    }
    ctx.restore();
  }
  }
  drawOps(page.ops);
  ctx.globalAlpha = 1;
}

/** Layout-preserving PDF: every PDF text run is fitted into its original bounding width. */
export function layoutPositioned(source, hand, {paper, size, fitPages, seed, autoPaper=false,natural}) {
  const unknown=new Map(), fallback=new Set(), rngWriter=new Writer(hand,{size,paper,compact:false,seed,natural});
  const cap = Math.max(hand.xh,hand.base-hand.capTop);
  const content=source.map(p=>{
    const nat=rngWriter.nat;
    const ops=[{t:'background',image:nat.table&&p.ruleFree?p.ruleFree:p.image,w:p.width,h:p.height}];
    if(nat.table&&p.ruleFree)for(const l of p.rules||[]){const length=Math.hypot(l.x2-l.x1,l.y2-l.y1),steps=Math.max(2,Math.ceil(length/5)),pts=[];for(let i=0;i<=steps;i++){const t=i/steps,j=rngWriter.jitter.uniform(-.5,.5)*nat.table;pts.push([l.x1+(l.x2-l.x1)*t+(l.x1===l.x2?j:0),l.y1+(l.y2-l.y1)*t+(l.y1===l.y2?j:0)]);}ops.push({t:'line',pts,width:Math.max(.12,Math.min(.45,l.width))});}
    const lines=new Map();
    for(const r of p.runs){
      const chars=toChars(r.text,false,hand.known,unknown,'base',true);
      const f=r.height*.76/cap*Math.min(size,1.15);
      let x=0; const pieces=[];
      const key=Math.round(r.y/.65), line=lines.get(key)||{slope:rngWriter.rng.uniform(-1,1)*nat.slope*r.height*.02,phase:rngWriter.rng.uniform(0,Math.PI*2),origin:r.x};lines.set(key,line);
      for(const c of chars){
        if(c[0]===' '){x+=hand.xh*f*(.7+rngWriter.rng.uniform(-.3,.3)*nat.spacing);continue;}
        if(!hand.known.has(c[0]))fallback.add(c[0]);
        const pl=rngWriter.plan(c,f*(1+rngWriter.rng.uniform(-.18,.18)*nat.scale));
        for(const {op,dx,top} of pl.pieces)pieces.push({...op,x:x+dx,y:top-hand.base*f+line.slope*(r.x+x-line.origin)+nat.wave*r.height*.25*Math.sin((r.x+x)/12+line.phase)+rngWriter.jitter.uniform(-1,1)*nat.vertical*r.height*.25,angle:rngWriter.jitter.uniform(-8,8)*nat.rotation*Math.PI/180,alpha:rngWriter.jitter.uniform(.88,1)});
        x+=pl.adv+hand.xh*f*(.15+rngWriter.rng.uniform(-.13,.13)*nat.spacing);
      }
      const sx=r.width>0&&x>0?Math.min(1.15,r.width/x):1;
      ops.push({t:'group',x:r.x,y:r.y,angle:r.angle,sx,sy:1,ops:pieces});
    }
    return {ops,width:p.width,height:p.height};
  });
  if(!content.length)throw Error("Keine Quellseiten vorhanden.");
  fitPages=Math.max(0,Math.floor(Number(fitPages)||0));
  const n=fitPages?Math.min(fitPages,content.length):content.length;
  let minScale=Infinity;
  const pages=[];
  for(let k=0;k<n;k++){
    const items=content.slice(Math.floor(k*content.length/n),Math.floor((k+1)*content.length/n));
    const dimensions=autoPaper&&!fitPages?[items[0].width,items[0].height]:PAPER[paper];
    const [W,H]=dimensions; const pad=fitPages?3:items.length>1?3:0; let grid=null;
    for(let cols=1;cols<=items.length;cols++){
      const rows=Math.ceil(items.length/cols),cw=(W-pad*(cols+1))/cols,ch=(H-pad*(rows+1))/rows;
      if(cw<=0||ch<=0)continue;
      const score=items.reduce((a,p)=>a+Math.min(cw/p.width,ch/p.height)**2*p.width*p.height,0);
      if(!grid||score>grid.score)grid={cols,cw,ch,score};
    }
    if(!grid)throw new Error('Too many source pages on a single sheet.');
    const ops=items.map((p,i)=>{
      const f=Math.min(grid.cw/p.width,grid.ch/p.height);minScale=Math.min(minScale,f);
      return {t:'group',x:pad+(i%grid.cols)*(grid.cw+pad)+(grid.cw-p.width*f)/2,y:pad+Math.floor(i/grid.cols)*(grid.ch+pad)+(grid.ch-p.height*f)/2,sx:f,sy:f,ops:p.ops};
    });
    pages.push({dimensions,ops});
  }
  return {pages,unknown,fallback,size,minScale};
}
