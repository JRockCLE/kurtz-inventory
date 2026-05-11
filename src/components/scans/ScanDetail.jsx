import { useState, useEffect, useCallback } from "react";
import { scansApi } from "../../lib/scansApi";
import PageThumbnail from "./PageThumbnail";

/**
 * Detail view of a single scan.
 *
 * Props:
 *   scanId: string
 *   onBack: () => void
 *   onDeleted: () => void  — called after the whole scan is deleted
 */
export default function ScanDetail({ scanId, onBack, onDeleted }) {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Selected page (for actions)
  const [selectedPageId, setSelectedPageId] = useState(null);

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

  const movePage = async (page, direction) => {
    const idx = scan.pages.findIndex(p => p.id === page.id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= scan.pages.length) return;
    setBusy(true);
    try {
      const ordered = [...scan.pages];
      const [moved] = ordered.splice(idx, 1);
      ordered.splice(newIdx, 0, moved);
      await scansApi.reorderPages(ordered.map(p => p.id));
      await load();
    } catch (e) {
      alert(`Reorder failed: ${e.message}`);
    }
    setBusy(false);
  };

  const deleteScan = async () => {
    if (!confirm(`Delete this entire scan and all ${scan.page_count} pages? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await scansApi.hardDelete(scanId);
      onDeleted();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
      setBusy(false);
    }
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
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800 transition-colors">
          ← Back
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
            </button>
          )}
          <div className="text-xs text-stone-400">
            {scan.page_count} page{scan.page_count === 1 ? "" : "s"} · {scan.total_size_kb} KB
            {scan.scanned_on_pc && ` · ${scan.scanned_on_pc}`}
            {scan.scanned_by_user && ` · ${scan.scanned_by_user}`}
            {" · "}{new Date(scan.created_at).toLocaleString()}
          </div>
        </div>
        <button
          disabled
          title="Email — coming soon"
          className="px-3 py-1.5 text-sm bg-stone-100 text-stone-400 rounded-lg cursor-not-allowed"
        >
          ✉ Email
        </button>
        <button
          onClick={deleteScan}
          disabled={busy}
          className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          🗑 Delete Scan
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Pages grid */}
        <div className="flex-1 overflow-auto p-6">
          {scan.pages.length === 0 ? (
            <div className="text-center text-stone-400 py-12">No pages</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {scan.pages.map(page => (
                <div key={page.id} className="flex flex-col items-center gap-2">
                  <PageThumbnail
                    page={page}
                    size="md"
                    selected={selectedPageId === page.id}
                    onClick={() => setSelectedPageId(page.id)}
                  />
                  <div className="text-xs text-stone-500 font-medium">Page {page.page_number}</div>
                </div>
              ))}
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
