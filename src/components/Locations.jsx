import { useState, useEffect, useCallback } from "react";
import { qry } from "../lib/hooks";

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("column_num");
  const [sortDir, setSortDir] = useState("asc");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addSection, setAddSection] = useState("");
  const [addRow, setAddRow] = useState("");
  const [addSlot, setAddSlot] = useState("");
  const [addWhSection, setAddWhSection] = useState("");
  const [addAisle, setAddAisle] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Bulk add
  const [showBulk, setShowBulk] = useState(false);
  const [bulkSecStart, setBulkSecStart] = useState("");
  const [bulkSecEnd, setBulkSecEnd] = useState("");
  const [bulkRows, setBulkRows] = useState("A,B,C,D");
  const [bulkWhSection, setBulkWhSection] = useState("");
  const [bulkAisle, setBulkAisle] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Inline cell editing
  const [editCell, setEditCell] = useState(null); // { id, field }
  const [editVal, setEditVal] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    qry("warehouse_locations", {
      select: "*", filters: "active_yn=eq.Y",
      order: `${sortBy}.${sortDir}.nullslast`, limit: 5000,
    }).then(setLocations).catch(console.error).finally(() => setLoading(false));
  }, [sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? locations.filter(l =>
        l.label?.toLowerCase().includes(search.toLowerCase()) ||
        l.section?.toLowerCase().includes(search.toLowerCase()) ||
        l.aisle?.toLowerCase().includes(search.toLowerCase()) ||
        l.notes?.toLowerCase().includes(search.toLowerCase()))
    : locations;

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };
  const arrow = (col) => sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const makeLabel = (section, row, slot) => {
    const base = `${section}${row.toUpperCase()}`;
    return slot ? `${base}-${slot}` : base;
  };

  const addOne = async () => {
    if (!addSection || !addRow) return;
    setSaving(true);
    try {
      await qry("warehouse_locations", {
        insert: {
          column_num: parseInt(addSection),
          row_letter: addRow.toUpperCase().trim(),
          slot_num: addSlot ? parseInt(addSlot) : null,
          section: addWhSection.trim() || null,
          aisle: addAisle.trim() || null,
          notes: addNotes.trim() || null,
        },
      });
      setAddSection(""); setAddRow(""); setAddSlot(""); setAddWhSection(""); setAddAisle(""); setAddNotes("");
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
          locs.push({
            column_num: sec,
            row_letter: row,
            section: bulkWhSection.trim() || null,
            aisle: bulkAisle.trim() || null,
            sort_order: sortIdx++,
          });
        }
      }
      for (let i = 0; i < locs.length; i += 100) {
        await qry("warehouse_locations", { insert: locs.slice(i, i + 100) });
      }
      setShowBulk(false);
      setBulkSecStart(""); setBulkSecEnd(""); setBulkRows("A,B,C,D"); setBulkWhSection(""); setBulkAisle("");
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
    } else if (field === "section") {
      updates.section = val || null;
    } else if (field === "aisle") {
      updates.aisle = val || null;
    } else if (field === "notes") {
      updates.notes = val || null;
    }

    // Only save if value actually changed
    const oldVal = String(loc[field] ?? "");
    if (val === oldVal) { setEditCell(null); return; }

    setEditCell(null);
    await qry("warehouse_locations", { update: updates, match: { id } });
    load();
  };

  const deleteLocation = async (id, label) => {
    if (!confirm(`Delete location "${label}"?`)) return;
    await qry("warehouse_locations", { update: { active_yn: "N" }, match: { id } });
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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold text-stone-800">Warehouse Locations</h2>
            <p className="text-xs text-stone-400">{filtered.length} locations</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowBulk(!showBulk); setShowAdd(false); }}
              className="px-3 py-2 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              Bulk Add
            </button>
            <button onClick={() => { setShowAdd(!showAdd); setShowBulk(false); }}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
              + Add Location
            </button>
          </div>
        </div>
        <div className="relative max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">🔍</span>
          <input type="text" placeholder="Search locations..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>

      {/* Add single location */}
      {showAdd && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-end gap-3 max-w-4xl flex-wrap">
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
            <div>
              <label className={lc}>WH Section</label>
              <input className={`${ic} w-20`} value={addWhSection} onChange={e => setAddWhSection(e.target.value)} placeholder="A" />
            </div>
            <div>
              <label className={lc}>Aisle</label>
              <input className={`${ic} w-20`} value={addAisle} onChange={e => setAddAisle(e.target.value)} placeholder="A1" />
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
            <div>
              <label className={lc}>WH Section</label>
              <input className={`${ic} w-20`} value={bulkWhSection} onChange={e => setBulkWhSection(e.target.value)} placeholder="A" />
            </div>
            <div>
              <label className={lc}>Aisle</label>
              <input className={`${ic} w-20`} value={bulkAisle} onChange={e => setBulkAisle(e.target.value)} placeholder="A1" />
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
              ? `${bulkSecStart}${bulkRows.split(",")[0]?.trim()}, ${bulkSecStart}${bulkRows.split(",")[1]?.trim() || "?"}, ... ${bulkSecEnd}${bulkRows.split(",").pop()?.trim()}`
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
              <th colSpan={2} className="px-2 py-1 text-left border-r border-stone-500/50">Warehouse</th>
              <th colSpan={2} className="px-2 py-1 text-left">Details</th>
            </tr>
            <tr className="bg-stone-100 border-b border-stone-300">
              <ColHead col="label" className="text-left w-[100px]">Label</ColHead>
              <ColHead col="column_num" className="text-center w-[80px]">Section #</ColHead>
              <ColHead col="row_letter" className="text-center w-[60px]">Row</ColHead>
              <ColHead col="slot_num" className="text-center w-[60px] border-r border-stone-200">Slot</ColHead>
              <ColHead col="section" className="text-left w-[90px]">WH Section</ColHead>
              <ColHead col="aisle" className="text-left w-[90px] border-r border-stone-200">Aisle</ColHead>
              <th className="px-3 py-2 text-[10px] font-bold text-stone-500 uppercase text-left">Notes</th>
              <th className="px-3 py-2 w-[60px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-stone-400">
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
                    <td className="px-3 py-2 font-bold text-amber-700 font-mono">{loc.label}</td>
                    <Cell field="column_num" value={loc.column_num} type="number" align="center" />
                    <Cell field="row_letter" value={loc.row_letter} align="center" />
                    <Cell field="slot_num" value={loc.slot_num} type="number" align="center" className="border-r border-stone-100" />
                    <Cell field="section" value={loc.section} />
                    <Cell field="aisle" value={loc.aisle} className="border-r border-stone-100" />
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
