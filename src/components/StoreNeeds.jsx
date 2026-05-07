import { useState, useEffect, useMemo, useCallback } from "react";
import { qry, fetchItemsForNeeds, fetchOrderTypes } from "../lib/hooks";
import { fmt$, fmtDate, naturalCompare, prefixColorClass } from "../lib/helpers";

const TYPE_BADGE = {
  dry: { label: "Dry", cls: "bg-amber-100 text-amber-800" },
  cooler: { label: "Cooler", cls: "bg-blue-100 text-blue-800" },
  freezer: { label: "Freezer", cls: "bg-green-100 text-green-800" },
  mixed: { label: "Mixed", cls: "bg-stone-200 text-stone-700" },
};

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

  const deptMap = Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX]));
  const catMap = Object.fromEntries((data.categories || []).map(c => [c.Category_ID, c.Name_TX]));
  const unitMap = Object.fromEntries((data.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX]));

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

  const grouped = useMemo(() => {
    const g = {};
    const source = onlyOrdered
      ? allItems.filter(i => (quantities[String(i.id)] || 0) > 0)
      : allItems;
    source.forEach(item => {
      const dk = (item.dept_id ? deptMap[item.dept_id] : null) || "Other";
      if (!g[dk]) g[dk] = { dept: dk, items: [] };
      g[dk].items.push(item);
    });
    // Sort items within each department: by Mfg then Description
    Object.values(g).forEach(grp => {
      grp.items.sort((a, b) =>
        (a._mfg_name || "zzz").localeCompare(b._mfg_name || "zzz") ||
        (a.name || "").localeCompare(b.name || "")
      );
    });
    return Object.values(g).sort((a, b) => a.dept.localeCompare(b.dept));
  }, [allItems, deptMap, catMap, onlyOrdered, quantities]);

  const setQty = (id, val) => {
    const n = parseInt(val) || 0;
    setQuantities(prev => {
      const next = { ...prev };
      if (n > 0) next[id] = n; else delete next[id];
      return next;
    });
  };

  const totalItems = Object.keys(quantities).length;
  const totalCases = Object.values(quantities).reduce((s, v) => s + v, 0);

  const handleGridNav = (e, itemKey, col) => {
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
  };

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
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => onDone?.()} className="text-stone-500 hover:text-stone-800 text-sm">← Back</button>
          <h2 className="text-lg font-bold text-stone-800">{orderId ? `Store List #${orderId}` : "New Store List"}</h2>
          <span className="text-xs text-stone-400">{allItems.length.toLocaleString()} items</span>
        </div>
        <div className="flex items-center gap-3">
          {totalItems > 0 && (
            <span className="text-sm text-amber-700 font-semibold">{totalItems} items, {totalCases} cases</span>
          )}
          <button onClick={() => setOnlyOrdered(o => !o)} disabled={totalItems === 0}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${onlyOrdered ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>
            {onlyOrdered ? "Show All" : "Show Ordered Only"}
          </button>
          <button onClick={() => window.print()}
            className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
            Print
          </button>
          {!readOnly && (
            <>
              <button onClick={() => saveOrder("draft")} disabled={submitting}
                className="px-4 py-1.5 bg-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-300 disabled:opacity-50">
                {submitting ? "..." : "Save"}
              </button>
              <button onClick={() => saveOrder("submitted")} disabled={totalItems === 0 || submitting}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold ${totalItems > 0 ? "bg-green-600 text-white hover:bg-green-700" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
                Submit List ({totalCases} cs)
              </button>
            </>
          )}
        </div>
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

      <div className="flex-1 overflow-auto bg-white print:overflow-visible">
        {loading ? (
          <div className="p-8 text-center text-stone-400">Loading items...</div>
        ) : grouped.length === 0 ? (
          <div className="p-12 text-center text-stone-400">No items in the system yet. Use Receiving to add items.</div>
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
              {grouped.map((group, gi) => [
                <tr key={`h-${gi}`}>
                  <td colSpan={7} className="pt-3 pb-1 px-2 font-bold text-xs uppercase text-stone-800 border-b border-stone-300">
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
              ])}
            </tbody>
          </table>

          {/* ─── Screen: grid layout with sticky category headers ─── */}
          <div className="print:hidden">
          {grouped.map((group, gi) => (
            <div key={gi}>
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

              {group.items.map((item, ii) => {
                const itemKey = String(item.id);
                const hasQty = quantities[itemKey] > 0;
                const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");

                return (
                  <div key={item.id}
                    className={`grid border-b border-stone-100 text-sm ${hasQty ? "bg-amber-50" : ii % 2 ? "bg-stone-50/50" : ""}`}
                    style={{ gridTemplateColumns: `${mfgW}px ${descW}px 80px 70px 70px 70px 1fr` }}>
                    <div className="px-2 py-1.5 border-r border-stone-100 truncate text-stone-500 text-xs">{item._mfg_name || "—"}</div>
                    <div className="px-2 py-1.5 border-r border-stone-100 truncate font-medium text-stone-800">{item.name}</div>
                    <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{sizeUnit || "—"}</div>
                    <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{item.case_size || "—"}</div>
                    <div className={`px-2 py-1.5 text-center border-r border-stone-100 text-xs font-medium ${item.warehouse_location ? prefixColorClass(item.warehouse_location) : "text-stone-400"}`}>{item.warehouse_location || "—"}</div>
                    <div className="px-1 py-1 border-r border-stone-100 flex items-center justify-center">
                      {readOnly ? (
                        <span className={`text-sm font-bold ${hasQty ? "text-amber-800" : "text-stone-300"}`}>{hasQty ? quantities[itemKey] : "—"}</span>
                      ) : (
                        <input type="number" min={0} value={quantities[itemKey] || ""} onChange={e => setQty(itemKey, e.target.value)} placeholder="—"
                          data-grid-cell={`qty-${itemKey}`}
                          onKeyDown={e => handleGridNav(e, itemKey, "qty")}
                          className={`w-14 text-center py-1 rounded text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-amber-500 ${hasQty ? "border-amber-400 bg-amber-100 text-amber-800" : "border-stone-200 text-stone-400"}`} />
                      )}
                    </div>
                    <div className="px-1 py-1 flex items-center">
                      {readOnly ? (
                        <span className="text-xs text-stone-600 truncate">{itemNotes[itemKey] || ""}</span>
                      ) : (
                        <input type="text" value={itemNotes[itemKey] || ""}
                          onChange={e => setItemNotes(prev => ({ ...prev, [itemKey]: e.target.value }))}
                          data-grid-cell={`notes-${itemKey}`}
                          onKeyDown={e => handleGridNav(e, itemKey, "notes")}
                          placeholder="Optional note..."
                          className="w-full px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          </div>
          </>
        )}
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
