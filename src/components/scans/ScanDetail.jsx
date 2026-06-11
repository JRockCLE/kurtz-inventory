import { useState, useEffect, useCallback } from "react";
import { scansApi } from "../../lib/scansApi";
import PageThumbnail from "./PageThumbnail";
import PageLightbox from "./PageLightbox";
import ComposeEmailModal from "./ComposeEmailModal";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

// Load a page's image + bake its vector strokes + rotation onto a canvas
// at the original image's resolution. Used by Save PDF (and could be used by
// a future "download flattened image" path too).
async function composePageForExport(page, imageUrl) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload  = () => resolve(el);
    el.onerror = () => reject(new Error(`Couldn't load page ${page.page_number}`));
    el.src = imageUrl;
  });

  const rot = ((page.rotation || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const w = swap ? img.height : img.width;
  const h = swap ? img.width  : img.height;

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset

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

/**
 * Detail view of a single scan.
 *
 * Props:
 *   scanId:    string
 *   mode:      'fresh' (right after a New Scan) | 'view' (clicked from the list)
 *   onBack:    () => void     — returns to scan list (data is auto-saved)
 *   onDeleted: () => void     — called after the scan is hard-deleted
 */
export default function ScanDetail({ scanId, mode = "view", onBack, onDeleted }) {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Selected page (for actions)
  const [selectedPageId, setSelectedPageId] = useState(null);

  // Email compose modal
  const [showCompose, setShowCompose] = useState(false);

  // Drag-to-reorder state
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const s = await scansApi.get(scanId);
      if (!s) {
        setErr("Scan not found");
      } else {
        setScan(s);
        setTitleDraft(s.title);
      }
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [scanId]);

  useEffect(() => { load(); }, [load]);

  const saveTitle = async () => {
    if (!titleDraft.trim()) { setTitleDraft(scan.title); setEditingTitle(false); return; }
    if (titleDraft === scan.title) { setEditingTitle(false); return; }
    try {
      await scansApi.update(scanId, { title: titleDraft.trim() });
      setScan(s => ({ ...s, title: titleDraft.trim() }));
      setEditingTitle(false);
    } catch (e) {
      alert(`Failed to update title: ${e.message}`);
    }
  };

  const reorderTo = async (fromIdx, toIdx) => {
    if (fromIdx == null || toIdx == null || fromIdx === toIdx) return;
    if (fromIdx < 0 || fromIdx >= scan.pages.length) return;
    if (toIdx   < 0 || toIdx   >= scan.pages.length) return;
    const ordered = [...scan.pages];
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    // Optimistic update so the UI snaps immediately even before the API responds.
    setScan(s => ({ ...s, pages: ordered.map((p, i) => ({ ...p, page_number: i + 1 })) }));
    setBusy(true);
    try {
      await scansApi.reorderPages(ordered.map(p => p.id));
      await load();
    } catch (e) {
      alert(`Reorder failed: ${e.message}`);
      await load();  // resync on failure
    }
    setBusy(false);
  };

  const discardScan = async () => {
    const verb = mode === "fresh" ? "Discard" : "Delete";
    if (!confirm(`${verb} this scan and all ${scan.page_count} page${scan.page_count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await scansApi.hardDelete(scanId);
      onDeleted();
    } catch (e) {
      alert(`${verb} failed: ${e.message}`);
      setBusy(false);
    }
  };

  const savePdf = async () => {
    setBusy(true);
    try {
      const { jsPDF } = await import("jspdf");

      // Tiny margin so an 8.5×11 scan lands at (basically) full size — letter
      // PDF page is 612×792pt = 8.5×11", so a near-zero margin lets the image
      // fill the page true-to-life. A few points of margin keeps stray
      // edge artifacts off the page boundary.
      const MARGIN = 6;

      let pdf;
      for (let i = 0; i < scan.pages.length; i++) {
        const p = scan.pages[i];
        const url = await scansApi.signedUrl(scansApi.visiblePath(p), 3600);
        const composite = await composePageForExport(p, url);
        const dataUrl = composite.toDataURL("image/jpeg", 0.92);

        // Pick portrait vs landscape per page based on the image's aspect ratio
        const orientation = composite.width > composite.height ? "landscape" : "portrait";

        if (i === 0) {
          pdf = new jsPDF({ unit: "pt", format: "letter", orientation });
        } else {
          pdf.addPage("letter", orientation);
        }

        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const maxW = pageW - MARGIN * 2;
        const maxH = pageH - MARGIN * 2;
        const aspect = composite.width / composite.height;
        let drawW = maxW, drawH = maxW / aspect;
        if (drawH > maxH) { drawH = maxH; drawW = maxH * aspect; }
        const offX = (pageW - drawW) / 2;
        const offY = (pageH - drawH) / 2;

        pdf.addImage(dataUrl, "JPEG", offX, offY, drawW, drawH, undefined, "FAST");
      }

      const filename = `${(scan.title || "scan").replace(/[\/\\?%*:|"<>]/g, "_")}.pdf`;
      pdf.save(filename);
    } catch (e) {
      alert(`PDF export failed: ${e.message}`);
    }
    setBusy(false);
  };

  const printScan = async () => {
    setBusy(true);
    try {
      const urls = await Promise.all(scan.pages.map(p => scansApi.signedUrl(scansApi.visiblePath(p), 3600)));

      const pageHtml = scan.pages.map((p, i) => {
        const rot = p.rotation || 0;
        const strokes = p.annotations?.strokes;
        const overlay = (strokes && strokes.length > 0 && p.width_px && p.height_px) ? `
          <svg viewBox="0 0 ${p.width_px} ${p.height_px}"
               preserveAspectRatio="none"
               style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none">
            ${strokes.map(s => `<polyline
              points="${s.points.map(pt => `${pt.x},${pt.y}`).join(" ")}"
              fill="none" stroke="${s.color}" stroke-width="${s.width}"
              stroke-linecap="round" stroke-linejoin="round" />`).join("")}
          </svg>` : "";
        return `<div class="page">
          <div class="frame" style="transform:rotate(${rot}deg)">
            <img src="${urls[i]}" alt="Page ${p.page_number}">
            ${overlay}
          </div>
        </div>`;
      }).join("");

      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(scan.title)}</title>
<style>
  @page { margin: 0.4in; }
  html, body { margin: 0; padding: 0; background: white; font-family: -apple-system, system-ui, sans-serif; }
  .page { page-break-after: always; display: flex; align-items: center; justify-content: center; min-height: 95vh; }
  .page:last-child { page-break-after: auto; }
  .frame { position: relative; max-width: 100%; max-height: 100vh; display: inline-block; }
  .frame img { display: block; max-width: 100%; max-height: 100vh; object-fit: contain; }
</style></head><body>
${pageHtml}
</body></html>`;

      const w = window.open("", "_blank");
      if (!w) {
        alert("Couldn't open print window. Check your browser's popup blocker.");
        return;
      }
      w.document.write(html);
      w.document.close();
      // Wait for every image to finish loading before triggering print
      const waitAll = () => Promise.all(
        Array.from(w.document.images).map(img =>
          img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })
        )
      );
      // Onload of the printable window may fire before images have begun fetching;
      // give it a tick, then ensure all images are settled.
      w.addEventListener("load", async () => {
        await waitAll();
        w.focus();
        w.print();
      });
    } catch (e) {
      alert(`Print failed: ${e.message}`);
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center bg-stone-50 text-stone-400 text-sm">Loading...</div>;
  }
  if (err || !scan) {
    return (
      <div className="h-full flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-red-700 font-bold mb-2">Couldn't load scan</div>
          <div className="text-sm text-stone-500 mb-4">{err}</div>
          <button onClick={onBack} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold">← Back to scans</button>
        </div>
      </div>
    );
  }

  const selectedPage = scan.pages.find(p => p.id === selectedPageId);

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        {mode === "fresh" ? (
          <button
            onClick={onBack}
            disabled={busy}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
            title="Return to scan list. Your edits are already saved."
          >
            Save Scan
          </button>
        ) : (
          <button
            onClick={onBack}
            disabled={busy}
            className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-50 transition-colors disabled:opacity-50"
          >
            ← Back
          </button>
        )}

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === "Enter") saveTitle();
                else if (e.key === "Escape") { setTitleDraft(scan.title); setEditingTitle(false); }
              }}
              className="w-full px-2 py-1 border border-amber-400 rounded text-base font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="text-base font-bold text-stone-800 hover:text-amber-700 transition-colors text-left truncate w-full"
              title="Click to rename"
            >
              {scan.title}
            </button>
          )}
          <div className="text-xs text-stone-400">
            {scan.page_count} page{scan.page_count === 1 ? "" : "s"} · {scan.total_size_kb} KB
            {scan.scanned_on_pc && ` · ${scan.scanned_on_pc}`}
            {scan.scanned_by_user && ` · ${scan.scanned_by_user}`}
            {" · "}{new Date(scan.created_at).toLocaleString()}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={printScan}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-50"
            title="Print this scan"
          >
            Print
          </button>
          <button
            onClick={savePdf}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-50"
            title="Download as a single PDF file"
          >
            Save PDF
          </button>
          <button
            onClick={() => setShowCompose(true)}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-50"
            title="Email this scan"
          >
            Email
          </button>
          <button
            onClick={discardScan}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {mode === "fresh" ? "Discard" : "Delete"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Pages grid */}
        <div className="flex-1 overflow-auto p-6">
          {scan.pages.length === 0 ? (
            <div className="text-center text-stone-400 py-12">No pages</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {scan.pages.map((page, idx) => {
                const isDragging = draggingIdx === idx;
                const isDropTarget = overIdx === idx && draggingIdx != null && draggingIdx !== idx;
                return (
                  <div
                    key={page.id}
                    draggable={!busy}
                    onDragStart={(e) => {
                      setDraggingIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                      // Some browsers need any data set for drag to start
                      try { e.dataTransfer.setData("text/plain", String(page.id)); } catch { /* no-op */ }
                    }}
                    onDragEnd={() => { setDraggingIdx(null); setOverIdx(null); }}
                    onDragOver={(e) => {
                      if (draggingIdx == null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overIdx !== idx) setOverIdx(idx);
                    }}
                    onDragLeave={() => { if (overIdx === idx) setOverIdx(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = draggingIdx;
                      setDraggingIdx(null);
                      setOverIdx(null);
                      if (from != null && from !== idx) reorderTo(from, idx);
                    }}
                    className={`flex flex-col items-center gap-2 rounded-xl p-1 transition-all
                      ${busy ? "" : "cursor-grab active:cursor-grabbing"}
                      ${isDragging ? "opacity-30" : ""}
                      ${isDropTarget ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-stone-50 scale-[1.02]" : ""}
                    `}
                    title="Drag to reorder"
                  >
                    <PageThumbnail
                      page={page}
                      size="md"
                      selected={selectedPageId === page.id}
                      onClick={() => setSelectedPageId(page.id)}
                    />
                    <div className="text-xs text-stone-500 font-medium">Page {page.page_number}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* Full-screen lightbox — opens when a thumbnail is clicked */}
      {selectedPage && (
        <PageLightbox
          pages={scan.pages}
          pageId={selectedPage.id}
          busy={busy}
          onClose={() => setSelectedPageId(null)}
          onChangePage={(newId) => setSelectedPageId(newId)}
          onPageUpdated={(updated) => {
            setScan(s => ({ ...s, pages: s.pages.map(p => p.id === updated.id ? { ...p, ...updated } : p) }));
          }}
          onPageDeleted={(deletedId) => {
            setSelectedPageId(null);
            load();  // refetch so page_number renumbering shows
          }}
        />
      )}

      {showCompose && (
        <ComposeEmailModal scan={scan} onClose={() => setShowCompose(false)} />
      )}
    </div>
  );
}
