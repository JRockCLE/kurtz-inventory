import { useState, useEffect, useCallback } from "react";
import { qry } from "../lib/hooks";

export default function PickList({ orderId, onBack, onUpdate }) {
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [whLocDetails, setWhLocDetails] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      qry("store_orders", { select: "*", filters: `id=eq.${orderId}` }),
      qry("store_order_items", {
        select: "*",
        filters: `order_id=eq.${orderId}`,
        order: "warehouse_location.asc.nullslast,item_name.asc",
      }),
      qry("warehouse_locations", { select: "label,section,aisle", filters: "active_yn=eq.Y", limit: 5000 }),
    ]).then(([o, i, locs]) => {
      setOrder(o[0]);
      setItems(i);
      const m = {};
      locs.forEach(l => { m[l.label] = { section: l.section, aisle: l.aisle }; });
      setWhLocDetails(m);
    }).catch(console.error).finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (status) => {
    const u = { status, updated_at: new Date().toISOString() };
    if (status === "picked") u.picked_at = u.updated_at;
    if (status === "delivered") u.delivered_at = u.updated_at;
    await qry("store_orders", { update: u, match: { id: orderId } });
    setOrder(prev => ({ ...prev, ...u }));
    onUpdate?.();
  };

  const togglePicked = async (itemId, picked) => {
    await qry("store_order_items", { update: { picked_yn: picked }, match: { id: itemId } });
    load();
  };

  const setCasesPicked = async (itemId, qty) => {
    await qry("store_order_items", {
      update: { cases_picked: qty, picked_yn: qty > 0 },
      match: { id: itemId },
    });
    load();
  };

  const grouped = {};
  items.forEach(i => {
    const k = i.warehouse_location || "Unassigned";
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(i);
  });

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-800",
    picking: "bg-blue-100 text-blue-800",
    picked: "bg-green-100 text-green-800",
    delivered: "bg-stone-200 text-stone-600",
  };

  if (loading || !order) return <div className="p-8 text-center text-stone-400">Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="text-stone-500 hover:text-stone-800 text-sm">← Orders</button>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              🖨️ Print
            </button>
            {order.status === "pending" && (
              <button onClick={() => updateStatus("picking")}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                Start Picking
              </button>
            )}
            {order.status === "picking" && (
              <button onClick={() => updateStatus("picked")}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">
                Mark Picked
              </button>
            )}
            {order.status === "picked" && (
              <button onClick={() => updateStatus("delivered")}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
                Mark Delivered
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-stone-800">Order #{order.id}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[order.status]}`}>
            {order.status?.toUpperCase()}
          </span>
          <span className="text-xs text-stone-400">{new Date(order.created_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="hidden print:block px-6 pt-6 pb-2">
        <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
          <div>
            <h1 className="text-xl font-black">WAREHOUSE PICK LIST</h1>
            <p className="text-sm">Order #{order.id} — {items.length} items</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{new Date(order.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white print:overflow-visible">
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([loc, locItems]) => (
          <div key={loc} className="print:break-inside-avoid">
            <div className="bg-stone-700 text-white px-3 py-1.5 text-xs font-bold uppercase print:bg-stone-200 print:text-stone-800 flex items-center gap-3">
              <span>📍 {loc}</span>
              {whLocDetails[loc] && (whLocDetails[loc].section || whLocDetails[loc].aisle) && (
                <span className="font-normal normal-case text-stone-300 print:text-stone-500">
                  {[whLocDetails[loc].section && `Section ${whLocDetails[loc].section}`, whLocDetails[loc].aisle && `Aisle ${whLocDetails[loc].aisle}`].filter(Boolean).join(" / ")}
                </span>
              )}
            </div>
            {locItems.map((item, i) => (
              <div key={item.id}
                className={`flex items-center px-4 py-2 border-b border-stone-100 text-sm ${item.picked_yn ? "bg-green-50" : i % 2 ? "bg-stone-50/40" : ""}`}>
                <button onClick={() => togglePicked(item.id, !item.picked_yn)}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center mr-3 flex-shrink-0 print:hidden ${item.picked_yn ? "bg-green-500 border-green-500 text-white" : "border-stone-300"}`}>
                  {item.picked_yn && <span className="text-xs">✓</span>}
                </button>
                <div className="hidden print:block w-5 h-5 border-2 border-stone-400 rounded-sm mr-3 flex-shrink-0" />

                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${item.picked_yn ? "line-through text-stone-400" : "text-stone-800"}`}>
                    {item.item_name}
                  </div>
                  <div className="text-xs text-stone-400">
                    {[item.item_size, item.category_name].filter(Boolean).join(" • ")}
                  </div>
                </div>

                <div className="text-lg font-black text-amber-700 w-12 text-center">{item.cases_requested}</div>

                {order.status === "picking" ? (
                  <input type="number" min={0} value={item.cases_picked ?? ""} placeholder="0"
                    onChange={e => setCasesPicked(item.id, parseInt(e.target.value) || 0)}
                    className="w-14 text-center py-1 rounded border border-stone-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-green-500 print:hidden" />
                ) : (
                  <div className="w-14 text-center font-bold text-stone-600 print:hidden">{item.cases_picked || "—"}</div>
                )}
                <div className="hidden print:block w-14 text-center">
                  <div className="w-10 mx-auto border-b-2 border-stone-300 h-5" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
