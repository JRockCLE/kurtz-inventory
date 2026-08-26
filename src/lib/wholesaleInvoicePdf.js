// Wholesale invoice PDF generator.
//
// Renders a single letter-size PDF for a saved wholesale_order:
//   - Header (business info from invoice_settings)
//   - Invoice #, date
//   - Line items table (only rows with cases_ordered > 0)
//   - Grand total
//   - Footer note

import { qry } from "./hooks";

const M = 36;                  // page margin, points (0.5")
const LINE_H = 14;             // default line height
const H1 = 20;
const H2 = 11;
const SMALL = 9;

async function loadInvoiceContext(orderId) {
  const [orderRows, lines, settingsRows] = await Promise.all([
    qry("wholesale_orders",       { filters: `id=eq.${orderId}`, limit: 1 }),
    qry("wholesale_order_items",  { filters: `order_id=eq.${orderId}`, order: "mfg_name.asc.nullslast,item_name.asc" }),
    qry("invoice_settings",       { filters: "id=eq.1", limit: 1 }),
  ]);
  const order    = orderRows?.[0];
  const settings = settingsRows?.[0] || {};
  if (!order) throw new Error(`Order #${orderId} not found`);
  return { order, lines: lines || [], settings };
}

function fmt$(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `$${v.toFixed(2)}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("logo load failed"));
    img.src = url;
  });
}

function imgToDataUrl(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function generateWholesaleInvoice(orderId) {
  const { jsPDF } = await import("jspdf");
  const { order, lines, settings } = await loadInvoiceContext(orderId);

  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - M * 2;

  // ── Header ──────────────────────────────────────────────────────────
  let y = M;

  // Optional company logo at top-left. Everything below shifts down to
  // avoid overlap. Silently skipped if the URL fails to load (CORS etc).
  if (settings.show_logo_on_invoice && settings.logo_url) {
    try {
      const img = await loadImage(settings.logo_url);
      const dataUrl = imgToDataUrl(img);
      const maxH = 50, maxW = 140;
      const aspect = img.naturalWidth / img.naturalHeight;
      let w = maxW, h = maxW / aspect;
      if (h > maxH) { h = maxH; w = maxH * aspect; }
      pdf.addImage(dataUrl, "PNG", M, y, w, h);
      y += h + 10;
    } catch { /* silently fall through */ }
  }

  // Left: business info
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(H1);
  pdf.text((settings.business_name || "").toUpperCase() || "INVOICE", M, y + H1);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(SMALL);
  let hy = y + H1 + 14;
  const addrLines = [
    settings.address_line1,
    settings.address_line2,
    [settings.city, settings.state, settings.postal_code].filter(Boolean).join(", ").replace(/, (\w{2}) /, ", $1 "),
    settings.phone,
    settings.email,
    settings.website,
  ].filter(Boolean);
  for (const line of addrLines) {
    pdf.text(line, M, hy);
    hy += LINE_H;
  }

  // Right: invoice # + date
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(H2 + 4);
  pdf.text("INVOICE", pageW - M, y + H1, { align: "right" });
  pdf.setFontSize(H2);
  pdf.setFont("helvetica", "normal");
  pdf.text(`#${order.id}`, pageW - M, y + H1 + 16, { align: "right" });
  pdf.setFontSize(SMALL);
  pdf.text(fmtDate(order.created_at), pageW - M, y + H1 + 30, { align: "right" });

  y = Math.max(hy, y + H1 + 44) + 10;

  // Divider
  pdf.setDrawColor(40);
  pdf.setLineWidth(1);
  pdf.line(M, y, pageW - M, y);
  y += 14;

  // ── Bill To block ──────────────────────────────────────────────────
  if (order.customer_name) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(SMALL);
    pdf.setTextColor(100);
    pdf.text("BILL TO", M, y);
    pdf.setTextColor(0);
    y += 12;
    pdf.setFontSize(H2);
    pdf.text(order.customer_name, M, y);
    y += 12;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(SMALL);
    if (order.customer_address) {
      for (const line of String(order.customer_address).split("\n")) {
        pdf.text(line, M, y);
        y += LINE_H - 2;
      }
    }
    if (order.customer_phone) { pdf.text(order.customer_phone, M, y); y += LINE_H - 2; }
    if (order.customer_email) { pdf.text(order.customer_email, M, y); y += LINE_H - 2; }
    y += 6;
  }

  // ── Line items ──────────────────────────────────────────────────────
  const rows = lines.filter(l => (l.cases_ordered || 0) > 0);

  // Column layout (widths in points). Description flexes to fill remaining.
  const MFG_W = 100, QTY_W = 55, PRICE_W = 70, TOTAL_W = 80;
  const cols = [
    { key: "mfg",   label: "Mfg",          width: MFG_W, align: "left"  },
    { key: "name",  label: "Description",  width: contentW - MFG_W - QTY_W - PRICE_W - TOTAL_W, align: "left"  },
    { key: "qty",   label: "Cases",        width: QTY_W,   align: "right" },
    { key: "price", label: "Case Price",   width: PRICE_W, align: "right" },
    { key: "total", label: "Total",        width: TOTAL_W, align: "right" },
  ];

  const drawHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(SMALL);
    pdf.setFillColor(240);
    pdf.rect(M, y - 10, contentW, 18, "F");
    let x = M;
    for (const c of cols) {
      const tx = c.align === "right" ? x + c.width - 4 : x + 4;
      pdf.text(c.label, tx, y + 2, { align: c.align });
      x += c.width;
    }
    y += 14;
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.5);
    pdf.line(M, y - 2, pageW - M, y - 2);
    y += 4;
  };

  drawHeader();

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(SMALL);

  let total = 0;
  const rowH = 16;
  for (const line of rows) {
    if (y + rowH > pageH - M - 60) {  // leave room for total + footer
      pdf.addPage("letter", "portrait");
      y = M;
      drawHeader();
    }
    const lineTotal = Number(line.line_total) || (Number(line.cases_ordered) * Number(line.case_price));
    total += lineTotal;

    let x = M;
    for (const c of cols) {
      let val = "";
      switch (c.key) {
        case "mfg":   val = line.mfg_name || ""; break;
        case "name":  val = line.item_name || ""; break;
        case "qty":   val = String(line.cases_ordered || 0); break;
        case "price": val = fmt$(line.case_price); break;
        case "total": val = fmt$(lineTotal); break;
      }
      const tx = c.align === "right" ? x + c.width - 4 : x + 4;
      // Truncate mfg / description if it overflows its column
      if ((c.key === "name" || c.key === "mfg") && pdf.getTextWidth(val) > c.width - 8) {
        while (val.length > 4 && pdf.getTextWidth(val + "…") > c.width - 8) val = val.slice(0, -1);
        val = val + "…";
      }
      pdf.text(val, tx, y + 2, { align: c.align });
      x += c.width;
    }
    y += rowH;
  }

  // ── Total ───────────────────────────────────────────────────────────
  y += 6;
  pdf.setDrawColor(40);
  pdf.setLineWidth(1);
  pdf.line(pageW - M - 200, y, pageW - M, y);
  y += 18;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(H2 + 2);
  pdf.text("TOTAL", pageW - M - 90, y, { align: "right" });
  pdf.text(fmt$(total), pageW - M - 4, y, { align: "right" });

  // ── Footer note ─────────────────────────────────────────────────────
  if (settings.footer_note) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(SMALL);
    pdf.setTextColor(90);
    const wrapped = pdf.splitTextToSize(settings.footer_note, contentW);
    const fy = pageH - M - wrapped.length * LINE_H;
    pdf.text(wrapped, M, fy);
    pdf.setTextColor(0);
  }

  return { pdf, filename: `Invoice-${order.id}.pdf` };
}

/** Download the invoice PDF to the user's machine. */
export async function downloadWholesaleInvoice(orderId) {
  const { pdf, filename } = await generateWholesaleInvoice(orderId);
  pdf.save(filename);
}
