import { useEffect, useState, useCallback, useRef } from "react";
import { scansApi } from "../../lib/scansApi";

/**
 * Full-screen lightbox for a scan page.
 *
 * The whole experience IS the editor — there's no separate "view" mode. As
 * soon as the lightbox opens, all editing tools (Draw / Crop / Straighten
 * plus their controls) are visible in the header, and Rotate L/R / Delete /
 * Save sit on the right.
 *
 * PageLightbox owns: which page is open, signed-URL fetching, and the
 * API calls. InlineEditor owns: canvas state, tools, dirty tracking,
 * and asks PageLightbox to do API work via callbacks.
 *
 * Props:
 *   pages:        scan.pages[]
 *   pageId:       id of the currently open page
 *   onClose:      () => void
 *   onChangePage: (newId) => void
 *   onPageUpdated: (updatedPage) => void
 *   onPageDeleted: (deletedPageId) => void
 *   busy:         boolean
 */
export default function PageLightbox({
  pages,
  pageId,
  onClose,
  onChangePage,
  onPageUpdated,
  onPageDeleted,
  busy,
}) {
  const page  = pages.find(p => p.id === pageId);
  const idx   = pages.findIndex(p => p.id === pageId);
  const total = pages.length;

  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    scansApi.signedUrl(scansApi.visiblePath(page), 3600)
      .then(u => { if (!cancelled) { setUrl(u); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page?.id, page?.storage_path, page?.edited_storage_path]);

  const onSave = useCallback(async (blob, strokes, dims) => {
    if (!page) return;
    try {
      const newPath = await scansApi.saveEditedPage(page, blob, strokes, dims);
      onPageUpdated?.({
        ...page,
        edited_storage_path: newPath,
        rotation: 0,
        width_px: dims?.width ?? page.width_px,
        height_px: dims?.height ?? page.height_px,
        annotations: strokes && strokes.length > 0 ? { strokes } : null,
      });
    } catch (e) {
      alert(`Save failed: ${e.message}`);
      throw e;
    }
  }, [page, onPageUpdated]);

  const onDelete = useCallback(async () => {
    if (!page) return;
    try {
      const path = page.edited_storage_path || page.storage_path;
      await scansApi.deletePage(page.scan_id, page.id, path);
      if (page.edited_storage_path && page.edited_storage_path !== path) {
        try { await scansApi.resetPageEdits(page); } catch { /* best effort */ }
      }
      onPageDeleted?.(page.id);
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
      throw e;
    }
  }, [page, onPageDeleted]);

  const onReset = useCallback(async () => {
    if (!page?.edited_storage_path) return;
    try {
      await scansApi.resetPageEdits(page);
      onPageUpdated?.({ ...page, edited_storage_path: null });
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
      throw e;
    }
  }, [page, onPageUpdated]);

  if (!page) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-stone-950/95 flex flex-col select-none">
      <InlineEditor
        key={`page-${page.id}`}  // fresh editor state on page change
        imageUrl={url}
        loadingImage={loading}
        initialRotation={page.rotation || 0}
        initialStrokes={page.annotations?.strokes || []}
        currentIdx={idx}
        totalPages={total}
        hasEditedVersion={!!page.edited_storage_path || !!page.annotations}
        busy={busy}
        onBack={onClose}
        onSave={onSave}
        onDelete={onDelete}
        onReset={onReset}
        onPrevPage={idx > 0 ? () => onChangePage(pages[idx - 1].id) : null}
        onNextPage={idx < total - 1 ? () => onChangePage(pages[idx + 1].id) : null}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload  = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't load image"));
    el.src = src;
  });
}

async function bakeRotation(srcUrl, degrees) {
  const img = await loadImage(srcUrl);
  const rot = ((degrees || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const w = swap ? img.height : img.width;
  const h = swap ? img.width  : img.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}

// ═════════════════════════════════════════════════════════════════════════
// InlineEditor — the whole editor experience
// ═════════════════════════════════════════════════════════════════════════

const COLOR_PRESETS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#000000", "#ffffff"];
const WIDTH_PRESETS = [2, 4, 8, 16];

function InlineEditor({
  imageUrl,
  loadingImage,
  initialRotation,
  initialStrokes = [],
  currentIdx,
  totalPages,
  hasEditedVersion,
  busy,
  onBack,
  onSave,
  onDelete,
  onReset,
  onPrevPage,
  onNextPage,
}) {
  const workCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const containerRef = useRef(null);

  const [tool, setTool] = useState("draw");          // 'draw' | 'crop' | 'straighten'
  const [strokes, setStrokes] = useState(initialStrokes);
  const initialStrokesRef = useRef(initialStrokes);
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [width, setWidth] = useState(WIDTH_PRESETS[1]);

  const [cropRect, setCropRect] = useState(null);
  const [straightenDeg, setStraightenDeg] = useState(0);

  // "Dirty" = something has changed since open that would be lost on close.
  // Compared against initial strokes (loaded from saved annotations) so re-opening
  // a page with existing annotations doesn't immediately read as dirty.
  const [canvasModified, setCanvasModified] = useState(false);
  const strokesDirty = strokes !== initialStrokesRef.current;
  const dirty = strokesDirty || canvasModified;

  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const drawingStrokeRef = useRef(null);
  const cropDragRef = useRef(null);

  // ─── Initial load: bake rotation into working canvas ───
  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await bakeRotation(imageUrl, initialRotation);
        if (cancelled) return;
        const work = workCanvasRef.current;
        const overlay = overlayCanvasRef.current;
        work.width = c.width; work.height = c.height;
        overlay.width = c.width; overlay.height = c.height;
        work.getContext("2d").drawImage(c, 0, 0);
        clearOverlay();
        setReady(true);
      } catch (e) {
        alert("Couldn't open page: " + e.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, initialRotation]);

  useEffect(() => {
    if (!ready) return;
    repaintOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, strokes, cropRect, tool, straightenDeg]);

  // Keyboard: Esc closes, ← / → navigate. All gated on dirty-confirm.
  useEffect(() => {
    const handler = (e) => {
      if (e.target?.matches?.("input, textarea, [contenteditable='true']")) return;
      if (saving) return;
      if (e.key === "Escape")    { e.preventDefault(); tryBack(); }
      else if (e.key === "ArrowLeft"  && onPrevPage) { e.preventDefault(); tryPrev(); }
      else if (e.key === "ArrowRight" && onNextPage) { e.preventDefault(); tryNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, onPrevPage, onNextPage]);

  function clearOverlay() {
    const o = overlayCanvasRef.current;
    if (!o) return;
    o.getContext("2d").clearRect(0, 0, o.width, o.height);
  }

  function paintStroke(ctx, stroke) {
    if (!stroke || stroke.points.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth   = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
  }

  function repaintOverlay() {
    const o = overlayCanvasRef.current;
    if (!o) return;
    const ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);

    for (const s of strokes) paintStroke(ctx, s);
    if (drawingStrokeRef.current) paintStroke(ctx, drawingStrokeRef.current);

    if (tool === "crop" && cropRect && cropRect.w > 0 && cropRect.h > 0) {
      const { x, y, w, h } = cropRect;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, o.width, o.height);
      ctx.clearRect(x, y, w, h);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function eventToCanvasXY(e) {
    const canvas = overlayCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  // ─── Drawing handlers ───
  const onPointerDown = (e) => {
    if (!ready || saving) return;
    e.preventDefault();
    overlayCanvasRef.current.setPointerCapture?.(e.pointerId);
    const p = eventToCanvasXY(e);
    if (tool === "draw") {
      drawingStrokeRef.current = { color, width, points: [p] };
      repaintOverlay();
    } else if (tool === "crop") {
      cropDragRef.current = { startX: p.x, startY: p.y };
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };
  const onPointerMove = (e) => {
    if (!ready || saving) return;
    if (tool === "draw" && drawingStrokeRef.current) {
      const p = eventToCanvasXY(e);
      drawingStrokeRef.current.points.push(p);
      repaintOverlay();
    } else if (tool === "crop" && cropDragRef.current) {
      const p = eventToCanvasXY(e);
      const { startX, startY } = cropDragRef.current;
      const x = Math.min(startX, p.x);
      const y = Math.min(startY, p.y);
      const w = Math.abs(p.x - startX);
      const h = Math.abs(p.y - startY);
      setCropRect({ x, y, w, h });
    }
  };
  const onPointerUp = (e) => {
    if (!ready || saving) return;
    overlayCanvasRef.current.releasePointerCapture?.(e.pointerId);
    if (tool === "draw" && drawingStrokeRef.current) {
      const finished = drawingStrokeRef.current;
      drawingStrokeRef.current = null;
      if (finished.points.length > 1) {
        setStrokes(prev => [...prev, finished]);
      } else {
        repaintOverlay();
      }
    } else if (tool === "crop") {
      cropDragRef.current = null;
    }
  };

  const undo = () => setStrokes(prev => prev.slice(0, -1));

  // Stroke coordinate transforms — keep strokes vectorized through every op
  // so they remain individually editable on re-open.
  function transformStrokes(fn) {
    setStrokes(prev => prev
      .map(s => ({ ...s, points: s.points.map(fn).filter(Boolean) }))
      .filter(s => s.points.length > 1));
  }

  // ─── Rotate operates directly on the working canvas; strokes transformed too ───
  function rotate90(direction) {
    if (!ready || saving) return;
    const work = workCanvasRef.current;
    const w0 = work.width, h0 = work.height;

    const tmp = document.createElement("canvas");
    tmp.width = h0; tmp.height = w0;
    const tctx = tmp.getContext("2d");
    tctx.translate(tmp.width / 2, tmp.height / 2);
    tctx.rotate(direction * Math.PI / 2);
    tctx.drawImage(work, -w0 / 2, -h0 / 2);

    work.width = tmp.width; work.height = tmp.height;
    work.getContext("2d").drawImage(tmp, 0, 0);

    const overlay = overlayCanvasRef.current;
    overlay.width = tmp.width; overlay.height = tmp.height;

    // Rotate stroke coordinates around the original image center.
    // Clockwise (dir=1):  (x, y) → (h0 - y, x)
    // Counter-CW (dir=-1): (x, y) → (y, w0 - x)
    transformStrokes(direction === 1
      ? (p) => ({ x: h0 - p.y, y: p.x })
      : (p) => ({ x: p.y,      y: w0 - p.x }));

    setCanvasModified(true);
  }

  // ─── Crop apply ───
  const applyCrop = () => {
    if (!cropRect || cropRect.w < 10 || cropRect.h < 10) {
      setCropRect(null);
      return;
    }
    const work = workCanvasRef.current;
    const { x, y, w, h } = cropRect;

    const tmp = document.createElement("canvas");
    tmp.width = Math.round(w); tmp.height = Math.round(h);
    tmp.getContext("2d").drawImage(work, x, y, w, h, 0, 0, w, h);

    work.width = tmp.width; work.height = tmp.height;
    work.getContext("2d").drawImage(tmp, 0, 0);

    const overlay = overlayCanvasRef.current;
    overlay.width = tmp.width; overlay.height = tmp.height;

    // Strokes: shift into the new coord space; drop points outside the crop.
    transformStrokes((p) => {
      const nx = p.x - x, ny = p.y - y;
      if (nx < 0 || ny < 0 || nx > w || ny > h) return null;
      return { x: nx, y: ny };
    });

    setCropRect(null);
    setCanvasModified(true);
    setTool("draw");
  };

  // ─── Straighten apply ───
  const applyStraighten = () => {
    if (!straightenDeg) { setTool("draw"); return; }
    const work = workCanvasRef.current;

    const θ = (straightenDeg * Math.PI) / 180;
    const w0 = work.width, h0 = work.height;

    const absθ = Math.abs(θ);
    const cosθ = Math.cos(absθ);
    const sinθ = Math.sin(absθ);
    let cropW, cropH;
    if (w0 >= h0) {
      cropW = (w0 * cosθ - h0 * sinθ) / Math.cos(2 * absθ);
      cropH = cropW * (h0 / w0);
    } else {
      cropH = (h0 * cosθ - w0 * sinθ) / Math.cos(2 * absθ);
      cropW = cropH * (w0 / h0);
    }
    cropW = Math.max(50, Math.floor(cropW));
    cropH = Math.max(50, Math.floor(cropH));

    const tmpFull = document.createElement("canvas");
    tmpFull.width = w0; tmpFull.height = h0;
    const tctx = tmpFull.getContext("2d");
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, w0, h0);
    tctx.translate(w0 / 2, h0 / 2);
    tctx.rotate(θ);
    tctx.drawImage(work, -w0 / 2, -h0 / 2);

    const tmpCropped = document.createElement("canvas");
    tmpCropped.width = cropW; tmpCropped.height = cropH;
    tmpCropped.getContext("2d").drawImage(
      tmpFull,
      (w0 - cropW) / 2, (h0 - cropH) / 2, cropW, cropH,
      0, 0, cropW, cropH
    );

    work.width = cropW; work.height = cropH;
    work.getContext("2d").drawImage(tmpCropped, 0, 0);

    const overlay = overlayCanvasRef.current;
    overlay.width = cropW; overlay.height = cropH;

    // Transform strokes: rotate around the original image's center, then shift
    // into the cropped coord space; drop any points that fell outside the crop.
    const cx = w0 / 2, cy = h0 / 2;
    const offsetX = (w0 - cropW) / 2;
    const offsetY = (h0 - cropH) / 2;
    transformStrokes((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      const rx = dx * Math.cos(θ) - dy * Math.sin(θ) + cx;
      const ry = dx * Math.sin(θ) + dy * Math.cos(θ) + cy;
      const nx = rx - offsetX, ny = ry - offsetY;
      if (nx < 0 || ny < 0 || nx > cropW || ny > cropH) return null;
      return { x: nx, y: ny };
    });

    setStraightenDeg(0);
    setCanvasModified(true);
    setTool("draw");
  };

  // ─── Save: upload no-strokes image + persist strokes JSON → close ───
  // Strokes are NOT flattened into the saved image — they live as vector data
  // in `annotations.strokes` so reopening for edit lets you delete/modify them.
  const save = async () => {
    setSaving(true);
    try {
      const work = workCanvasRef.current;
      const blob = await new Promise((res, rej) =>
        work.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")), "image/jpeg", 0.92)
      );
      await onSave(blob, strokes, { width: work.width, height: work.height });
      setCanvasModified(false);
      initialStrokesRef.current = strokes;  // so re-open isn't immediately dirty
      onBack();
    } catch {
      setSaving(false);
    }
  };

  // ─── Dirty-checked actions ───
  const confirmDiscard = () =>
    !dirty || confirm("You have unsaved changes. Discard them and continue?");
  const tryBack = () => { if (confirmDiscard()) onBack(); };
  const tryPrev = () => { if (onPrevPage && confirmDiscard()) onPrevPage(); };
  const tryNext = () => { if (onNextPage && confirmDiscard()) onNextPage(); };

  const tryDelete = async () => {
    if (!confirm("Delete this page? This cannot be undone.")) return;
    try { await onDelete(); } catch { /* alerted */ }
  };
  const tryReset = async () => {
    if (!confirm("Reset this page to the original (unedited) scan? Your edits will be permanently removed.")) return;
    try { await onReset(); } catch { /* alerted */ }
  };

  const isBusy = busy || saving;

  return (
    <>
      {/* Header — tools always visible. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white bg-stone-900/80 border-b border-white/10">
        {/* LEFT: nav + tabs + tool controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={tryBack}
            disabled={isBusy}
            className="px-3 py-1.5 text-sm border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            ← Back
          </button>
          <div className="text-sm font-medium opacity-80 whitespace-nowrap mr-2">
            Page {currentIdx + 1} of {totalPages}
            {hasEditedVersion && <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-200 rounded text-[10px] font-bold uppercase">Edited</span>}
          </div>

          <div className="flex border border-white/20 rounded-lg overflow-hidden">
            {[
              { id: "draw", label: "Draw" },
              { id: "crop", label: "Crop" },
              { id: "straighten", label: "Straighten" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                disabled={isBusy}
                className={`px-3 py-1.5 text-sm transition-colors ${tool === t.id ? "bg-amber-500 text-stone-900 font-bold" : "text-white hover:bg-white/10"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tool === "draw" && (
            <div className="flex items-center gap-2 ml-2">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? "border-amber-400 scale-110" : "border-white/30"}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-7 h-7 rounded border border-white/30 bg-transparent cursor-pointer"
                title="Custom color"
              />
              <div className="flex border border-white/20 rounded-lg overflow-hidden ml-1">
                {WIDTH_PRESETS.map(w => (
                  <button
                    key={w}
                    onClick={() => setWidth(w)}
                    className={`w-9 h-7 flex items-center justify-center transition-colors ${width === w ? "bg-amber-500 text-stone-900" : "text-white hover:bg-white/10"}`}
                    title={`${w}px`}
                  >
                    <span className="rounded-full bg-current" style={{ width: Math.min(w, 14), height: Math.min(w, 14) }} />
                  </button>
                ))}
              </div>
              <button
                onClick={undo}
                disabled={strokes.length === 0 || isBusy}
                className="px-3 py-1.5 text-sm border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 ml-1 transition-colors"
              >
                Undo
              </button>
            </div>
          )}

          {tool === "crop" && (
            <div className="flex items-center gap-2 ml-2 text-sm text-white/80">
              <span>Drag to select an area</span>
              <button
                onClick={applyCrop}
                disabled={!cropRect || cropRect.w < 10 || cropRect.h < 10 || isBusy}
                className="px-3 py-1.5 border border-amber-400 text-amber-300 rounded-lg hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
              >
                Apply Crop
              </button>
              <button
                onClick={() => setCropRect(null)}
                disabled={!cropRect || isBusy}
                className="px-3 py-1.5 border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          {tool === "straighten" && (
            <div className="flex items-center gap-3 ml-2 text-sm text-white/80">
              <span className="whitespace-nowrap">Angle: {straightenDeg.toFixed(1)}°</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.1}
                value={straightenDeg}
                onChange={e => setStraightenDeg(parseFloat(e.target.value))}
                disabled={isBusy}
                className="w-48 accent-amber-500"
              />
              <button
                onClick={applyStraighten}
                disabled={!straightenDeg || isBusy}
                className="px-3 py-1.5 border border-amber-400 text-amber-300 rounded-lg hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => setStraightenDeg(0)}
                disabled={!straightenDeg || isBusy}
                className="px-3 py-1.5 border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: rotate + delete + (reset) + save */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => rotate90(-1)}
            disabled={isBusy || !ready}
            className="px-3 py-1.5 text-sm border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            Rotate Left
          </button>
          <button
            onClick={() => rotate90(1)}
            disabled={isBusy || !ready}
            className="px-3 py-1.5 text-sm border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            Rotate Right
          </button>
          {hasEditedVersion && (
            <button
              onClick={tryReset}
              disabled={isBusy}
              className="px-3 py-1.5 text-sm border border-white/20 rounded-lg hover:bg-white/10 disabled:opacity-40 transition-colors"
              title="Discard edits and restore the original scan"
            >
              Reset to Original
            </button>
          )}
          <button
            onClick={tryDelete}
            disabled={isBusy}
            className="px-3 py-1.5 text-sm border border-red-400/40 text-red-300 rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors"
          >
            Delete Page
          </button>
          <button
            onClick={save}
            disabled={!dirty || isBusy || !ready}
            className="px-4 py-2 bg-amber-500 text-stone-900 rounded-lg text-sm font-bold hover:bg-amber-400 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Stage */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden flex items-center justify-center p-6">
        {loadingImage || !ready ? (
          <div className="absolute text-white/60 text-sm">Loading…</div>
        ) : null}

        {/* Prev / next side arrows */}
        {onPrevPage && (
          <button
            onClick={tryPrev}
            disabled={isBusy}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl font-bold flex items-center justify-center transition-colors disabled:opacity-30 z-10"
            title="Previous page (←)"
          >
            ‹
          </button>
        )}
        {onNextPage && (
          <button
            onClick={tryNext}
            disabled={isBusy}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl font-bold flex items-center justify-center transition-colors disabled:opacity-30 z-10"
            title="Next page (→)"
          >
            ›
          </button>
        )}

        <div
          className="relative max-w-full max-h-full"
          style={{
            transform: tool === "straighten" ? `rotate(${straightenDeg}deg)` : undefined,
            transition: tool === "straighten" ? "transform 80ms" : undefined,
          }}
        >
          <canvas
            ref={workCanvasRef}
            className="block max-w-full max-h-[calc(100vh-140px)] object-contain bg-white shadow-2xl"
          />
          <canvas
            ref={overlayCanvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ touchAction: "none" }}
            className={`absolute inset-0 w-full h-full ${tool === "draw" ? "cursor-crosshair" : tool === "crop" ? "cursor-crosshair" : "cursor-default"}`}
          />
        </div>

        {/* Straightening grid — axis-aligned, stays still while image rotates */}
        {tool === "straighten" && (
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(245, 158, 11, 0.55) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(245, 158, 11, 0.55) 1px, transparent 1px),
                linear-gradient(to right, rgba(255, 255, 255, 0.25) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.25) 1px, transparent 1px)
              `,
              backgroundSize: "50% 50%, 50% 50%, 10% 10%, 10% 10%",
              backgroundPosition: "center, center, top left, top left",
            }}
          />
        )}
      </div>
    </>
  );
}
