// Small image toolkit on grayscale buffers: { w, h, data: Uint8Array }.

export function grayFromImageData({ width, height, data }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
  }
  return { w: width, h: height, data: out };
}

/** Area-average downscale to roughly targetW wide. Thin pen strokes wash out, solid squares stay dark. */
export function shrink(img, targetW) {
  const f = Math.max(1, Math.floor(img.w / targetW));
  const w = Math.floor(img.w / f);
  const h = Math.floor(img.h / f);
  const out = new Uint8Array(w * h);
  const area = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.w + x * f;
        for (let dx = 0; dx < f; dx++) sum += img.data[row + dx];
      }
      out[y * w + x] = sum / area;
    }
  }
  return { w, h, data: out, factor: f };
}

export function percentile(data, p) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const target = data.length * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** 4-connected components of mask (1 = on). */
export function components(mask, w, h, keepPixels = false) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    let top = 0;
    stack[top++] = start;
    let area = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    const pixels = keepPixels ? [] : null;
    while (top) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      area++; sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (pixels) pixels.push(i);
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    out.push({ area, cx: sx / area, cy: sy / area, minX, maxX, minY, maxY, pixels });
  }
  return out;
}

function solve(a, b) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) throw new Error("The corner squares are in a line; retake the photo.");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Coefficients mapping output (dst) pixels back to input (src) pixels. */
export function homography(dst, src) {
  const a = [];
  const b = [];
  dst.forEach(([x, y], i) => {
    const [u, v] = src[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  });
  return solve(a, b);
}

export function warp(img, c, outW, outH) {
  const out = new Uint8Array(outW * outH).fill(255);
  const { w, h, data } = img;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const d = c[6] * x + c[7] * y + 1;
      const u = (c[0] * x + c[1] * y + c[2]) / d;
      const v = (c[3] * x + c[4] * y + c[5]) / d;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = u - x0;
      const fy = v - y0;
      const i = y0 * w + x0;
      const top = data[i] + (data[i + 1] - data[i]) * fx;
      const bot = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
      out[y * outW + x] = top + (bot - top) * fy;
    }
  }
  return { w: outW, h: outH, data: out };
}

export function crop(img, x0, y0, x1, y1) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(img.w, x1); y1 = Math.min(img.h, y1);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, data: out };
}

/** Square max filter of radius r (separable). */
export function maxFilter(img, r) {
  const { w, h, data } = img;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, data[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return { w, h, data: out };
}

/** Bounding box of non-zero pixels, or null. */
export function bbox(img) {
  let minX = img.w, minY = img.h, maxX = -1, maxY = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[y * img.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1];
}
