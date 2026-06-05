import { useState, useEffect, useCallback } from "react";
import { scansApi } from "../../lib/scansApi";
import PageThumbnail from "./PageThumbnail";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * Detail view of a single scan.
 *
 * Props:
 *   scanId:    string
 *   onBack:    () => void     — "Save Scan": returns to scan list (data is auto-saved)
 *   onDeleted: () => void     — called after the scan is hard-deleted
 *   onRescan:  () => void     — discard this scan and start a new one
 */
export default function ScanDetail({ scanId, onBack, onDeleted, onRescan }) {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Selected page (for actions)
  const [selectedPageId, setSelectedPageId] = useState(null);

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

  const rotatePage = async (page, direction = 1) => {
    setBusy(true);
    try {
      const newRot = ((page.rotation || 0) + direction * 90 + 360) % 360;
      await scansApi.updatePage(page.id, { rotation: newRot });
      setScan(s => ({
        ...s,
        pages: s.pages.map(p => p.id === page.id ? { ...p, rotation: newRot } : p),
      }));
    } catch (e) {
      alert(`Rotate failed: ${e.message}`);
    }
    setBusy(false);
  };

  const deletePage = async (page) => {
    if (!confirm(`Delete page ${page.page_number}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await scansApi.deletePage(scanId, page.id, page.storage_path);
      await load();  // refetch — page numbers may have shifted
      setSelectedPageId(null);
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
    setBusy(false);
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

  const movePage = (page, direction) => {
    const idx = scan.pages.findIndex(p => p.id === page.id);
    return reorderTo(idx, idx + direction);
  };

  const discardScan = async () => {
    if (!confirm(`Discard this scan and all ${scan.page_count} page${scan.page_count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await scansApi.hardDelete(scanId);
      onDeleted();
    } catch (e) {
      alert(`Discard failed: ${e.message}`);
      setBusy(false);
    }
  };

  const rescanScan = async () => {
    if (!confirm(`Discard this scan and start a new one? The ${scan.page_count} captured page${scan.page_count === 1 ? "" : "s"} will be deleted.`)) return;
    setBusy(true);
    try {
      await scansApi.hardDelete(scanId);
      onRescan?.();
    } catch (e) {
      alert(`Rescan failed: ${e.message}`);
      setBusy(false);
    }
  };

  const printScan = async () => {
    setBusy(true);
    try {
      const urls = await Promise.all(scan.pages.map(p => scansApi.signedUrl(p.storage_path, 3600)));
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(scan.title)}</title>
<style>
  @page { margin: 0.4in; }
  html, body { margin: 0; padding: 0; background: white; font-family: -apple-system, system-ui, sans-serif; }
  .page { page-break-after: always; display: flex; align-items: center; justify-content: center; min-height: 95vh; }
  .page:last-child { page-break-after: auto; }
  .page img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style></head><body>
${scan.pages.map((p, i) => `<div class="page"><img src="${urls[i]}" style="transform:rotate(${p.rotation || 0}deg)" alt="Page ${p.page_number}"></div>`).join("")}
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
        <button
          onClick={onBack}
          disabled={busy}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
          title="Return to scan list. Your edits are already saved."
        >
          ✓ Save Scan
        </button>

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
              <span className="ml-2 text-[10px] text-stone-300 font-normal">✎ rename</span>
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
          {onRescan && (
            <button
              onClick={rescanScan}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-50"
              title="Discard and scan again"
            >
              ↻ Rescan
            </button>
          )}
          <button
            onClick={printScan}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-50"
            title="Print this scan"
          >
            🖨 Print
          </button>
          <button
            disabled
            title="Email — coming soon"
            className="px-3 py-1.5 text-sm bg-stone-100 text-stone-400 rounded-lg cursor-not-allowed"
          >
            ✉ Email
          </button>
          <button
            onClick={discardScan}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            🗑 Discard
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

        {/* Side panel for selected page actions */}
        {selectedPage && (
          <div className="w-72 bg-white border-l border-stone-200 flex flex-col">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <div className="font-bold text-sm text-stone-800">Page {selectedPage.page_number}</div>
              <button
                onClick={() => setSelectedPageId(null)}
                className="text-stone-400 hover:text-stone-700 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto space-y-3">
              <PageThumbnail page={selectedPage} size="lg" />

              <div className="text-xs text-stone-400">
                {selectedPage.width_px} × {selectedPage.height_px} px ·{" "}
                {(selectedPage.size_bytes / 1024).toFixed(1)} KB
              </div>

              <div className="space-y-2 pt-2">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Rotate</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => rotatePage(selectedPage, -1)}
                    disabled={busy}
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-50 transition-colors disabled:opacity-50"
                  >
                    ↺ Left
                  </button>
                  <button
                    onClick={() => rotatePage(selectedPage, 1)}
                    disabled={busy}
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-50 transition-colors disabled:opacity-50"
                  >
                    ↻ Right
                  </button>
                </div>

                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider pt-2">Reorder</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => movePage(selectedPage, -1)}
                    disabled={busy || selectedPage.page_number === 1}
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-50 transition-colors disabled:opacity-30"
                  >
                    ← Move Earlier
                  </button>
                  <button
                    onClick={() => movePage(selectedPage, 1)}
                    disabled={busy || selectedPage.page_number === scan.page_count}
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-50 transition-colors disabled:opacity-30"
                  >
                    Move Later →
                  </button>
                </div>

                <div className="pt-4">
                  <button
                    onClick={() => deletePage(selectedPage)}
                    disabled={busy}
                    className="w-full px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    🗑 Delete Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
