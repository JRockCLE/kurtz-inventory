import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { qry, SB_URL, SB_KEY } from "../lib/hooks";
import { compareLocation, naturalCompare } from "../lib/helpers";

// ─── Stock Room Locations ─────────────────────────────────────────────
// Mirrors Warehouse Locations in structure (Section # / Row / Slot /
// Section / Aisle / Notes) and behavior (single add, bulk add, inline
// edit, soft delete). No warehouse-only prefix (Dry/Cooler/Freezer) —
// a stock room doesn't need it.
//
// `scope` is scaffolded so Retail can live here later with no schema
// change. Enable it by adding an entry to SCOPES and the filter chips
// + add-form select will appear automatically.

const SCOPES = [
  { v: "backroom", label: "Backroom", active: "bg-amber-600 text-white" },
  // { v: "retail",   label: "Retail",   active: "bg-blue-600 text-white" },   // enable when retail ships
];

async function fetchAllStockRoomLocations() {
  const all = [];
  const batch = 1000;
  let offset = 0;
  const headers = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    "Accept-Profile": "public",
  };
  while (true) {
    const res = await fetch(
      `${SB_URL}/rest/v1/stock_room_locations?active_yn=eq.Y&select=*&order=label.asc`,
      { headers: { ...headers, Range: `${offset}-${offset + batch - 1}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < batch) break;
    offset += batch;
  }
  return all;
}

export default function StockRoomLocations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("label");
  const [sortDir, setSortDir] = useState("asc");
  const [scopeFilter, setScopeFilter] = useState("backroom");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addScope, setAddScope] = useState("backroom");
  const [addSection, setAddSection] = useState("");
  const [addRow, setAddRow] = useState("");
  const [addSlot, setAddSlot] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Bulk add
  const [showBulk, setShowBulk] = useState(false);
  const [bulkScope, setBulkScope] = useState("backroom");
  const [bulkSecStart, setBulkSecStart] = useState("");
  const [bulkSecEnd, setBulkSecEnd] = useState("");
  const [bulkRows, setBulkRows] = useState("A,B,C,D");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Inline cell editing
  const [editCell, setEditCell] = useState(null); // { id, field }
  const [editVal, setEditVal] = useState("");

  const initialLoaded = useRef(false);
  const load = useCallback(() => {
    if (!initialLoaded.current) setLoading(true);
    fetchAllStockRoomLocations()
      .then(d => { setLocations(d); initialLoaded.current = true; })
      .catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = scopeFilter === "all"
      ? locations
      : locations.filter(l => (l.scope || "backroom") === scopeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.label?.toLowerCase().includes(q) ||
        l.notes?.toLowerCase().includes(q));
    }

    const cmpStr = (a, b) => naturalCompare(a, b);
    const cmpNum = (a, b) => {
      const av = a == null ? Infinity : a;
      const bv = b == null ? Infinity : b;
      return av - bv;
    };

    let cmp;
    if (sortBy === "label") cmp = (a, b) => compareLocation(a.label, b.label);
    else if (sortBy === "column_num" || sortBy === "slot_num") cmp = (a, b) => cmpNum(a[sortBy], b[sortBy]);
    else cmp = (a, b) => cmpStr(a[sortBy], b[sortBy]);

    list = [...list].sort(cmp);
    if (sortDir === "desc") list.reverse();
    return list;
  }, [locations, search, scopeFilter, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };
  const arrow = (col) => sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // No prefix → label is just section + row + optional -slot
  const makeLabel = (section, row, slot) =>
    `${section}${row.toUpperCase()}${slot ? `-${slot}` : ""}`;

  const addOne = async () => {
    if (!addSection || !addRow) return;
    setSaving(true);
    try {
      await qry("stock_room_locations", {
        insert: {
          label: makeLabel(addSection, addRow, addSlot),
          scope: addScope || "backroom",
          column_num: parseInt(addSection),
          row_letter: addRow.toUpperCase().trim(),
          slot_num: addSlot ? parseInt(addSlot) : null,
          notes: addNotes.trim() || null,
        },
      });
      setAddSection(""); setAddRow(""); setAddSlot(""); setAddNotes("");
      load();
    } catch (err) { alert("Error: " + err.message); }
    setSaving(false);
  };

  const addBulk = async () => {
    if (!bulkSecStart || !bulkSecEnd || !bulkRows) return;
    setBulkSaving(true);
    try {
      const start = parseInt(bulkSecStart);
      const end = parseInt(bulkSecEnd);
      const rows = bulkRows.split(",").map(r => r.trim().toUpperCase()).filter(Boolean);
      const locs = [];
      let sortIdx = 0;
      for (let sec = start; sec <= end; sec++) {
        for (const row of rows) {
          const base = `${sec}${row}`;
          locs.push({
            label: base,
            scope: bulkScope || "backroom",
            column_num: sec,
            row_letter: row,
            sort_order: sortIdx++,
          });
        }
      }
      for (let i = 0; i < locs.length; i += 100) {
        await qry("stock_room_locations", { insert: locs.slice(i, i + 100) });
      }
      setShowBulk(false);
      setBulkSecStart(""); setBulkSecEnd(""); setBulkRows("A,B,C,D");
      load();
    } catch (err) { alert("Error: " + err.message); }
    setBulkSaving(false);
  };

  const startCellEdit = (id, field, value) => {
    setEditCell({ id, field });
    setEditVal(value != null ? String(value) : "");
  };

  const saveCellEdit = async (loc) => {
    if (!editCell) return;
    const { id, field } = editCell;
    const val = editVal.trim();
    const updates = {};

    if (field === "column_num") {
      if (!val) return;
      updates.column_num = parseInt(val);
    } else if (field === "row_letter") {
      if (!val) return;
      updates.row_letter = val.toUpperCase();
    } else if (field === "slot_num") {
      updates.slot_num = val ? parseInt(val) : null;
    } else if (field === "notes") {
      updates.notes = val || null;
    } else if (field === "scope") {
      updates.scope = val || "backroom";
    }

    const oldVal = String(loc[field] ?? "");
    if (val === oldVal) { setEditCell(null); return; }

    // Recompute label if a label-component field changed.
    if (field === "column_num" || field === "row_letter" || field === "slot_num") {
      const c = field === "column_num" ? parseInt(val) : loc.column_num;
      const r = field === "row_letter" ? val.toUpperCase() : (loc.row_letter || "");
      const s = field === "slot_num" ? (val ? parseInt(val) : null) : loc.slot_num;
      updates.label = `${c}${r}${s != null ? "-" + s : ""}`;
    }

    setEditCell(null);
    await qry("stock_room_locations", { update: updates, match: { id } });
    load();
  };

  const deleteLocation = async (id, label) => {
    if (!confirm(`Delete location "${label}"?`)) return;
    await qry("stock_room_locations", { update: { active_yn: "N" }, match: { id } });
    load();
  };

  const ic = "px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1";
  const inlineIc = "px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white";

  const ColHead = ({ col, children, className = "" }) => (
    <th className={`px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider cursor-pointer hover:text-stone-700 select-none whitespace-nowrap ${className}`}
      onClick={() => toggleSort(col)}>{children}{arrow(col)}</th>
  );

  const previewLabel = addSection && addRow ? makeLabel(addSection, addRow, addSlot) : "—";
  const showScopeSelect = SCOPES.length > 1;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold text-stone-800">Stock Room Locations</h2>
            <p className="text-xs text-stone-400">{filtered.length} locations</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowBulk(b => !b); setShowAdd(false); }}
              className="px-3 py-2 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              Bulk Add
            </button>
            <button onClick={() => { setShowAdd(a => !a); setShowBulk(false); }}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
              + Add Location
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">🔍</span>
            <input type="text" placeholder="Search locations..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          {showScopeSelect && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setScopeFilter("all")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${scopeFilter === "all" ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
                All
              </button>
              {SCOPES.map(s => (
                <button key={s.v} onClick={() => setScopeFilter(s.v)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${scopeFilter === s.v ? s.active : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add single location */}
      {showAdd && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-end gap-3 max-w-4xl flex-wrap">
            {showScopeSelect && (
              <div>
                <label className={lc}>Scope</label>
                <select className={`${ic} w-32`} value={addScope} onChange={e => setAddScope(e.target.value)}>
                  {SCOPES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={lc}>Section # *</label>
              <input type="number" className={`${ic} w-20`} value={addSection} onChange={e => setAddSection(e.target.value)} placeholder="1" />
            </div>
            <div>
              <label className={lc}>Row *</label>
              <input className={`${ic} w-16`} value={addRow} onChange={e => setAddRow(e.target.value)} placeholder="A" maxLength={2} />
            </div>
            <div>
              <label className={lc}>Slot</label>
              <input type="number" className={`${ic} w-16`} value={addSlot} onChange={e => setAddSlot(e.target.value)} placeholder="—" />
            </div>
            <div className="text-sm text-stone-700 pb-2 font-mono font-bold min-w-[60px]">
              = {previewLabel}
            </div>
            <div className="flex-1">
              <label className={lc}>Notes</label>
              <input className={`${ic} w-full`} value={addNotes} onChange={e => setAddNotes(e.target.value)} placeholder="Optional..." />
            </div>
            <button onClick={addOne} disabled={saving || !addSection || !addRow}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap">
              {saving ? "..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {/* Bulk add */}
      {showBulk && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
          <div className="text-sm font-bold text-blue-800 mb-2">Bulk Add Locations</div>
          <div className="flex items-end gap-3 max-w-4xl flex-wrap">
            {showScopeSelect && (
              <div>
                <label className={lc}>Scope</label>
                <select className={`${ic} w-32`} value={bulkScope} onChange={e => setBulkScope(e.target.value)}>
                  {SCOPES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={lc}>Section Start *</label>
              <input type="number" className={`${ic} w-20`} value={bulkSecStart} onChange={e => setBulkSecStart(e.target.value)} placeholder="1" />
            </div>
            <div>
              <label className={lc}>Section End *</label>
              <input type="number" className={`${ic} w-20`} value={bulkSecEnd} onChange={e => setBulkSecEnd(e.target.value)} placeholder="20" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className={lc}>Rows (comma-separated) *</label>
              <input className={`${ic} w-full`} value={bulkRows} onChange={e => setBulkRows(e.target.value)} placeholder="A,B,C,D" />
            </div>
            <div className="text-xs text-blue-700 pb-2 min-w-[100px]">
              {bulkSecStart && bulkSecEnd && bulkRows ? (
                <>Creates {(parseInt(bulkSecEnd) - parseInt(bulkSecStart) + 1) * bulkRows.split(",").filter(r => r.trim()).length} locations</>
              ) : "—"}
            </div>
            <button onClick={addBulk} disabled={bulkSaving || !bulkSecStart || !bulkSecEnd || !bulkRows}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
              {bulkSaving ? "Creating..." : "Create All"}
            </button>
          </div>
          <div className="text-[10px] text-blue-600 mt-1">
            Preview: {bulkSecStart && bulkSecEnd && bulkRows
              ? (() => {
                  const r0 = bulkRows.split(",")[0]?.trim();
                  const r1 = bulkRows.split(",")[1]?.trim() || "?";
                  const rL = bulkRows.split(",").pop()?.trim();
                  return `${bulkSecStart}${r0}, ${bulkSecStart}${r1}, ... ${bulkSecEnd}${rL}`;
                })()
              : "Fill in fields to preview"}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-700 text-white text-[10px] font-bold uppercase tracking-wider">
              <th colSpan={4} className="px-2 py-1 text-left border-r border-stone-500/50">Location</th>
              <th colSpan={showScopeSelect ? 3 : 2} className="px-2 py-1 text-left">Details</th>
            </tr>
            <tr className="bg-stone-100 border-b border-stone-300">
              <ColHead col="label" className="text-left w-[100px]">Label</ColHead>
              <ColHead col="column_num" className="text-center w-[80px]">Section #</ColHead>
              <ColHead col="row_letter" className="text-center w-[60px]">Row</ColHead>
              <ColHead col="slot_num" className="text-center w-[60px] border-r border-stone-200">Slot</ColHead>
              {showScopeSelect && <ColHead col="scope" className="text-left w-[90px]">Scope</ColHead>}
              <th className="px-3 py-2 text-[10px] font-bold text-stone-500 uppercase text-left">Notes</th>
              <th className="px-3 py-2 w-[60px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={showScopeSelect ? 7 : 6} className="px-4 py-8 text-center text-stone-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={showScopeSelect ? 7 : 6} className="px-4 py-12 text-center text-stone-400">
                {search ? "No locations match your search" : "No locations yet. Click '+ Add Location' or 'Bulk Add' to get started."}
              </td></tr>
            ) : (
              filtered.map((loc, i) => {
                const isActive = (field) => editCell?.id === loc.id && editCell?.field === field;
                const Cell = ({ field, value, className = "", type = "text", align = "left" }) => (
                  <td className={`px-1 py-0.5 ${className}`} onClick={() => !isActive(field) && startCellEdit(loc.id, field, value)}>
                    {isActive(field) ? (
                      <input type={type} className={`${inlineIc} w-full ${align === "center" ? "text-center" : ""}`}
                        value={editVal} onChange={e => setEditVal(e.target.value)}
                        onBlur={() => saveCellEdit(loc)}
                        onKeyDown={e => { if (e.key === "Enter") saveCellEdit(loc); if (e.key === "Escape") setEditCell(null); }}
                        autoFocus />
                    ) : (
                      <div className={`px-2 py-1.5 rounded cursor-pointer hover:bg-amber-50 text-xs ${align === "center" ? "text-center" : ""} ${value ? "text-stone-600" : "text-stone-300"}`}>
                        {value || "—"}
                      </div>
                    )}
                  </td>
                );
                return (
                  <tr key={loc.id} className={`border-b border-stone-100 ${i % 2 ? "bg-stone-50/40" : "bg-white"}`}>
                    <td className="px-3 py-2 font-bold font-mono text-stone-800">{loc.label}</td>
                    <Cell field="column_num" value={loc.column_num} type="number" align="center" />
                    <Cell field="row_letter" value={loc.row_letter} align="center" />
                    <Cell field="slot_num" value={loc.slot_num} type="number" align="center" className="border-r border-stone-100" />
                    {showScopeSelect && (
                      <td className="px-1 py-0.5" onClick={() => !isActive("scope") && startCellEdit(loc.id, "scope", loc.scope || "backroom")}>
                        {isActive("scope") ? (
                          <select className={`${inlineIc} w-full`} value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={() => saveCellEdit(loc)}
                            autoFocus>
                            {SCOPES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                          </select>
                        ) : (
                          <div className="px-2 py-1.5 rounded cursor-pointer hover:bg-amber-50 text-xs text-stone-600">
                            {SCOPES.find(s => s.v === (loc.scope || "backroom"))?.label || loc.scope}
                          </div>
                        )}
                      </td>
                    )}
                    <Cell field="notes" value={loc.notes} />
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => deleteLocation(loc.id, loc.label)} className="text-stone-300 hover:text-red-500 transition-colors text-xs" title="Delete">✕</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
