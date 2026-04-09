import { useState, useEffect, useMemo } from "react";
import { useLocalItems, qry } from "../lib/hooks";
import { fmt$, fmtDate, naturalCompare } from "../lib/helpers";

// Measure text width using an offscreen canvas
const _canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function measureText(text, font = "500 14px ui-sans-serif, system-ui, sans-serif") {
  if (!_canvas) return text.length * 8;
  const ctx = _canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}

export default function Items({ data, onEdit, refreshTick = 0 }) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchTimer, setSearchTimer] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);
  const [localTick, setLocalTick] = useState(0);
  const [locMap, setLocMap] = useState({}); // { itemId: [{ location, is_primary }] }

  const handleSearch = (val) => {
    setSearchInput(val);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => { setSearch(val); setPage(0); }, 300));
  };

  const { items: rawItems, total, loading, pageSize } = useLocalItems({
    search, sortBy, sortDir, page, refreshTick: refreshTick + localTick,
  });

  // Client-side natural sort for warehouse_location (server can't do natural sort)
  const items = useMemo(() => {
    if (sortBy !== "warehouse_location") return rawItems;
    const sorted = [...rawItems].sort((a, b) => naturalCompare(a.warehouse_location, b.warehouse_location));
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [rawItems, sortBy, sortDir]);

  const totalPages = Math.ceil(total / pageSize);

  // Calculate dynamic Name column width: 110% of average of top 25% widest names
  const nameColWidth = useMemo(() => {
    if (!items.length) return undefined;
    const widths = items.map(i => measureText(i.name || "", "500 14px ui-sans-serif, system-ui, sans-serif"));
    widths.sort((a, b) => b - a);
    const top25 = widths.slice(0, Math.max(1, Math.ceil(widths.length * 0.25)));
    const avg = top25.reduce((s, w) => s + w, 0) / top25.length;
    return Math.round(avg * 1.1) + 24; // +24 for cell padding
  }, [items]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
    setPage(0);
  };

  const arrow = (col) => sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const ColHead = ({ col, children, className = "" }) => (
    <th className={`px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider cursor-pointer hover:text-stone-700 select-none whitespace-nowrap ${className}`}
      onClick={() => toggleSort(col)}>{children}{arrow(col)}</th>
  );
  const StaticHead = ({ children, className = "" }) => (
    <th className={`px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider whitespace-nowrap ${className}`}>{children}</th>
  );

  const handleDelete = async (e, item) => {
    e.stopPropagation();
    if (!confirm(`Remove "${item.name}" from the system?`)) return;
    await qry("local_items", { update: { active_yn: "N", updated_at: new Date().toISOString() }, match: { id: item.id } });
    setLocalTick(t => t + 1);
  };

  const [whLocDetails, setWhLocDetails] = useState({}); // { label: { section, aisle } }

  // Load warehouse location details (section/aisle) once
  useEffect(() => {
    qry("warehouse_locations", {
      select: "label,section,aisle",
      filters: "active_yn=eq.Y",
      limit: 5000,
    }).then(locs => {
      const m = {};
      locs.forEach(l => { m[l.label] = { section: l.section, aisle: l.aisle }; });
      setWhLocDetails(m);
    }).catch(() => {});
  }, []);

  // Fetch locations for displayed items
  useEffect(() => {
    if (!items.length) { setLocMap({}); return; }
    const ids = items.map(i => i.id).join(",");
    qry("local_item_locations", {
      select: "local_item_id,location,is_primary",
      filters: `local_item_id=in.(${ids})`,
      order: "is_primary.desc,location.asc",
    }).then(locs => {
      const m = {};
      locs.forEach(l => {
        if (!m[l.local_item_id]) m[l.local_item_id] = [];
        m[l.local_item_id].push(l);
      });
      setLocMap(m);
    }).catch(() => setLocMap({}));
  }, [items]);

  const deptMap = Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX]));
  const catMap = Object.fromEntries((data.categories || []).map(c => [c.Category_ID, c.Name_TX]));
  const vendorMap = Object.fromEntries((data.vendors || []).map(v => [v.Vendor_ID, v.Vendor_Name_TX]));
  const unitMap = Object.fromEntries((data.units || []).map(u => [u.Unit_ID, u.Unit_Name_TX]));

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-stone-800">Warehouse Items</h2>
          <span className="text-xs text-stone-400">
            {total.toLocaleString()} items{totalPages > 1 && ` • Page ${page + 1} of ${totalPages.toLocaleString()}`}
          </span>
        </div>
        <div className="relative max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">🔍</span>
          <input type="text" placeholder="Search by name or UPC..." value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-700 text-white text-[10px] font-bold uppercase tracking-wider">
              <th colSpan={5} className="px-2 py-1 text-left border-r border-stone-500/50">Item Info</th>
              <th colSpan={2} className="px-2 py-1 text-left border-r border-stone-500/50">Categorization</th>
              <th colSpan={4} className="px-2 py-1 text-left border-r border-stone-500/50">Location</th>
              <th colSpan={3} className="px-2 py-1 text-left border-r border-stone-500/50">Pricing &amp; Stock</th>
              <th className="px-2 py-1 text-center w-[35px]"></th>
              <th className="bg-stone-700"></th>
            </tr>
            <tr className="bg-stone-100 border-b border-stone-300">
              <ColHead col="upc" className="text-left w-[130px]">UPC</ColHead>
              <ColHead col="mfg_id" className="text-left w-[120px]">Mfg</ColHead>
              <th className="px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider cursor-pointer hover:text-stone-700 select-none whitespace-nowrap text-left"
                style={nameColWidth ? { width: nameColWidth } : undefined}
                onClick={() => toggleSort("name")}>Name{arrow("name")}</th>
              <ColHead col="size" className="text-left w-[60px]">Size</ColHead>
              <ColHead col="ref_unit_cd" className="text-left w-[50px] border-r border-stone-200">Unit</ColHead>
              <ColHead col="dept_id" className="text-left w-[90px]">Dept</ColHead>
              <ColHead col="category_id" className="text-left w-[100px] border-r border-stone-200">Category</ColHead>
              <ColHead col="warehouse_location" className="text-left w-[80px]">WH Loc</ColHead>
              <StaticHead className="text-left w-[70px]">Section</StaticHead>
              <StaticHead className="text-left w-[70px]">Aisle</StaticHead>
              <ColHead col="store_location" className="text-left w-[80px] border-r border-stone-200">Store Loc</ColHead>
              <ColHead col="retail_price" className="text-center w-[65px]">Price</ColHead>
              <ColHead col="cases_on_hand" className="text-center w-[55px]">Cases</ColHead>
              <ColHead col="expiration_date" className="text-center w-[70px] border-r border-stone-200">Exp</ColHead>
              <StaticHead className="text-center w-[35px]"></StaticHead>
              <th className="bg-stone-100"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="px-4 py-8 text-center text-stone-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={16} className="px-4 py-12 text-center text-stone-400">
                {search ? "No items match your search" : "No items in the system yet. Use the Receiving tab to add items."}
              </td></tr>
            ) : (
              items.map((item, i) => {
                const qty = item.cases_on_hand || 0;
                const isLow = qty > 0 && qty <= 5;
                const isExpired = item.expiration_date && new Date(item.expiration_date) < new Date();
                const mfgRaw = item._mfg_name || vendorMap[item.mfg_id] || "—";
                const mfgShort = mfgRaw.length > 16 ? mfgRaw.slice(0, 14) + "…" : mfgRaw;

                return (
                  <tr key={item.id} onClick={() => onEdit?.(item)}
                    className={`border-b border-stone-100 hover:bg-amber-50/70 transition-colors cursor-pointer ${i % 2 ? "bg-stone-50/40" : "bg-white"}`}>
                    <td className="px-3 py-1.5 text-[11px] text-stone-500 font-mono truncate">{item.upc || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate" title={mfgRaw}>{mfgShort}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-stone-800 truncate max-w-[300px]" title={item.name}>{item.name}</div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-500">{item.size || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 border-r border-stone-100">{(item.ref_unit_cd && unitMap[item.ref_unit_cd]) || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate">{(item.dept_id && deptMap[item.dept_id]) || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate border-r border-stone-100">{(item.category_id && catMap[item.category_id]) || "—"}</td>
                    {(() => {
                      const locs = locMap[item.id];
                      const primaryLabel = locs?.length
                        ? (locs.find(l => l.is_primary)?.location || locs[0].location)
                        : item.warehouse_location;
                      const extra = (locs?.length || 0) - 1;
                      const detail = primaryLabel ? whLocDetails[primaryLabel] : null;
                      return (
                        <>
                          <td className="px-3 py-1.5 text-xs font-medium text-amber-700">
                            {primaryLabel || "—"}{extra > 0 && <span className="text-stone-400 font-normal ml-1" title={locs.map(l => l.location).join(", ")}>+{extra}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-stone-500">{detail?.section || "—"}</td>
                          <td className="px-3 py-1.5 text-xs text-stone-500">{detail?.aisle || "—"}</td>
                        </>
                      );
                    })()}
                    <td className="px-3 py-1.5 text-xs text-stone-500 border-r border-stone-100">{item.store_location || "—"}</td>
                    <td className="px-3 py-1.5 text-center text-stone-600 tabular-nums text-xs">{item.retail_price ? fmt$(item.retail_price) : "—"}</td>
                    <td className={`px-3 py-1.5 text-center font-bold tabular-nums ${isLow ? "text-red-600" : qty > 0 ? "text-stone-700" : "text-stone-300"}`}>{qty || "—"}</td>
                    <td className={`px-3 py-1.5 text-center text-[11px] tabular-nums border-r border-stone-100 ${isExpired ? "text-red-600 font-bold" : "text-stone-500"}`}>{fmtDate(item.expiration_date)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={(e) => handleDelete(e, item)} className="text-stone-300 hover:text-red-500 transition-colors text-xs" title="Remove">✕</button>
                    </td>
                    <td></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="bg-white border-t border-stone-200 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1.5 text-sm rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">⟨⟨ First</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 text-sm rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">← Prev</button>
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, idx) => {
              let p; if (totalPages <= 7) p = idx; else if (page < 3) p = idx; else if (page > totalPages - 4) p = totalPages - 7 + idx; else p = page - 3 + idx;
              return <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 text-xs rounded-lg font-medium ${p === page ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>{p + 1}</button>;
            })}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-sm rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">Next →</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1.5 text-sm rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">Last ⟩⟩</button>
          </div>
        </div>
      )}
    </div>
  );
}
