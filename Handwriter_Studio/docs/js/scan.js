// Reads a photographed or scanned template page and cuts out every handwritten character.
// Port of python/fix_orientation.py + python/extract_glyphs.py.

import * as L from "./layout.js";
import { bbox, components, crop, homography, maxFilter, percentile, shrink, warp } from "./imaging.js";

export const PPM = 12; // pixels per mm on the flattened page
const WORK_W = 420;
const SNAP_MM = 1.6;
const INSET_MM = 0.7;
const MIN_SPECK = 10;
const EDGE_BAND_MM = 1.5;
const MAX_SCORE = 0.25;
const FRAME_W = L.MARKER_CENTERS[1][0] - L.MARKER_CENTERS[0][0];
const FRAME_H = L.MARKER_CENTERS[2][1] - L.MARKER_CENTERS[1][1];

// The 8 ways a page can be turned or mirrored, as point maps on a w x h image.
const TRANSFORMS = [
  (x, y) => [x, y],
  (x, y, w, h) => [h - y, x],
  (x, y, w, h) => [w - x, h - y],
  (x, y, w) => [y, w - x],
  (x, y, w) => [w - x, y],
  (x, y, w, h) => [x, h - y],
  (x, y) => [y, x],
  (x, y, w, h) => [h - y, w - x],
];

function orderCorners(pts) {
  const by = (f, max) => pts.reduce((best, p) => ((max ? f(p) > f(best) : f(p) < f(best)) ? p : best));
  return [
    by((p) => p[0] + p[1], false),
    by((p) => p[0] - p[1], true),
    by((p) => p[0] + p[1], true),
    by((p) => p[0] - p[1], false),
  ];
}

function score(markers, ids) {
  const [tl, tr, br, bl] = orderCorners(markers);
  const left = (tl[0] + bl[0]) / 2, right = (tr[0] + br[0]) / 2;
  const top = (tl[1] + tr[1]) / 2, bottom = (bl[1] + br[1]) / 2;
  if (right - left <= 0 || bottom - top <= 0) return Infinity;
  let s = Math.abs((right - left) / (bottom - top) - FRAME_W / FRAME_H);
  const us = ids.map(([x]) => (x - left) / (right - left)).sort((a, b) => a - b);
  us.forEach((u, k) => { s += Math.abs(u - (L.pageIdCenter(k)[0] - L.MARKER_CENTERS[0][0]) / FRAME_W); });
  ids.forEach(([, y]) => { s += Math.abs((y - top) / (bottom - top) - 1); });
  return s / (1 + ids.length);
}

function squareBlobs(small) {
  const bg = percentile(small.data, 0.9);
  const thr = Math.min(140, bg * 0.5);
  const mask = new Uint8Array(small.data.length);
  for (let i = 0; i < mask.length; i++) mask[i] = small.data[i] < thr ? 1 : 0;
  return components(mask, small.w, small.h)
    .filter((c) => {
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      return Math.min(bw, bh) >= 2 && bw / bh > 0.6 && bw / bh < 1.6 && c.area / (bw * bh) > 0.65;
    })
    .sort((a, b) => b.area - a.area);
}

/** Finds the corner squares, the page number and how the page is turned. */
export function locate(small) {
  const blobs = squareBlobs(small);
  let best = null;
  // Try each run of 4 similar-sized squares as the corners (a dark table edge can also look square).
  for (let i = 0; i + 4 <= blobs.length && i < 8; i++) {
    const corners = blobs.slice(i, i + 4);
    if (corners[3].area < corners[0].area / 2.5) continue;
    const ref = corners[1].area;
    const ids = blobs.slice(i + 4).filter((b) => b.area > 0.1 * ref && b.area < 0.5 * ref);
    if (ids.length < 1 || ids.length > L.MAX_PAGES) continue;
    for (const t of TRANSFORMS) {
      const m = corners.map((b) => t(b.cx, b.cy, small.w, small.h));
      const s = score(m, ids.map((b) => t(b.cx, b.cy, small.w, small.h)));
      if (!best || s < best.score) best = { score: s, t, corners, pageNo: ids.length };
    }
  }
  if (!best || best.score > MAX_SCORE) return null;
  // Put the raw corner points in template order (TL, TR, BR, BL) using the winning transform.
  const mapped = best.corners.map((b) => ({ raw: [b.cx, b.cy], t: best.t(b.cx, b.cy, small.w, small.h) }));
  const ordered = orderCorners(mapped.map((m) => m.t)).map((p) => mapped.find((m) => m.t === p).raw);
  return { pageNo: best.pageNo, corners: ordered, score: best.score };
}

function refineCorner(img, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), x1 = Math.min(img.w, Math.round(x + r));
  const y0 = Math.max(0, Math.round(y - r)), y1 = Math.min(img.h, Math.round(y + r));
  let sx = 0, sy = 0, n = 0;
  let lo = 255, hi = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const v = img.data[yy * img.w + xx];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const thr = (lo + hi) / 2;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if (img.data[yy * img.w + xx] < thr) { sx += xx; sy += yy; n++; }
    }
  }
  return n ? [sx / n, sy / n] : [x, y];
}

export function flatten(gray) {
  const small = shrink(gray, WORK_W);
  const found = locate(small);
  if (!found) {
    throw new Error("Couldn't find the 4 black corner squares and the page squares. Make sure the whole sheet is in the photo, flat and evenly lit.");
  }
  const k = small.factor;
  const src = found.corners.map(([x, y]) => refineCorner(gray, x * k + k / 2, y * k + k / 2, 3 * k));
  const dst = L.MARKER_CENTERS.map(([x, y]) => [x * PPM, y * PPM]);
  const flat = warp(gray, homography(dst, src), Math.round(L.PAGE_W * PPM), Math.round(L.PAGE_H * PPM));
  return { pageNo: found.pageNo, flat };
}

function profile(img, x0, y0, x1, y1, alongX) {
  const c = crop(img, x0, y0, x1, y1);
  const n = alongX ? c.w : c.h;
  const out = new Float64Array(n);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) out[alongX ? x : y] += 255 - c.data[y * c.w + x];
  }
  return out;
}

const argmax = (arr) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);

/** Printed box edges near where the template says they are. */
function snap(flat, row, group, variant) {
  const [x0, y0, x1, y1] = L.boxRect(row, group, variant).map((v) => Math.round(v * PPM));
  const s = Math.round(SNAP_MM * PPM);
  const my0 = y0 + 3 * PPM, my1 = y1 - 3 * PPM;
  const mx0 = x0 + 3 * PPM, mx1 = x1 - 3 * PPM;
  return [
    x0 - s + argmax(profile(flat, x0 - s, my0, x0 + s, my1, true)),
    y0 - s + argmax(profile(flat, mx0, y0 - s, mx1, y0 + s, false)),
    x1 - s + argmax(profile(flat, x1 - s, my0, x1 + s, my1, true)),
    y1 - s + argmax(profile(flat, mx0, y1 - s, mx1, y1 + s, false)),
  ];
}

/** Soft ink mask; paper level measured per box so photo shading doesn't matter. */
function inkAlpha(c) {
  const bg = percentile(c.data, 0.9);
  const lo = bg * 0.45, hi = bg * 0.72;
  const out = new Uint8Array(c.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = c.data[i];
    out[i] = v >= hi ? 0 : v <= lo ? 255 : Math.round((255 * (hi - v)) / (hi - lo));
  }
  return { w: c.w, h: c.h, data: out };
}

/** Removes specks, printed box-line leftovers and faint haze away from real strokes. */
function clean(a) {
  const { w, h } = a;
  const data = a.data.slice();
  const strong = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) strong[i] = data[i] >= 90 ? 1 : 0;
  const band = EDGE_BAND_MM * PPM;
  for (const c of components(strong, w, h, true)) {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    const onEdge = c.minX <= 1 || c.minY <= 1 || c.maxX >= w - 2 || c.maxY >= h - 2;
    const lineLike = Math.min(bw, bh) <= 4 && Math.max(bw, bh) > 0.3 * Math.min(w, h);
    const inBand = (c.minY <= 1 && c.maxY < band) || (c.maxY >= h - 2 && c.minY > h - band) ||
      (c.minX <= 1 && c.maxX < band) || (c.maxX >= w - 2 && c.minX > w - band);
    if (c.area < MIN_SPECK || (onEdge && lineLike) || inBand) {
      for (const p of c.pixels) {
        strong[p] = 0;
        const x = p % w, y = (p - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) data[yy * w + xx] = 0;
          }
        }
      }
    }
  }
  const near = maxFilter({ w, h, data: strong.map((v) => v * 255) }, 2);
  for (let i = 0; i < data.length; i++) data[i] = near.data[i] ? data[i] : 0;
  return { w, h, data };
}

/** All glyphs on one flattened page: { char: [glyph, ...] }. */
export function cutGlyphs(flat, pageNo) {
  const chars = L.sheets()[pageNo - 1] || "";
  const out = {};
  const inset = Math.round(INSET_MM * PPM);
  [...chars].forEach((ch, i) => {
    const row = Math.floor(i / L.GROUPS_PER_ROW), group = i % L.GROUPS_PER_ROW;
    for (let v = 0; v < L.VARIANTS; v++) {
      const [left, top, right, bottom] = snap(flat, row, group, v);
      const cb = [left + inset, top + inset, right - inset, bottom - inset];
      const alpha = clean(inkAlpha(crop(flat, ...cb)));
      const b = bbox(alpha);
      if (!b || (b[2] - b[0]) * (b[3] - b[1]) < 12) continue;
      const g = crop(alpha, ...b);
      const baseline = top + ((bottom - top) * L.BASELINE) / L.BOX_H;
      (out[ch] ||= []).push({
        w: g.w, h: g.h, data: g.data,
        wMm: g.w / PPM, hMm: g.h / PPM,
        topMm: (cb[1] + b[1] - baseline) / PPM,
      });
    }
  });
  return out;
}

/** A copy far from both its siblings is usually a stray mark or a one-off form. */
export function dropOddCopies(glyphs, limitMm = 1.8) {
  const dropped = [];
  const dist = (a, b) => Math.max(Math.abs(a.topMm - b.topMm),
    Math.abs(a.topMm + a.hMm - b.topMm - b.hMm), Math.abs(a.wMm - b.wMm));
  for (const [ch, copies] of Object.entries(glyphs)) {
    if (copies.length < 3) continue;
    const off = copies.map((g, i) => Math.min(...copies.filter((_, j) => j !== i).map((o) => dist(g, o))));
    const worst = off.indexOf(Math.max(...off));
    if (off[worst] > limitMm) {
      dropped.push(`${ch} copy ${worst + 1}`);
      copies.splice(worst, 1);
    }
  }
  return dropped;
}
