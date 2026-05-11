import { useEffect, useState } from "react";
import { scansApi } from "../../lib/scansApi";

/**
 * Thumbnail for a single scan page.
 * Loads a signed URL on mount, applies rotation via CSS transform.
 *
 * Props:
 *   page: { id, page_number, storage_path, rotation, width_px, height_px }
 *   size: 'sm' (80px) | 'md' (140px) | 'lg' (240px) | 'full' (fills parent)
 *   onClick: optional click handler
 *   selected: highlight state
 */
export default function PageThumbnail({ page, size = "md", onClick, selected }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    scansApi.signedUrl(page.storage_path, 3600)
      .then(u => { if (!cancelled) { setUrl(u); setLoading(false); } })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [page.storage_path]);

  const sizeMap = {
    sm:   { box: "w-20 h-20",   page: "text-[10px]" },
    md:   { box: "w-36 h-44",   page: "text-xs" },
    lg:   { box: "w-60 h-72",   page: "text-sm" },
    full: { box: "w-full h-full", page: "text-xs" },
  };
  const s = sizeMap[size] || sizeMap.md;

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
        <div className="absolute inset-0 flex items-center justify-center text-red-400 text-xs p-2 text-center">
          {err}
        </div>
      )}
      {url && !err && (
        <img
          src={url}
          alt={`Page ${page.page_number}`}
          className="w-full h-full object-contain bg-white"
          style={{ transform: `rotate(${page.rotation || 0}deg)`, transition: "transform 200ms" }}
        />
      )}
      {/* Page number badge */}
      <div className={`absolute bottom-1 right-1 bg-stone-800/80 text-white px-1.5 py-0.5 rounded ${s.page} font-bold`}>
        {page.page_number}
      </div>
    </div>
  );
}
