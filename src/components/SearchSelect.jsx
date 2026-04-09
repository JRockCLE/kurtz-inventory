import { useState, useEffect, useRef, useCallback } from "react";

export default function SearchSelect({ value, displayValue, fetchOptions, staticOptions, onSelect, placeholder, id, autoFocus }) {
  const [text, setText] = useState(displayValue || "");
  const [selectedId, setSelectedId] = useState(value || null);
  const [allOpts, setAllOpts] = useState([]);
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const [hlIdx, setHlIdx] = useState(-1);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { setText(displayValue || ""); setSelectedId(value || null); }, [displayValue, value]);

  const loadAll = useCallback(() => {
    if (staticOptions) { setAllOpts(staticOptions); setLoaded(true); return Promise.resolve(staticOptions); }
    if (loaded && allOpts.length) return Promise.resolve(allOpts);
    if (fetchOptions) {
      return fetchOptions("").then(r => { setAllOpts(r); setLoaded(true); return r; }).catch(() => []);
    }
    return Promise.resolve([]);
  }, [fetchOptions, staticOptions, loaded, allOpts]);

  const filterOpts = useCallback((list, search) => {
    if (!search) return list.slice(0, 50);
    const l = search.toLowerCase();
    return list.filter(o => o.label?.toLowerCase().includes(l)).slice(0, 50);
  }, []);

  const showList = useCallback((search = "") => {
    loadAll().then(all => {
      const filtered = filterOpts(all, search);
      setOpts(filtered);
      setOpen(true);
      setHlIdx(-1);
    });
  }, [loadAll, filterOpts]);

  const doSearch = useCallback((val) => {
    if (timer.current) clearTimeout(timer.current);
    if (loaded || staticOptions) {
      const filtered = filterOpts(staticOptions || allOpts, val);
      setOpts(filtered);
      setOpen(true);
      setHlIdx(-1);
    } else if (fetchOptions) {
      timer.current = setTimeout(() => {
        fetchOptions(val || "").then(r => {
          setAllOpts(r); setLoaded(true);
          setOpts(r); setOpen(r.length > 0); setHlIdx(-1);
        });
      }, 150);
    }
  }, [fetchOptions, staticOptions, allOpts, loaded, filterOpts]);

  const pick = (opt) => { setText(opt.label); setSelectedId(opt.value); setOpen(false); onSelect(opt.value, opt.label); };
  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";

  return (
    <div className="relative">
      <input ref={inputRef} id={id} type="text" value={text} autoFocus={autoFocus}
        onChange={e => { const v = e.target.value; setText(v); if (selectedId) { setSelectedId(null); onSelect(null, ""); } doSearch(v); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHlIdx(p => Math.min(p + 1, opts.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHlIdx(p => Math.max(p - 1, -1)); }
          else if (e.key === "Enter") { e.preventDefault(); if (hlIdx >= 0 && opts[hlIdx]) pick(opts[hlIdx]); else if (opts.length === 1) pick(opts[0]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        onFocus={() => showList(selectedId ? "" : text)}
        onBlur={() => setTimeout(() => { setOpen(false); if (!selectedId) { setText(""); onSelect(null, ""); } }, 200)}
        placeholder={placeholder} className={`${ic} ${selectedId ? "border-green-400 bg-green-50/50" : ""}`} />
      {open && opts.length > 0 && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-stone-200 rounded-lg shadow-lg z-[60] max-h-48 overflow-y-auto min-w-full w-max max-w-[400px]">
          {opts.map((opt, idx) => (
            <div key={opt.value} onMouseDown={e => { e.preventDefault(); pick(opt); }}
              className={`px-3 py-1.5 text-sm cursor-pointer whitespace-nowrap ${idx === hlIdx ? "bg-amber-100 text-amber-800" : "text-stone-700 hover:bg-stone-50"}`}>{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
