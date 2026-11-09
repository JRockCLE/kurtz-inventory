import { useState, useEffect, useCallback, useMemo } from "react";
import {
  qry, SB_URL, SB_KEY,
  addItemStoreLocation,
  searchStockRoomLocations,
} from "../lib/hooks";
import SearchSelect from "./SearchSelect";

// ─── Needs Stock Room Locations task ─────────────────────────────────
// Grid of items missing a store (stock room) location so the user can
// bulk-fill them inline. Mirrors the Needs Locations task page but for
// `store_location` instead of `warehouse_location`.
//
// Columns: UPC, Mfg, Name, Size, Unit, SR Location.
// Picking a location writes `local_items.store_location` (cached primary)
// AND inserts a row into `local_item_store_locations` as the primary.

const SORT_FIELDS = {
  _mfg_name:  i => (i._mfg_name || "").toLowerCase(),
  name:       i => (i.name || "").toLowerCase(),
  size:       i => (i.size || "").toLowerCase(),
  upc:        i => i.upc || "",
  created_at: i => new Date(i.created_at).getTime(),
};

export default function NeedsStockRoomLocations({ data }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState(null); // null = All
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  const unitMap = useMemo(
    () => Object.fromEntries((data?.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX])),
    [data?.units]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await qry("local_items", {
        select: "id,upc,name,size,product_type,mfg_id,ref_unit_cd,created_at,warehouse_location,store_location,active_yn",
        filters: "active_yn=eq.Y&store_location=is.null",
        order: "created_at.desc",
        limit: 2000,
      });

      // Resolve manufacturer names (same pattern as NeedsLocations).
      const mfgIds = [...new Set(rows.map(i => i.mfg_id).filter(Boolean))];
      if (mfgIds.length) {
        try {
          const res = await fetch(
            `${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`,
            { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "posbe" } }
          );
          const mfgs = await res.json();
          const map = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
          rows.forEach(i => { i._mfg_name = map[String(i.mfg_id)] || ""; });
        } catch { /* ignore */ }
      }

      setItems(rows);
    } catch (err) {
      console.error(err);
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (item, loc) => {
    const trimmed = loc?.trim();
    if (!trimmed) return;
    setSavingId(item.id);
    try {
      try { await addItemStoreLocation(item.id, trimmed, true, 0); } catch { /* dup */ }
      await qry("local_items", {
        update: { store_location: trimmed, updated_at: new Date().toISOString() },
        match: { id: item.id },
      });
      // Drop the row — the task is "fill in what's missing", so once filled it's done.
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      alert("Error assigning location: " + err.message);
    }
    setSavingId(null);
  };

  const onSort = (field) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir(field === "created_at" ? "desc" : "asc"); }
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = items;
    if (s) {
      list = list.filter(i =>
        (i.name || "").toLowerCase().includes(s) ||
        (i.upc || "").toLowerCase().includes(s) ||
        (i._mfg_name || "").toLowerCase().includes(s)
      );
    }
    if (productType) list = list.filter(i => i.product_type === productType);
    const getVal = SORT_FIELDS[sortField] || SORT_FIELDS.created_at;
    const sorted = [...list].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [items, search, productType, sortField, sortDir]);

  const SortTh = ({ field, label, className = "" }) => {
    const active = sortField === field;
    return (
      <th className={`px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider cursor-pointer select-none hover:bg-stone-200/60 whitespace-nowrap ${className}`}
        onClick={() => onSort(field)}>
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={`text-[9px] ${active ? "text-amber-600" : "text-stone-300"}`}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-3 md:px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-bold text-stone-800">Stock Room Locations</h2>
          <p className="text-[11px] md:text-xs text-stone-400">
            {loading ? "Loading…" : (
              <>
                {items.length} item{items.length !== 1 ? "s" : ""} without a stock room location
                {filtered.length !== items.length && ` — showing ${filtered.length}`}
              </>
            )}
          </p>
        </div>
        <button onClick={load}
          className="px-3 py-1.5 bg-stone-200 text-stone-600 rounded-lg text-xs font-medium hover:bg-stone-300 shrink-0">
          Refresh
        </button>
      </div>

      {/* Toolbar */}
      <div className="bg-stone-50 border-b border-stone-200 px-3 md:px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, UPC, or manufacturer…"
          className="w-full md:w-72 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <div className="flex items-center gap-1.5">
          {[
            { v: null,      label: "All",     active: "bg-stone-700 text-white" },
            { v: "dry",     label: "Dry",     active: "bg-amber-600 text-white" },
            { v: "cooler",  label: "Cooler",  active: "bg-blue-600 text-white" },
            { v: "freezer", label: "Freezer", active: "bg-green-600 text-white" },
          ].map(c => (
            <button key={c.label} onClick={() => setProductType(c.v)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${productType === c.v ? c.active : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-400 text-sm">
            {items.length === 0 ? "🎉 Every item has a stock room location." : "No items match the current filters."}
          </div>
        ) : (
          <table className="text-sm border-collapse" style={{ tableLayout: "fixed", width: "1120px" }}>
            <colgroup>
              <col style={{ width: "110px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "420px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "260px" }} />
            </colgroup>
            <thead className="sticky top-0 bg-stone-100 z-10">
              <tr className="border-b border-stone-300">
                <SortTh field="upc"       label="UPC"   className="text-left" />
                <SortTh field="_mfg_name" label="Mfg"   className="text-left" />
                <SortTh field="name"      label="Name"  className="text-left" />
                <SortTh field="size"      label="Size"  className="text-left" />
                <th className="px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider text-left">Unit</th>
                <th className="px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider text-left">SR Location</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const busy = savingId === item.id;
                return (
                  <tr key={item.id}
                    className={`border-b border-stone-100 ${i % 2 ? "bg-stone-50/40" : "bg-white"} ${busy ? "opacity-60" : ""}`}>
                    <td className="px-3 py-1.5 text-[11px] text-stone-500 font-mono truncate">{item.upc || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-600 truncate" title={item._mfg_name || ""}>{item._mfg_name || "—"}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-stone-800 truncate" title={item.name}>{item.name || <span className="italic text-stone-400">Unnamed</span>}</div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate">{item.size || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate">{(item.ref_unit_cd && unitMap[String(item.ref_unit_cd)]) || "—"}</td>
                    <td className="px-2 py-1">
                      <SearchSelect
                        key={`sr-${item.id}`}
                        value="" displayValue=""
                        fetchOptions={(q) => searchStockRoomLocations(q, "backroom")}
                        onSelect={(v) => v && assign(item, v)}
                        placeholder="Click to pick…" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
