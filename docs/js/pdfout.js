// Minimal PDF writer: one JPEG image per page. Avoids pulling in a PDF library just for output.

const enc = new TextEncoder();

/**
 * @param {{jpeg: Uint8Array, widthPx: number, heightPx: number, widthMm: number, heightMm: number}[]} pages
 * @returns {Blob}
 */
export function jpegPagesToPdf(pages) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body, stream) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}`);
    if (stream) {
      push("\nstream\n");
      push(stream);
      push("\nendstream");
    }
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%âãÏÓ\n");
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  pages.forEach((p, i) => {
    const pageId = pageIds[i];
    const w = (p.widthMm / 25.4) * 72;
    const h = (p.heightMm / 25.4) * 72;
    object(pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`);
    object(pageId + 1,
      `<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    const content = enc.encode(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`);
    object(pageId + 2, `<< /Length ${content.length} >>`, content);
  });

  const xrefAt = length;
  const count = 3 + pages.length * 3;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function canvasToJpeg(canvas, quality = 0.85) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function canvasesToPdf(canvases, widthMm, heightMm, quality) {
  const pages = [];
  for (const c of canvases) {
    pages.push({ jpeg: await canvasToJpeg(c, quality), widthPx: c.width, heightPx: c.height, widthMm, heightMm });
  }
  return jpegPagesToPdf(pages);
}
