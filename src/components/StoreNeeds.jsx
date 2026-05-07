import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { qry, fetchItemsForNeeds, fetchOrderTypes } from "../lib/hooks";
import { prefixColorClass } from "../lib/helpers";

const TYPE_BADGE = {
  dry: { label: "Dry", cls: "bg-amber-100 text-amber-800" },
  cooler: { label: "Cooler", cls: "bg-blue-100 text-blue-800" },
  freezer: { label: "Freezer", cls: "bg-green-100 text-green-800" },
  mixed: { label: "Mixed", cls: "bg-stone-200 text-stone-700" },
};

const TYPE_DISPLAY = {
  dry: { label: "Dry", text: "text-amber-700", banner: "bg-amber-600", hover: "hover:bg-amber-50" },
  cooler: { label: "Cooler", text: "text-blue-700", banner: "bg-blue-600", hover: "hover:bg-blue-50" },
  freezer: { label: "Freezer", text: "text-green-700", banner: "bg-green-600", hover: "hover:bg-green-50" },
};

const slug = (s) => (s || "other").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

// Memoized row — only re-renders when its own item/qty/note (or width) changes.
const StoreItemRow = memo(function StoreItemRow({
  item, ii, qty, note, mfgW, descW, unitMap, readOnly, setQty, setNote, handleGridNav,
}) {
  const itemKey = String(item.id);
  const hasQty = (qty || 0) > 0;
  const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
  return (
    <div className={`grid border-b border-stone-100 text-sm ${hasQty ? "bg-amber-50" : ii % 2 ? "bg-stone-50/50" : ""}`}
      style={{ gridTemplateColumns: `${mfgW}px ${descW}px 80px 70px 70px 70px 1fr` }}>
      <div className="px-2 py-1.5 border-r border-stone-100 truncate text-stone-500 text-xs">{item._mfg_name || "—"}</div>
      <div className="px-2 py-1.5 border-r border-stone-100 truncate font-medium text-stone-800">{item.name}</div>
      <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{sizeUnit || "—"}</div>
      <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{item.case_size || "—"}</div>
      <div className={`px-2 py-1.5 text-center border-r border-stone-100 text-xs font-medium ${item.warehouse_location ? prefixColorClass(item.warehouse_location) : "text-stone-400"}`}>{item.warehouse_location || "—"}</div>
      <div className="px-1 py-1 border-r border-stone-100 flex items-center justify-center">
        {readOnly ? (
          <span className={`text-sm font-bold ${hasQty ? "text-amber-800" : "text-stone-300"}`}>{hasQty ? qty : "—"}</span>
        ) : (
          <input type="number" min={0} value={qty || ""} onChange={e => setQty(itemKey, e.target.value)} placeholder="—"
            data-grid-cell={`qty-${itemKey}`}
            onKeyDown={e => handleGridNav(e, itemKey, "qty")}
            className={`w-14 text-center py-1 rounded text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-amber-500 ${hasQty ? "border-amber-400 bg-amber-100 text-amber-800" : "border-stone-200 text-stone-400"}`} />
        )}
      </div>
      <div className="px-1 py-1 flex items-center">
        {readOnly ? (
          <span className="text-xs text-stone-600 truncate">{note || ""}</span>
        ) : (
          <input type="text" value={note || ""}
            onChange={e => setNote(itemKey, e.target.value)}
            data-grid-cell={`notes-${itemKey}`}
            onKeyDown={e => handleGridNav(e, itemKey, "notes")}
            placeholder="Optional note..."
            className="w-full px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500" />
        )}
      </div>
    </div>
  );
});

const _canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function measureText(text, font = "500 14px ui-sans-serif, system-ui, sans-serif") {
  if (!_canvas) return text.length * 8;
  const ctx = _canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}
function dynamicWidth(items, field, font, minW = 80, maxW = 300) {
  if (!items.length) return minW;
  const widths = items.map(i => measureText(String(i[field] || ""), font));
  widths.sort((a, b) => b - a);
  const top25 = widths.slice(0, Math.max(1, Math.ceil(widths.length * 0.25)));
  const avg = top25.reduce((s, w) => s + w, 0) / top25.length;
  return Math.max(minW, Math.min(maxW, Math.round(avg * 1.1) + 24));
}

function StoreListForm({ data, onDone, orderId: initialOrderId, readOnly = false, scope = "all" }) {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState(initialOrderId || null);
  const [savedToast, setSavedToast] = useState(false);
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  const [search, setSearch] = useState("");
  const [mfgLetter, setMfgLetter] = useState(null);
  const [tocOpen, setTocOpen] = useState(true);

  const deptMap = useMemo(() => Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX])), [data.depts]);
  const unitMap = useMemo(() => Object.fromEntries((data.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX])), [data.units]);

  const mfgW = useMemo(() => dynamicWidth(allItems, "_mfg_name", "400 12px ui-sans-serif, system-ui, sans-serif", 80, 200), [allItems]);
  const descW = useMemo(() => dynamicWidth(allItems, "name", "500 14px ui-sans-serif, system-ui, sans-serif", 150, 400), [allItems]);

  useEffect(() => {
    setLoading(true);
    fetchItemsForNeeds()
      .then(async (items) => {
        const filtered = scope === "all" ? items : items.filter(i => i.product_type === scope);
        setAllItems(filtered);
        // Load saved quantities if reopening a draft
        if (initialOrderId) {
          try {
            const saved = await qry("store_order_items", {
              select: "item_id,cases_requested,notes",
              filters: `order_id=eq.${initialOrderId}`,
            });
            const q = {};
            const n = {};
            saved.forEach(s => {
              if (s.cases_requested > 0) q[String(s.item_id)] = s.cases_requested;
              if (s.notes) n[String(s.item_id)] = s.notes;
            });
            setQuantities(q);
            setItemNotes(n);
          } catch {}
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [initialOrderId, scope]);

  const availableLetters = useMemo(() => {
    const set = new Set();
    allItems.forEach(i => {
      const c = (i._mfg_name || "").charAt(0).toUpperCase();
      if (/[A-Z]/.test(c)) set.add(c);
    });
    return set;
  }, [allItems]);

  // Static groups — no quantities dep, so editing a qty doesn't bust this memo
  const baseTypeGroups = useMemo(() => {
    let source = allItems;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      source = source.filter(i =>
        (i.name || "").toLowerCase().includes(q) ||
        (i._mfg_name || "").toLowerCase().includes(q) ||
        (i.upc || "").toLowerCase().includes(q)
      );
    }
    if (mfgLetter) {
      source = source.filter(i => (i._mfg_name || "").charAt(0).toUpperCase() === mfgLetter);
    }
    const byType = { dry: {}, cooler: {}, freezer: {} };
    source.forEach(item => {
      const t = byType[item.product_type] ? item.product_type : "dry";
      const dk = (item.dept_id ? deptMap[item.dept_id] : null) || "Other";
      if (!byType[t][dk]) byType[t][dk] = [];
      byType[t][dk].push(item);
    });
    return ["dry", "cooler", "freezer"].map(type => {
      const depts = Object.entries(byType[type])
        .map(([dept, items]) => ({
          dept,
          items: [...items].sort((a, b) =>
            (a._mfg_name || "zzz").localeCompare(b._mfg_name || "zzz") ||
            (a.name || "").localeCompare(b.name || "")
          ),
        }))
        .sort((a, b) => a.dept.localeCompare(b.dept));
      return { type, depts, count: depts.reduce((s, d) => s + d.items.length, 0) };
    }).filter(g => g.depts.length > 0);
  }, [allItems, deptMap, search, mfgLetter]);

  // Apply onlyOrdered (uses quantities) on top — only re-runs when toggling that filter
  const typeGroups = useMemo(() => {
    if (!onlyOrdered) return baseTypeGroups;
    return baseTypeGroups
      .map(tg => ({
        ...tg,
        depts: tg.depts
          .map(d => ({ ...d, items: d.items.filter(i => (quantities[String(i.id)] || 0) > 0) }))
          .filter(d => d.items.length > 0),
      }))
      .map(tg => ({ ...tg, count: tg.depts.reduce((s, d) => s + d.items.length, 0) }))
      .filter(tg => tg.depts.length > 0);
  }, [baseTypeGroups, onlyOrdered, quantities]);

  const setQty = useCallback((id, val) => {
    const n = parseInt(val) || 0;
    setQuantities(prev => {
      const next = { ...prev };
      if (n > 0) next[id] = n; else delete next[id];
      return next;
    });
  }, []);

  const setNote = useCallback((id, val) => {
    setItemNotes(prev => ({ ...prev, [id]: val }));
  }, []);

  const totalItems = Object.keys(quantities).length;
  const totalCases = Object.values(quantities).reduce((s, v) => s + v, 0);

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleGridNav = useCallback((e, itemKey, col) => {
    const key = e.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") return;

    // For Notes (text input), only intercept Left/Right when cursor is at start/end
    if (col === "notes") {
      const input = e.currentTarget;
      const len = input.value.length;
      const pos = input.selectionStart;
      if (key === "ArrowLeft" && pos !== 0) return;
      if (key === "ArrowRight" && pos !== len) return;
    }

    if (key === "ArrowLeft" && col === "notes") {
      e.preventDefault();
      const target = document.querySelector(`[data-grid-cell="qty-${itemKey}"]`);
      if (target) { target.focus(); target.select?.(); }
      return;
    }
    if (key === "ArrowRight" && col === "qty") {
      e.preventDefault();
      const target = document.querySelector(`[data-grid-cell="notes-${itemKey}"]`);
      if (target) { target.focus(); target.select?.(); }
      return;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll(`[data-grid-cell^="${col}-"]`));
      const idx = inputs.indexOf(e.currentTarget);
      const next = key === "ArrowDown" ? inputs[idx + 1] : inputs[idx - 1];
      if (next) { next.focus(); next.select?.(); }
    }
  }, []);

  const saveOrder = async (status) => {
    setSubmitting(true);
    try {
      const notes = `${totalItems} items, ${totalCases} cases`;
      let oid = orderId;

      if (oid) {
        // Update existing order
        await qry("store_orders", { update: { status, notes }, match: { id: oid } });
        // Delete old items and re-insert
        await qry("store_order_items", { del: true, match: { order_id: oid } });
      } else {
        // Create new order
        const [order] = await qry("store_orders", {
          insert: { status, created_by: "Store", notes },
        });
        oid = order.id;
        setOrderId(oid);
      }

      // Include items with quantities OR notes
      const ids = new Set([...Object.keys(quantities), ...Object.keys(itemNotes).filter(k => itemNotes[k]?.trim())]);
      if (ids.size > 0) {
        const oi = [...ids].map(id => {
          const item = allItems.find(i => String(i.id) === id);
          return {
            order_id: oid,
            item_id: item?.id || null,
            item_name: item?.name || "Unknown",
            item_size: item?.size || null,
            warehouse_location: item?.warehouse_location || null,
            cases_requested: quantities[id] || 0,
            notes: itemNotes[id]?.trim() || null,
          };
        });
        await qry("store_order_items", { insert: oi });
      }

      if (status === "submitted") {
        setQuantities({});
        setItemNotes({});
        onDone?.();
      } else if (status === "draft") {
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 2000);
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full relative">
      {savedToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2 animate-in print:hidden">
          <span>✓</span>
          <span>Draft saved</span>
        </div>
      )}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-2 print:hidden">
        <button onClick={() => onDone?.()} className="text-stone-500 hover:text-stone-800 text-sm shrink-0">← Back</button>
        <h2 className="text-base font-bold text-stone-800 shrink-0">{orderId ? `Store List #${orderId}` : "New Store List"}</h2>

        <input type="text" placeholder="Search name, mfg, UPC..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 w-56 shrink-0" />

        <div className="flex items-center gap-px shrink-0">
          <button onClick={() => setMfgLetter(null)}
            className={`px-1.5 h-7 text-[10px] font-bold rounded transition-colors ${mfgLetter === null ? "bg-amber-600 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
            All
          </button>
          {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map(L => {
            if (!availableLetters.has(L)) return null;
            const active = mfgLetter === L;
            return (
              <button key={L} onClick={() => setMfgLetter(active ? null : L)}
                className={`w-6 h-7 text-[10px] font-bold rounded transition-colors ${active ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                {L}
              </button>
            );
          })}
        </div>

        <button onClick={() => setOnlyOrdered(o => !o)} disabled={totalItems === 0}
          className={`px-3 h-7 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shrink-0 ${onlyOrdered ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>
          {onlyOrdered ? "Show All" : "Ordered Only"}
        </button>

        <div className="flex-1" />

        {totalItems > 0 && (
          <span className="text-sm text-amber-700 font-semibold shrink-0">{totalItems} items / {totalCases} cs</span>
        )}
        <button onClick={() => window.print()}
          className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200 shrink-0">
          Print
        </button>
        {!readOnly && (
          <>
            <button onClick={() => saveOrder("draft")} disabled={submitting}
              className="px-3 py-1.5 bg-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-300 disabled:opacity-50 shrink-0">
              {submitting ? "..." : "Save"}
            </button>
            <button onClick={() => saveOrder("submitted")} disabled={totalItems === 0 || submitting}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold shrink-0 ${totalItems > 0 ? "bg-green-600 text-white hover:bg-green-700" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
              Submit ({totalCases})
            </button>
          </>
        )}
      </div>

      <div className="hidden print:block px-6 pt-6 pb-2">
        <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
          <div>
            <h1 className="text-xl font-black">KURTZ DISCOUNT GROCERIES</h1>
            <p className="text-sm font-bold">STORE LIST</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{new Date().toLocaleDateString()}</p>
            <p className="text-xs text-stone-500">Write # of cases in Case Qty column</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-white print:overflow-visible flex">
        {/* ─── TOC sidebar (slide-out) ─── */}
        <div className={`shrink-0 ${tocOpen ? "w-44" : "w-9"} border-r border-stone-200 bg-stone-50 print:hidden flex flex-col transition-[width] duration-150`}>
          <button onClick={() => setTocOpen(o => !o)}
            className={`flex items-center px-2 py-2 hover:bg-stone-200 border-b border-stone-200 shrink-0 w-full ${tocOpen ? "justify-between" : "justify-center"}`}
            title={tocOpen ? "Collapse table of contents" : "Show table of contents"}>
            {tocOpen && <span className="text-[10px] uppercase font-bold tracking-wide text-stone-500">Jump to</span>}
            <span className="text-amber-600 font-black text-xl leading-none">{tocOpen ? "«" : "»"}</span>
          </button>
          {tocOpen && (
            <div className="flex-1 overflow-auto py-1">
              {typeGroups.map(tg => {
                const td = TYPE_DISPLAY[tg.type];
                return (
                  <div key={tg.type} className="mb-2">
                    <button onClick={() => scrollTo(`type-${tg.type}`)}
                      className={`w-full text-left px-2 py-1 text-xs font-bold uppercase tracking-wide ${td.text} ${td.hover} flex justify-between items-center`}>
                      <span>{td.label}</span>
                      <span className="text-stone-400 font-normal">{tg.count}</span>
                    </button>
                    {tg.depts.map(d => (
                      <button key={d.dept} onClick={() => scrollTo(`dept-${tg.type}-${slug(d.dept)}`)}
                        className="w-full text-left px-3 py-0.5 text-[11px] text-stone-600 hover:bg-stone-200 truncate flex justify-between items-center gap-2">
                        <span className="truncate">{d.dept}</span>
                        <span className="text-stone-400 shrink-0">{d.items.length}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Content (scrollable) ─── */}
        <div className="flex-1 overflow-auto print:overflow-visible">
          {loading ? (
            <div className="p-8 text-center text-stone-400">Loading items...</div>
          ) : typeGroups.length === 0 ? (
            <div className="p-12 text-center text-stone-400">{search || mfgLetter || onlyOrdered ? "No items match your filters." : "No items in the system yet. Use Receiving to add items."}</div>
          ) : (
            <>
            {/* ─── Print: use table so thead repeats on each page ─── */}
            <table className="hidden print:table w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
              <thead style={{ display: "table-header-group" }}>
                <tr className="border-b-2 border-stone-400 text-[10px] font-bold text-stone-600 uppercase">
                  <th className="px-2 py-1.5 text-left whitespace-nowrap">Mfg</th>
                  <th className="px-2 py-1.5 text-left">Description</th>
                  <th className="px-2 py-1.5 text-center whitespace-nowrap">Size/Unit</th>
                  <th className="px-2 py-1.5 text-center whitespace-nowrap">U/Case</th>
                  <th className="px-2 py-1.5 text-center whitespace-nowrap">WH Loc</th>
                  <th className="px-2 py-1.5 text-center" style={{ width: "70px" }}>Case Qty</th>
                  <th className="px-2 py-1.5 text-left" style={{ minWidth: "2in" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {typeGroups.flatMap(tg => [
                  <tr key={`th-${tg.type}`}>
                    <td colSpan={7} className="pt-4 pb-1 px-2 font-black text-sm uppercase tracking-wider text-stone-900 border-b-2 border-stone-700">
                      {TYPE_DISPLAY[tg.type].label}
                      <span className="text-stone-400 ml-2 font-normal text-xs">{tg.count} items</span>
                    </td>
                  </tr>,
                  ...tg.depts.flatMap(group => [
                    <tr key={`h-${tg.type}-${group.dept}`}>
                      <td colSpan={7} className="pt-2 pb-1 px-2 font-bold text-xs uppercase text-stone-800 border-b border-stone-300">
                        {group.dept}
                        <span className="text-stone-400 ml-2 font-normal">{group.items.length}</span>
                      </td>
                    </tr>,
                    ...group.items.map((item, ii) => {
                      const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
                      return (
                        <tr key={`r-${item.id}`} className={ii % 2 ? "bg-stone-50" : ""}>
                          <td className="px-2 py-1.5 text-stone-500 border-b border-stone-200 whitespace-nowrap">{item._mfg_name || "—"}</td>
                          <td className="px-2 py-1.5 font-medium text-stone-800 border-b border-stone-200">{item.name}</td>
                          <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{sizeUnit || "—"}</td>
                          <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{item.case_size || "—"}</td>
                          <td className="px-2 py-1.5 text-center text-stone-700 font-bold border-b border-stone-200 whitespace-nowrap">{item.warehouse_location || "—"}</td>
                          <td className="px-1 py-1 text-center border border-stone-300" style={{ height: "32px" }}></td>
                          <td className="px-2 py-1 border border-stone-300 text-xs text-stone-700">{itemNotes[String(item.id)] || ""}</td>
                        </tr>
                      );
                    }),
                  ]),
                ])}
              </tbody>
            </table>

            {/* ─── Screen: type sections, dept-grouped grid ─── */}
            <div className="print:hidden">
              {typeGroups.map(tg => {
                const td = TYPE_DISPLAY[tg.type];
                return (
                  <div key={tg.type}>
                    <div id={`type-${tg.type}`} className={`${td.banner} text-white px-3 py-2 text-sm font-black uppercase tracking-widest flex justify-between items-center`}>
                      <span>{td.label}</span>
                      <span className="text-white/70 text-xs font-normal">{tg.count} items</span>
                    </div>
                    {tg.depts.map(group => (
                      <div key={group.dept} id={`dept-${tg.type}-${slug(group.dept)}`}>
                        <div className="bg-stone-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider sticky top-0 z-10 flex gap-2">
                          <span className="text-amber-400">{group.dept}</span>
                          <span className="text-stone-400 ml-auto">{group.items.length}</span>
                        </div>

                        <div className="grid border-b border-stone-300 bg-stone-100 text-[10px] font-bold text-stone-500 uppercase"
                          style={{ gridTemplateColumns: `${mfgW}px ${descW}px 80px 70px 70px 70px 1fr` }}>
                          <div className="px-2 py-1 border-r border-stone-200">Mfg</div>
                          <div className="px-2 py-1 border-r border-stone-200">Description</div>
                          <div className="px-2 py-1 text-center border-r border-stone-200">Size/Unit</div>
                          <div className="px-2 py-1 text-center border-r border-stone-200">U/Case</div>
                          <div className="px-2 py-1 text-center border-r border-stone-200">WH Loc</div>
                          <div className="px-2 py-1 text-center border-r border-stone-200">Case Qty</div>
                          <div className="px-2 py-1">Notes</div>
                        </div>

                        {group.items.map((item, ii) => (
                          <StoreItemRow key={item.id}
                            item={item} ii={ii}
                            qty={quantities[String(item.id)]}
                            note={itemNotes[String(item.id)]}
                            mfgW={mfgW} descW={descW} unitMap={unitMap}
                            readOnly={readOnly}
                            setQty={setQty} setNote={setNote}
                            handleGridNav={handleGridNav} />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StoreNeeds({ data, onSubmitOrder }) {
  const [view, setView] = useState("list"); // "list", "create", or orderId number
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeMap, setTypeMap] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    qry("store_orders", {
      select: "id,status,notes,created_at,created_by",
      order: "created_at.desc",
      limit: 500,
    }).then(setOrders).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!orders.length) { setTypeMap({}); return; }
    let cancelled = false;
    fetchOrderTypes(orders.map(o => o.id))
      .then(s => { if (!cancelled) setTypeMap(s); })
      .catch(() => { if (!cancelled) setTypeMap({}); });
    return () => { cancelled = true; };
  }, [orders]);

  const deleteOrder = async (id) => {
    if (!confirm("Delete this list and its pick list?")) return;
    try {
      await qry("store_order_items", { del: true, match: { order_id: id } });
      await qry("store_orders", { del: true, match: { id } });
      load();
      onSubmitOrder?.(); // refresh pick lists too
    } catch (err) { alert("Error: " + err.message); }
  };

  if (view === "scope") {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-stone-50 px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
          <h2 className="text-lg font-bold text-stone-800 mb-1">What kind of list?</h2>
          <p className="text-sm text-stone-500 mb-5">Pick a scope. Only items of that type will appear in the list builder.</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button onClick={() => setView({ create: true, scope: "all" })} className="px-4 py-3 bg-stone-700 text-white rounded-lg text-sm font-bold hover:bg-stone-800">All Products</button>
            <button onClick={() => setView({ create: true, scope: "dry" })} className="px-4 py-3 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">Dry</button>
            <button onClick={() => setView({ create: true, scope: "cooler" })} className="px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">Cooler</button>
            <button onClick={() => setView({ create: true, scope: "freezer" })} className="px-4 py-3 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">Freezer</button>
          </div>
          <button onClick={() => setView("list")} className="text-sm text-stone-500 hover:text-stone-800">Cancel</button>
        </div>
      </div>
    );
  }

  if (view === "create" || (typeof view === "object" && view !== null)) {
    return <StoreListForm data={data} orderId={view?.id || null} readOnly={view?.readOnly || false}
      scope={view?.scope || "all"}
      onDone={() => { setView("list"); load(); onSubmitOrder?.(); }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-800">Store Lists</h2>
        <button onClick={() => setView("scope")}
          className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
          + Create New List
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-stone-50">
        {loading && orders.length === 0 ? (
          <div className="p-8 text-center text-stone-400">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-stone-500 text-sm">No store lists yet</p>
            <p className="text-stone-400 text-xs mt-1">Click "Create New List" to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {orders.map(o => {
              const parts = (o.notes || "").match(/(\d+) items?, (\d+) cases?/);
              const itemCount = parts ? parts[1] : "—";
              const caseCount = parts ? parts[2] : "—";

              return (
                <div key={o.id}
                  className="px-4 py-3 bg-white hover:bg-stone-50 transition-colors grid items-center gap-3 cursor-pointer"
                  style={{ gridTemplateColumns: "360px 100px 130px 1fr auto" }}
                  onClick={() => setView({ id: o.id, readOnly: o.status !== "draft" })}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-800 truncate">
                      Store List #{o.id}
                    </div>
                    <div className="text-xs text-stone-400 truncate">
                      {new Date(o.created_at).toLocaleString()} — {itemCount} items, {caseCount} cases
                    </div>
                  </div>
                  <div>
                    {(() => {
                      const tb = typeMap[o.id] ? TYPE_BADGE[typeMap[o.id]] : null;
                      return tb ? <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${tb.cls}`}>{tb.label}</span> : null;
                    })()}
                  </div>
                  <div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      o.status === "draft" ? "bg-amber-100 text-amber-800 border-amber-200" :
                      o.status === "submitted" ? "bg-green-100 text-green-800 border-green-200" :
                      "bg-stone-100 text-stone-500 border-stone-200"
                    }`}>
                      {o.status === "draft" ? "In Progress" : o.status === "submitted" ? "Submitted" : o.status}
                    </span>
                  </div>
                  <div />
                  <button onClick={(e) => { e.stopPropagation(); deleteOrder(o.id); }}
                    className="text-stone-300 hover:text-red-500 transition-colors text-sm shrink-0" title="Delete list">
                    x
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
