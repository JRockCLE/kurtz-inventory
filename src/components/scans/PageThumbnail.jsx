import { useEffect, useRef, useState } from "react";
import { scansApi } from "../../lib/scansApi";

/**
 * Thumbnail for a single scan page.
 *
 * Renders the underlying image, plus an SVG-stroke overlay for any saved
 * vector annotations (so users see their drawings in the grid + cards without
 * having to open the lightbox).
 *
 * Props:
 *   page: { id, page_number, storage_path, edited_storage_path, rotation,
 *           width_px, height_px, annotations? }
 *   size: 'sm' | 'md' | 'lg' | 'full'
 *   onClick, selected
 */
export default function PageThumbnail({ page, size = "md", onClick, selected }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const path = scansApi.visiblePath(page);
    scansApi.signedUrl(path, 3600)
      .then(u => { if (!cancelled) { setUrl(u); setLoading(false); } })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [page.storage_path, page.edited_storage_path]);

  const sizeMap = {
    sm:   { box: "w-20 h-20",     page: "text-[10px]" },
    md:   { box: "w-36 h-44",     page: "text-xs" },
    lg:   { box: "w-60 h-72",     page: "text-sm" },
    full: { box: "w-full h-full", page: "text-xs" },
  };
  const s = sizeMap[size] || sizeMap.md;

  const strokes = page.annotations?.strokes;
  const hasStrokes = strokes && strokes.length > 0;
  const rotation = page.rotation || 0;

  return (
    <div
      onClick={onClick}
      className={`relative ${s.box} bg-stone-100 border ${
        selected ? "border-amber-500 ring-2 ring-amber-300" : "border-stone-300"
      } rounded-lg overflow-hidden ${onClick ? "cursor-pointer hover:border-amber-400" : ""} transition-colors`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-xs">Loading...</div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 text-xs p-2 text-center">{err}</div>
      )}
      {url && !err && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${rotation}deg)`, transition: "transform 200ms" }}
        >
          {/* Image + strokes share a single positioned wrapper so they scale together. */}
          <div className="relative max-w-full max-h-full">
            <img
              src={url}
              alt={`Page ${page.page_number}`}
              className="block max-w-full max-h-full object-contain bg-white"
              draggable={false}
            />
            {hasStrokes && (
              <StrokeOverlay
                strokes={strokes}
                imageWidth={page.width_px || 1}
                imageHeight={page.height_px || 1}
              />
            )}
          </div>
        </div>
      )}
      {/* Page number badge */}
      <div className={`absolute bottom-1 right-1 bg-stone-800/80 text-white px-1.5 py-0.5 rounded ${s.page} font-bold z-10`}>
        {page.page_number}
      </div>
    </div>
  );
}

/**
 * SVG overlay positioned exactly over the image — CSS-scaled by the parent box,
 * with a viewBox matching the image's intrinsic pixel dimensions so stroke
 * coordinates (which are in image pixels) line up regardless of display size.
 */
function StrokeOverlay({ strokes, imageWidth, imageHeight }) {
  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      className="absolute inset-0 w-full h-full pointer-events-none"
      preserveAspectRatio="none"
    >
      {strokes.map((s, i) => (
        <polyline
          key={i}
          points={s.points.map(p => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
