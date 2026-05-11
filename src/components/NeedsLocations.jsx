import { useState, useEffect, useCallback, useMemo } from "react";
import { qry, SB_URL, SB_KEY, addItemLocation, searchLocations } from "../lib/hooks";
import { splitLocation } from "../lib/helpers";
import SearchSelect from "./SearchSelect";

const IDLE_PILL = "bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-600";
const TYPE_OPTIONS = [
  { v: "dry", label: "Dry", active: "bg-orange-500 text-white" },
  { v: "cooler", label: "Cooler", active: "bg-blue-600 text-white" },
  { v: "freezer", label: "Freezer", active: "bg-green-600 text-white" },
];

const TYPE_TO_PREFIX = { dry: "", cooler: "C", freezer: "F" };

// Empty input → only show locations matching the item's type prefix.
// As soon as the user types, show all matches so they can override.
const makeLocationFetcher = (productType) => async (typed) => {
  const results = await searchLocations(typed);
  if (typed && typed.trim()) return results;
  const wanted = TYPE_TO_PREFIX[productType];
  if (wanted === undefined) return results;
  return results.filter(r => splitLocation(r.value).prefix === wanted);
};

// ─── Inline editors ───
function InlineDate({ value, onSave, disabled }) {
  const initial = value ? new Date(value).toISOString().slice(0, 10) : "";
  const [v, setV] = useState(initial);
  useEffect(() => { setV(initial); }, [initial]);
  const commit = () => {
    const norm = v.trim() || null;
    if (norm !== (value || null)) onSave(norm);
  };
  return (
    <input type="date" value={v} disabled={disabled}
      onChange={e => setV(e.target.value)} onBlur={commit}
      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50" />
  );
}

function InlineNumber({ value, onSave, placeholder = "", disabled }) {
  const initial = value == null ? "" : String(value);
  const [v, setV] = useState(initial);
  useEffect(() => { setV(initial); }, [initial]);
  const commit = () => {
    const trimmed = v.trim();
    const norm = trimmed === "" ? null : parseInt(trimmed);
    if (norm !== (value ?? null)) onSave(norm);
  };
  return (
    <input type="number" inputMode="numeric" value={v} disabled={disabled} placeholder={placeholder}
      onChange={e => setV(e.target.value)} onBlur={commit}
      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50" />
  );
}

function TypeSelector({ value, onChange, disabled }) {
  return (
    <div className="flex gap-1">
      {TYPE_OPTIONS.map(o => (
        <button key={o.v} type="button" disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${value === o.v ? o.active : IDLE_PILL} disabled:opacity-50`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Sortable header ───
function SortableTh({ field, label, sortField, sortDir, onSort, className = "" }) {
  const active = sortField === field;
  return (
    <th className={`text-left px-3 py-2 cursor-pointer select-none hover:bg-stone-200/60 ${className}`}
      onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-1">
        <span>{label}</span>
        <span className={`text-[9px] ${active ? "text-amber-600" : "text-stone-300"}`}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}

// ─── Sort helpers ───
const SORTABLE_FIELDS = {
  product_type:     i => i.product_type || "",
  _mfg_name:        i => (i._mfg_name || "").toLowerCase(),
  name:             i => (i.name || "").toLowerCase(),
  size:             i => (i.size || "").toLowerCase(),
  expiration_date:  i => i.expiration_date ? new Date(i.expiration_date).getTime() : Infinity,
  case_size:        i => i.case_size ?? Infinity,
  upc:              i => i.upc || "",
  created_at:       i => new Date(i.created_at).getTime(),
};

export default function NeedsLocations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  const onSort = (field) => {
    if (field === sortField) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Sensible default direction per field
      setSortDir(field === "created_at" || field === "expiration_date" ? "desc" : "asc");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await qry("local_items", {
        select: "id,upc,name,size,product_type,mfg_id,default_photo,created_at,warehouse_location,active_yn,expiration_date,case_size",
        filters: "active_yn=eq.Y&warehouse_location=is.null",
        order: "created_at.desc",
        limit: 2000,
      });

      const mfgIds = [...new Set(data.map(i => i.mfg_id).filter(Boolean))];
      if (mfgIds.length) {
        try {
          const res = await fetch(
            `${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`,
            { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "posbe" } }
          );
          const mfgs = await res.json();
          const map = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
          data.forEach(i => { i._mfg_name = map[String(i.mfg_id)] || ""; });
        } catch { /* ignore */ }
      }

      setItems(data);
    } catch (err) {
      console.error(err);
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateField = async (item, patch) => {
    setSavingId(item.id);
    try {
      await qry("local_items", { update: patch, match: { id: item.id } });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i));
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    }
    setSavingId(null);
  };

  const assign = async (item, loc) => {
    const trimmed = loc?.trim();
    if (!trimmed) return;
    setSavingId(item.id);
    try {
      try { await addItemLocation(item.id, trimmed, true); } catch { /* dup */ }
      await qry("local_items", {
        update: { warehouse_location: trimmed },
        match: { id: item.id },
      });
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      alert(`Error assigning location: ${err.message}`);
    }
    setSavingId(null);
  };

  const filtered = useMemo(() => {
    let list = items;
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(i =>
        (i.name || "").toLowerCase().includes(s) ||
        (i.upc || "").toLowerCase().includes(s) ||
        (i._mfg_name || "").toLowerCase().includes(s)
      );
    }
    if (typeFilter) list = list.filter(i => i.product_type === typeFilter);
    const getVal = SORTABLE_FIELDS[sortField] || SORTABLE_FIELDS.created_at;
    const sorted = [...list];
    sorted.sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [items, search, typeFilter, sortField, sortDir]);

  const countsByType = useMemo(() => {
    const c = { dry: 0, cooler: 0, freezer: 0, none: 0 };
    items.forEach(i => {
      if (i.product_type && c[i.product_type] != null) c[i.product_type]++;
      else c.none++;
    });
    return c;
  }, [items]);

  const sortKey = `${sortField}_${sortDir}`;
  const setSortFromMobile = (key) => {
    const idx = key.lastIndexOf("_");
    setSortField(key.slice(0, idx));
    setSortDir(key.slice(idx + 1));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-3 md:px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-bold text-stone-800">Needs Locations</h2>
          <p className="text-[11px] md:text-xs text-stone-400">
            {loading ? "Loading…" : (
              <>
                {items.length} item{items.length !== 1 ? "s" : ""} without location
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

      {/* Toolbar — stacks on mobile, single row on desktop */}
      <div className="bg-stone-50 border-b border-stone-200 px-3 md:px-4 py-2.5 flex flex-col md:flex-row md:items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, UPC, or manufacturer…"
          className="w-full md:w-72 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />

        <div className="flex gap-1 flex-wrap">
          {[
            { v: "", label: `All (${items.length})` },
            { v: "dry", label: `Dry (${countsByType.dry})` },
            { v: "cooler", label: `Cooler (${countsByType.cooler})` },
            { v: "freezer", label: `Freezer (${countsByType.freezer})` },
          ].map(o => (
            <button key={o.v} onClick={() => setTypeFilter(o.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === o.v ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Mobile sort (no headers to click) */}
        <div className="flex md:hidden items-center gap-2">
          <span className="text-[11px] text-stone-400 font-medium uppercase tracking-wide">Sort</span>
          <select value={sortKey} onChange={e => setSortFromMobile(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-stone-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="created_at_desc">Newest first</option>
            <option value="created_at_asc">Oldest first</option>
            <option value="name_asc">Name A→Z</option>
            <option value="name_desc">Name Z→A</option>
            <option value="product_type_asc">Type A→Z</option>
            <option value="_mfg_name_asc">Manufacturer A→Z</option>
            <option value="size_asc">Size A→Z</option>
            <option value="expiration_date_asc">Exp Date (soonest)</option>
            <option value="expiration_date_desc">Exp Date (latest)</option>
            <option value="case_size_asc">Case Size (low→high)</option>
            <option value="case_size_desc">Case Size (high→low)</option>
            <option value="upc_asc">UPC</option>
          </select>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-stone-400 text-sm">
              {items.length === 0 ? "🎉 Every item has a location." : "No items match the current filters."}
            </div>
          </div>
        ) : (
          <>
            {/* ─── MOBILE: card list ─── */}
            <div className="md:hidden divide-y divide-stone-200">
              {filtered.map(item => {
                const busy = savingId === item.id;
                return (
                  <div key={item.id}
                    className={`p-3 bg-white ${busy ? "opacity-60" : ""}`}>
                    {/* Photo + identity */}
                    <div className="flex gap-3">
                      {item.default_photo ? (
                        <img src={item.default_photo} alt=""
                          className="w-14 h-14 object-cover rounded border border-stone-200 shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-stone-100 border border-stone-200 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-stone-800 text-sm leading-tight">
                          {item.name || <span className="italic text-stone-400">Unnamed</span>}
                        </div>
                        <div className="text-[11px] text-stone-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                          {item._mfg_name && <span>{item._mfg_name}</span>}
                          {item.size && <span>· {item.size}</span>}
                          <span className="font-mono">· {item.upc}</span>
                        </div>
                      </div>
                    </div>

                    {/* Type */}
                    <div className="mt-3">
                      <TypeSelector value={item.product_type}
                        onChange={t => updateField(item, { product_type: t })}
                        disabled={busy} />
                    </div>

                    {/* Exp Date + Case Size */}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Exp Date</label>
                        <InlineDate value={item.expiration_date}
                          onSave={v => updateField(item, { expiration_date: v })}
                          disabled={busy} />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Case Size</label>
                        <InlineNumber value={item.case_size} placeholder="—"
                          onSave={v => updateField(item, { case_size: v })}
                          disabled={busy} />
                      </div>
                    </div>

                    {/* Location (big target) */}
                    <div className="mt-2">
                      <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Assign Location</label>
                      <SearchSelect
                        key={`loc-${item.id}-${item.product_type || "none"}`}
                        value=""
                        displayValue=""
                        fetchOptions={makeLocationFetcher(item.product_type)}
                        onSelect={(v) => v && assign(item, v)}
                        placeholder="Type or select location…"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ─── DESKTOP: table ─── */}
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-stone-100 text-stone-500 text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 w-12"></th>
                  <SortableTh field="product_type"    label="Type"          sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-[210px]" />
                  <SortableTh field="upc"             label="UPC"           sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-28" />
                  <SortableTh field="_mfg_name"       label="Manufacturer"  sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-40" />
                  <SortableTh field="name"            label="Description"   sortField={sortField} sortDir={sortDir} onSort={onSort} />
                  <SortableTh field="size"            label="Size"          sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-16" />
                  <SortableTh field="expiration_date" label="Exp Date"      sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-[140px]" />
                  <SortableTh field="case_size"       label="Case Size"     sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-24" />
                  <SortableTh field="created_at"      label="Added"         sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-24" />
                  <th className="text-left px-3 py-2 w-72">Assign Location</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const busy = savingId === item.id;
                  return (
                    <tr key={item.id}
                      className={`border-b border-stone-100 hover:bg-amber-50/40 ${busy ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2">
                        {item.default_photo ? (
                          <img src={item.default_photo} alt=""
                            className="w-10 h-10 object-cover rounded border border-stone-200" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-stone-100 border border-stone-200" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <TypeSelector value={item.product_type}
                          onChange={t => updateField(item, { product_type: t })}
                          disabled={busy} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-stone-500">{item.upc}</td>
                      <td className="px-3 py-2 text-stone-600 truncate max-w-[160px]" title={item._mfg_name}>
                        {item._mfg_name || "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-stone-800 truncate max-w-[320px]" title={item.name}>
                        {item.name || <span className="italic text-stone-400">Unnamed</span>}
                      </td>
                      <td className="px-3 py-2 text-stone-600">{item.size || "—"}</td>
                      <td className="px-3 py-2">
                        <InlineDate value={item.expiration_date}
                          onSave={v => updateField(item, { expiration_date: v })}
                          disabled={busy} />
                      </td>
                      <td className="px-3 py-2">
                        <InlineNumber value={item.case_size} placeholder="—"
                          onSave={v => updateField(item, { case_size: v })}
                          disabled={busy} />
                      </td>
                      <td className="px-3 py-2 text-[11px] text-stone-500">
                        {new Date(item.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <SearchSelect
                          key={`loc-${item.id}-${item.product_type || "none"}`}
                          value=""
                          displayValue=""
                          fetchOptions={makeLocationFetcher(item.product_type)}
                          onSelect={(v) => v && assign(item, v)}
                          placeholder="Type or select location…"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
