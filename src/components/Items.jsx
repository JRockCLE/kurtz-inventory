import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocalItems, qry, fetchItemsForNeeds } from "../lib/hooks";
import { fmt$, fmtDate, compareLocation, prefixColorClass } from "../lib/helpers";

// Measure text width using an offscreen canvas
const _canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function measureText(text, font = "500 14px ui-sans-serif, system-ui, sans-serif") {
  if (!_canvas) return text.length * 8;
  const ctx = _canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}

export default function Items({ data, onEdit, onAdd, refreshTick = 0 }) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchTimer, setSearchTimer] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);
  const [productType, setProductType] = useState(null); // null = All
  const [localTick, setLocalTick] = useState(0);
  const [locMap, setLocMap] = useState({}); // { itemId: [{ location, is_primary }] }
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [printItems, setPrintItems] = useState(null); // { items, sortLabel }
  const [printLoading, setPrintLoading] = useState(false);

  const handleSearch = (val) => {
    setSearchInput(val);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => { setSearch(val); setPage(0); }, 300));
  };

  const { items, total, loading, pageSize } = useLocalItems({
    search, sortBy, sortDir, page, productType, refreshTick: refreshTick + localTick,
  });

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

  const deptMap = Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX]));
  const catMap = Object.fromEntries((data.categories || []).map(c => [c.Category_ID, c.Name_TX]));
  const unitMap = Object.fromEntries((data.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX]));

  const preparePrint = useCallback(async (sortOption) => {
    setPrintLoading(true);
    setShowPrintMenu(false);
    try {
      let allItems = await fetchItemsForNeeds();
      if (productType) allItems = allItems.filter(i => i.product_type === productType);

      // Sort based on option
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      switch (sortOption) {
        case "dept":
          allItems.sort((a, b) => {
            const da = (a.dept_id ? deptMap[a.dept_id] : null) || "zzz";
            const db = (b.dept_id ? deptMap[b.dept_id] : null) || "zzz";
            return da.localeCompare(db)
              || (a._mfg_name || "zzz").localeCompare(b._mfg_name || "zzz")
              || (a.name || "").localeCompare(b.name || "");
          });
          break;
        case "mfg":
          allItems.sort((a, b) => {
            const ma = (a._mfg_name || "zzz").toLowerCase();
            const mb = (b._mfg_name || "zzz").toLowerCase();
            return ma.localeCompare(mb) || (a.name || "").localeCompare(b.name || "");
          });
          break;
        case "wh_loc":
          allItems.sort((a, b) => compareLocation(a.warehouse_location, b.warehouse_location)
            || (a.name || "").localeCompare(b.name || ""));
          break;
        case "store_loc":
          allItems.sort((a, b) => {
            if (!a.store_location && !b.store_location) return 0;
            if (!a.store_location) return 1;
            if (!b.store_location) return -1;
            return collator.compare(a.store_location, b.store_location) || (a.name || "").localeCompare(b.name || "");
          });
          break;
      }

      const labels = { dept: "Department", mfg: "Manufacturer", wh_loc: "Warehouse Location", store_loc: "Store Location" };
      setPrintItems({ items: allItems, sortOption, sortLabel: labels[sortOption] });
      setTimeout(() => { window.print(); }, 300);
    } catch (err) { alert("Error loading items: " + err.message); }
    setPrintLoading(false);
  }, [deptMap, productType]);

  // Fetch locations for displayed items
  useEffect(() => {
    if (!items.length) { setLocMap({}); return; }
    const ids = items.map(i => i.id).join(",");
    qry("local_item_locations", {
      select: "local_item_id,location,is_primary,sort_order",
      filters: `local_item_id=in.(${ids})`,
      order: "sort_order.asc,is_primary.desc,location.asc",
    }).then(locs => {
      const m = {};
      locs.forEach(l => {
        if (!m[l.local_item_id]) m[l.local_item_id] = [];
        m[l.local_item_id].push(l);
      });
      setLocMap(m);
    }).catch(() => setLocMap({}));
  }, [items]);

  const vendorMap = Object.fromEntries((data.vendors || []).map(v => [v.Vendor_ID, v.Vendor_Name_TX]));

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-stone-800">Warehouse Items</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-400">
              {total.toLocaleString()} items{totalPages > 1 && ` • Page ${page + 1} of ${totalPages.toLocaleString()}`}
            </span>
            {onAdd && (
              <button onClick={onAdd}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
                + Add Item
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowPrintMenu(!showPrintMenu)} disabled={printLoading}
                className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200 disabled:opacity-50">
                {printLoading ? "Loading..." : "Print Item List"}
              </button>
              {showPrintMenu && (
                <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPrintMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 uppercase">Sort by...</div>
                  {[
                    { id: "dept", label: "Department" },
                    { id: "mfg", label: "Manufacturer (A-Z)" },
                    { id: "wh_loc", label: "Warehouse Location" },
                    { id: "store_loc", label: "Store Location" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => preparePrint(opt.id)}
                      className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 hover:text-amber-800">
                      {opt.label}
                    </button>
                  ))}
                </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">🔍</span>
            <input type="text" placeholder="Search by name, UPC, or manufacturer…" value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { v: null, label: "All", active: "bg-stone-700 text-white" },
              { v: "dry", label: "Dry", active: "bg-amber-600 text-white" },
              { v: "cooler", label: "Cooler", active: "bg-blue-600 text-white" },
              { v: "freezer", label: "Freezer", active: "bg-green-600 text-white" },
            ].map(c => (
              <button key={c.label} onClick={() => { setProductType(c.v); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${productType === c.v ? c.active : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto print:hidden">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-700 text-white text-[10px] font-bold uppercase tracking-wider">
              <th colSpan={5} className="px-2 py-1 text-left border-r border-stone-500/50">Item Info</th>
              <th colSpan={2} className="px-2 py-1 text-left border-r border-stone-500/50">Categorization</th>
              <th colSpan={2} className="px-2 py-1 text-left border-r border-stone-500/50">Location</th>
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
              <ColHead col="warehouse_location" className="text-left w-[160px]">WH Locations</ColHead>
              <ColHead col="store_location" className="text-left w-[80px] border-r border-stone-200">Store Loc</ColHead>
              <ColHead col="retail_price" className="text-center w-[65px]">Price</ColHead>
              <ColHead col="cases_on_hand" className="text-center w-[55px]">Cases</ColHead>
              <ColHead col="expiration_date" className="text-center w-[70px] border-r border-stone-200">Exp</ColHead>
              <StaticHead className="text-center w-[35px]"></StaticHead>
              <th className="bg-stone-100"></th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-stone-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-stone-400">
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
                      const labels = locs?.length
                        ? locs.map(l => l.location)
                        : (item.warehouse_location ? [item.warehouse_location] : []);
                      return (
                        <td className="px-3 py-1.5 text-xs font-medium truncate" title={labels.join(" ")}>
                          {labels.length === 0 ? "—" : (
                            <span className="inline-flex gap-2">
                              {labels.map((l, k) => <span key={k} className={prefixColorClass(l)}>{l}</span>)}
                            </span>
                          )}
                        </td>
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
        <div className="bg-white border-t border-stone-200 px-4 py-2 flex items-center justify-between print:hidden">
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

      {/* ─── Print-only item list ─── */}
      {printItems && (
        <div className="hidden print:block">
          <div className="px-6 pt-6 pb-2">
            <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
              <div>
                <h1 className="text-xl font-black">KURTZ DISCOUNT GROCERIES</h1>
                <p className="text-sm font-bold">ITEM LIST — Sorted by {printItems.sortLabel}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold">{new Date().toLocaleDateString()}</p>
                <p className="text-xs text-stone-500">{printItems.items.length} items</p>
              </div>
            </div>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead style={{ display: "table-header-group" }}>
              <tr className="border-b-2 border-stone-400 text-[10px] font-bold text-stone-600 uppercase">
                {printItems.sortOption === "wh_loc" && <th className="px-2 py-1.5 text-left whitespace-nowrap">WH Loc</th>}
                {printItems.sortOption === "store_loc" && <th className="px-2 py-1.5 text-left whitespace-nowrap">Store Loc</th>}
                <th className="px-2 py-1.5 text-left">Mfg</th>
                <th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-center whitespace-nowrap">Size/Unit</th>
                <th className="px-2 py-1.5 text-center whitespace-nowrap">U/Case</th>
                <th className="px-2 py-1.5 text-center whitespace-nowrap">Price</th>
                <th className="px-2 py-1.5 text-center whitespace-nowrap">Cases</th>
                {printItems.sortOption !== "wh_loc" && <th className="px-2 py-1.5 text-left whitespace-nowrap">WH Loc</th>}
                {printItems.sortOption !== "store_loc" && <th className="px-2 py-1.5 text-left whitespace-nowrap">Store Loc</th>}
              </tr>
            </thead>
            <tbody>
              {(() => {
                let lastGroup = null;
                const useGroups = printItems.sortOption === "dept" || printItems.sortOption === "mfg";
                return printItems.items.map((item, ii) => {
                  const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
                  let groupHeader = null;

                  if (useGroups) {
                    const currentGroup = printItems.sortOption === "dept"
                      ? ((item.dept_id ? deptMap[item.dept_id] : null) || "Other")
                      : (item._mfg_name || "Unknown");

                    if (currentGroup !== lastGroup) {
                      lastGroup = currentGroup;
                      groupHeader = (
                        <tr key={`g-${ii}`}>
                          <td colSpan={9} className="pt-3 pb-1 px-2 font-bold text-xs uppercase text-stone-800 border-b border-stone-300">
                            {currentGroup}
                          </td>
                        </tr>
                      );
                    }
                  }

                  return [
                    groupHeader,
                    <tr key={`r-${item.id}`} className={ii % 2 ? "bg-stone-50" : ""}>
                      {printItems.sortOption === "wh_loc" && <td className="px-2 py-1 text-stone-800 font-bold border-b border-stone-100 whitespace-nowrap">{item.warehouse_location || "—"}</td>}
                      {printItems.sortOption === "store_loc" && <td className="px-2 py-1 text-stone-800 font-bold border-b border-stone-100 whitespace-nowrap">{item.store_location || "—"}</td>}
                      <td className="px-2 py-1 text-stone-500 border-b border-stone-100">{item._mfg_name || "—"}</td>
                      <td className="px-2 py-1 font-medium text-stone-800 border-b border-stone-100">{item.name}</td>
                      <td className="px-2 py-1 text-center text-stone-500 border-b border-stone-100 whitespace-nowrap">{sizeUnit || "—"}</td>
                      <td className="px-2 py-1 text-center text-stone-500 border-b border-stone-100">{item.case_size || "—"}</td>
                      <td className="px-2 py-1 text-center text-stone-600 border-b border-stone-100">{item.retail_price ? fmt$(item.retail_price) : "—"}</td>
                      <td className="px-2 py-1 text-center font-bold text-stone-700 border-b border-stone-100">{item.cases_on_hand || "—"}</td>
                      {printItems.sortOption !== "wh_loc" && <td className="px-2 py-1 text-amber-700 font-medium border-b border-stone-100 whitespace-nowrap">{item.warehouse_location || "—"}</td>}
                      {printItems.sortOption !== "store_loc" && <td className="px-2 py-1 text-stone-500 border-b border-stone-100 whitespace-nowrap">{item.store_location || "—"}</td>}
                    </tr>,
                  ];
                });
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
