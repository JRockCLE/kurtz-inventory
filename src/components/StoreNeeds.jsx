import { useState, useEffect, useMemo } from "react";
import { qry, fetchItemsForNeeds } from "../lib/hooks";
import { fmt$, fmtDate } from "../lib/helpers";

export default function StoreNeeds({ data, onSubmitOrder }) {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const deptMap = Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX]));
  const catMap = Object.fromEntries((data.categories || []).map(c => [c.Category_ID, c.Name_TX]));

  useEffect(() => {
    setLoading(true);
    fetchItemsForNeeds()
      .then(setAllItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Group by dept → category using local_items field names
  const grouped = useMemo(() => {
    const g = {};
    allItems.forEach(item => {
      const dk = (item.dept_id ? deptMap[item.dept_id] : null) || "Other";
      const deptId = item.dept_id;
      if (!g[dk]) g[dk] = { dept: dk, deptId, categories: {} };
      const ck = (item.category_id ? catMap[item.category_id] : null) || "Uncategorized";
      if (!g[dk].categories[ck]) g[dk].categories[ck] = [];
      g[dk].categories[ck].push(item);
    });
    return Object.values(g).sort((a, b) => a.dept.localeCompare(b.dept));
  }, [allItems, deptMap, catMap]);

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

  const submit = async () => {
    if (totalItems === 0) return;
    setSubmitting(true);
    try {
      const [order] = await qry("store_orders", {
        insert: { status: "pending", created_by: "Store", notes: `${totalItems} items, ${totalCases} cases` },
      });
      const oi = Object.entries(quantities).map(([id, qty]) => {
        const item = allItems.find(i => String(i.id) === id);
        return {
          order_id: order.id,
          item_id: item?.id || null,
          item_name: item?.name || "Unknown",
          item_size: item?.size || null,
          warehouse_location: item?.warehouse_location || null,
          cases_requested: qty,
        };
      });
      await qry("store_order_items", { insert: oi });
      setQuantities({});
      onSubmitOrder?.();
    } catch (err) {
      alert("Error: " + err.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-stone-800">Store Needs</h2>
          <span className="text-xs text-stone-400">{allItems.length.toLocaleString()} items</span>
        </div>
        <div className="flex items-center gap-3">
          {totalItems > 0 && (
            <span className="text-sm text-amber-700 font-semibold">{totalItems} items, {totalCases} cases</span>
          )}
          <button onClick={() => window.print()}
            className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
            🖨️ Print
          </button>
          <button onClick={submit} disabled={totalItems === 0 || submitting}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${totalItems > 0 ? "bg-green-600 text-white hover:bg-green-700" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
            Submit Order ({totalCases} cs)
          </button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block px-6 pt-6 pb-2">
        <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
          <div>
            <h1 className="text-xl font-black">KURTZ DISCOUNT GROCERIES</h1>
            <p className="text-sm font-bold">STORE NEEDS LIST</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{new Date().toLocaleDateString()}</p>
            <p className="text-xs text-stone-500">Write # of cases in STORE column</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-white print:overflow-visible">
        {loading ? (
          <div className="p-8 text-center text-stone-400">Loading items...</div>
        ) : grouped.length === 0 ? (
          <div className="p-12 text-center text-stone-400">No items in the system yet. Use Receiving to add items.</div>
        ) : (
          grouped.map((group, gi) => (
            <div key={gi}>
              {Object.entries(group.categories).sort(([a], [b]) => a.localeCompare(b)).map(([catName, catItems], ci) => (
                <div key={ci} className="print:break-inside-avoid">
                  <div className="bg-stone-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider sticky top-0 z-10 flex gap-2 print:bg-stone-200 print:text-stone-800">
                    <span className="text-amber-400 print:text-stone-600">{group.dept}</span>
                    <span className="text-stone-400">›</span>
                    <span>{catName}</span>
                    <span className="text-stone-400 ml-auto">{catItems.length}</span>
                  </div>

                  <div className="grid grid-cols-[70px_1fr_80px_80px_70px_80px] border-b border-stone-300 bg-stone-100 text-[10px] font-bold text-stone-500 uppercase print:grid-cols-[60px_1fr_60px_70px_60px_70px]">
                    <div className="px-2 py-1 text-center border-r border-stone-200">Store</div>
                    <div className="px-2 py-1 border-r border-stone-200">Description</div>
                    <div className="px-2 py-1 text-center border-r border-stone-200">Cases</div>
                    <div className="px-2 py-1 text-center border-r border-stone-200">Size</div>
                    <div className="px-2 py-1 text-center border-r border-stone-200">Price</div>
                    <div className="px-2 py-1 text-center">Loc</div>
                  </div>

                  {catItems.map((item, ii) => {
                    const itemKey = String(item.id);
                    const hasQty = quantities[itemKey] > 0;
                    const qty = item.cases_on_hand || 0;

                    return (
                      <div key={item.id}
                        className={`grid grid-cols-[70px_1fr_80px_80px_70px_80px] border-b border-stone-100 text-sm print:grid-cols-[60px_1fr_60px_70px_60px_70px] print:text-xs ${hasQty ? "bg-amber-50" : ii % 2 ? "bg-stone-50/50" : ""}`}>
                        <div className="px-1 py-1 border-r border-stone-100 flex items-center justify-center print:hidden">
                          <input type="number" min={0} value={quantities[itemKey] || ""} onChange={e => setQty(itemKey, e.target.value)} placeholder="—"
                            className={`w-14 text-center py-1 rounded text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-amber-500 ${hasQty ? "border-amber-400 bg-amber-100 text-amber-800" : "border-stone-200 text-stone-400"}`} />
                        </div>
                        <div className="hidden print:flex px-1 py-1.5 border-r border-stone-200 items-center justify-center">
                          <div className="w-10 h-5 border-b-2 border-stone-300" />
                        </div>
                        <div className="px-2 py-1.5 border-r border-stone-100 truncate font-medium text-stone-800">{item.name}</div>
                        <div className={`px-2 py-1.5 text-center border-r border-stone-100 font-bold tabular-nums ${qty <= 5 && qty > 0 ? "text-red-600" : qty > 0 ? "text-stone-700" : "text-stone-300"}`}>
                          {qty > 0 ? qty : "—"}
                        </div>
                        <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{item.size || "—"}</div>
                        <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-600 tabular-nums">{item.retail_price ? fmt$(item.retail_price) : "—"}</div>
                        <div className="px-2 py-1.5 text-center text-xs text-amber-700 font-medium">{item.warehouse_location || "—"}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
