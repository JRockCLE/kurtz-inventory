// Shared PDF generation for scans. Loads each page, bakes rotation +
// vector annotations onto a canvas, then assembles a letter-size PDF with
// per-page orientation. Used by ScanDetail, ComposeEmailModal, and ScanHub.

import { scansApi } from "./scansApi";

const MARGIN = 6;  // pt — tiny breathing room around 8.5×11 scans

export async function composePageForExport(page, imageUrl) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload  = () => resolve(el);
    el.onerror = () => reject(new Error(`Couldn't load page ${page.page_number}`));
    el.src = imageUrl;
  });

  const rot  = ((page.rotation || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const w    = swap ? img.height : img.width;
  const h    = swap ? img.width  : img.height;

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const strokes = page.annotations?.strokes;
  if (strokes && strokes.length) {
    for (const s of strokes) {
      if (!s.points || s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
  }
  return canvas;
}

/** Build the jsPDF document for a scan. Returns the pdf instance. */
async function buildScanPdf(scan) {
  const { jsPDF } = await import("jspdf");
  let pdf;
  for (let i = 0; i < scan.pages.length; i++) {
    const p = scan.pages[i];
    const url = await scansApi.signedUrl(scansApi.visiblePath(p), 3600);
    const composite = await composePageForExport(p, url);
    const dataUrl = composite.toDataURL("image/jpeg", 0.92);
    const orientation = composite.width > composite.height ? "landscape" : "portrait";
    if (i === 0) pdf = new jsPDF({ unit: "pt", format: "letter", orientation });
    else pdf.addPage("letter", orientation);

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW  = pageW - MARGIN * 2;
    const maxH  = pageH - MARGIN * 2;
    const aspect = composite.width / composite.height;
    let drawW = maxW, drawH = maxW / aspect;
    if (drawH > maxH) { drawH = maxH; drawW = maxH * aspect; }
    const offX = (pageW - drawW) / 2;
    const offY = (pageH - drawH) / 2;
    pdf.addImage(dataUrl, "JPEG", offX, offY, drawW, drawH, undefined, "FAST");
  }
  return pdf;
}

export function scanPdfFilename(scan) {
  return `${(scan.title || "scan").replace(/[\/\\?%*:|"<>]/g, "_")}.pdf`;
}

/** Download a scan as a PDF directly to the user's machine. */
export async function downloadScanPdf(scan) {
  const pdf = await buildScanPdf(scan);
  pdf.save(scanPdfFilename(scan));
}

/** Build the scan PDF as a Blob (for email attachment, etc.). */
export async function scanPdfBlob(scan) {
  const pdf = await buildScanPdf(scan);
  return pdf.output("blob");
}
