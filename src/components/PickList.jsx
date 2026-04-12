import { useState, useEffect, useCallback, useMemo } from "react";
import { qry, SB_URL, SB_KEY } from "../lib/hooks";
import { naturalCompare, fmtDate } from "../lib/helpers";

export default function PickList({ orderId, onBack, onUpdate, data }) {
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [whLocDetails, setWhLocDetails] = useState({});

  const unitMap = useMemo(() => Object.fromEntries((data?.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX])), [data]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      qry("store_orders", { select: "*", filters: `id=eq.${orderId}` }),
      qry("store_order_items", {
        select: "*",
        filters: `order_id=eq.${orderId}`,
        order: "item_name.asc",
      }),
      qry("warehouse_locations", { select: "label,section,aisle", filters: "active_yn=eq.Y", limit: 5000 }),
    ]).then(async ([o, i, locs]) => {
      setOrder(o[0]);

      // Fetch linked local_items for mfg/unit/exp date
      const itemIds = [...new Set(i.map(x => x.item_id).filter(Boolean))];
      let localById = {};
      if (itemIds.length) {
        try {
          const li = await qry("local_items", {
            select: "id,mfg_id,ref_unit_cd,expiration_date,size,name,warehouse_location",
            filters: `id=in.(${itemIds.join(",")})`,
          });
          // Resolve mfg names
          const mfgIds = [...new Set(li.map(x => x.mfg_id).filter(Boolean))];
          let mfgMap = {};
          if (mfgIds.length) {
            try {
              const mfgs = await fetch(
                `${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`,
                { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "posbe" } }
              ).then(r => r.json());
              mfgMap = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
            } catch {}
          }
          li.forEach(x => {
            x._mfg_name = mfgMap[String(x.mfg_id)] || "";
            localById[x.id] = x;
          });
        } catch {}
      }

      // Merge details into order items
      i.forEach(x => {
        const li = localById[x.item_id];
        if (li) {
          x._mfg_name = li._mfg_name;
          x._ref_unit_cd = li.ref_unit_cd;
          x._expiration_date = li.expiration_date;
          if (!x.warehouse_location) x.warehouse_location = li.warehouse_location;
        }
      });

      i.sort((a, b) => naturalCompare(a.warehouse_location, b.warehouse_location) || (a.item_name || "").localeCompare(b.item_name || ""));
      setItems(i);
      const m = {};
      locs.forEach(l => { m[l.label] = { section: l.section, aisle: l.aisle }; });
      setWhLocDetails(m);
    }).catch(console.error).finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (status) => {
    const u = { status, updated_at: new Date().toISOString() };
    if (status === "completed") u.picked_at = u.updated_at;
    await qry("store_orders", { update: u, match: { id: orderId } });
    setOrder(prev => ({ ...prev, ...u }));
    onUpdate?.();
  };

  const setCasesPicked = (itemId, qty) => {
    // Optimistic local update — no reload
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, cases_picked: qty, picked_yn: qty > 0 } : it));
    // Fire-and-forget save
    qry("store_order_items", {
      update: { cases_picked: qty, picked_yn: qty > 0 },
      match: { id: itemId },
    }).catch(console.error);
  };

  // Inline edit: update the local_item — no reload
  const updateItemField = (item, field, value) => {
    if (!item.item_id) return;
    const update = {};
    if (field === "warehouse_location") update.warehouse_location = value || null;
    if (field === "expiration_date") update.expiration_date = value && value.trim() ? value : null;
    update.updated_at = new Date().toISOString();

    // Optimistic local update
    setItems(prev => prev.map(it => {
      if (it.id !== item.id) return it;
      const next = { ...it };
      if (field === "warehouse_location") next.warehouse_location = value || null;
      if (field === "expiration_date") next._expiration_date = value && value.trim() ? value : null;
      return next;
    }));

    qry("local_items", { update, match: { id: item.item_id } }).catch(console.error);
    if (field === "warehouse_location") {
      qry("store_order_items", { update: { warehouse_location: value || null }, match: { id: item.id } }).catch(console.error);
    }
  };

  const statusLabels = { submitted: "Needs Picked", picking: "In Progress", completed: "Completed" };
  const statusColors = {
    submitted: "bg-yellow-100 text-yellow-800",
    picking: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
  };
  const isEditable = order?.status === "picking";

  if (loading || !order) return <div className="p-8 text-center text-stone-400">Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="text-stone-500 hover:text-stone-800 text-sm">← Pick Lists</button>
          <div className="flex gap-2">
            <button onClick={async () => {
                if (order.status === "submitted") await updateStatus("picking");
                window.print();
              }}
              className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              Print
            </button>
            {(order.status === "submitted" || order.status === "picking") && (
              <button onClick={() => updateStatus("completed")}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">
                Finalize Pick List
              </button>
            )}
            {order.status === "completed" && (
              <button onClick={() => updateStatus("picking")}
                className="px-3 py-1.5 bg-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-300">
                Reopen
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-stone-800">Pick List #{order.id}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[order.status] || "bg-stone-100 text-stone-600"}`}>
            {statusLabels[order.status] || order.status}
          </span>
          <span className="text-xs text-stone-400">{new Date(order.created_at).toLocaleString()}</span>
          {order.status === "submitted" && (
            <span className="text-xs text-stone-500 italic">Print to begin picking</span>
          )}
          {order.status === "picking" && (
            <span className="text-xs text-blue-600 italic">Make corrections and enter picked qty — click "Finalize Pick List" when done</span>
          )}
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
        {/* Column headers */}
        <div className="grid border-b-2 border-stone-300 bg-stone-100 text-[10px] font-bold text-stone-500 uppercase sticky top-0 z-10 print:hidden"
          style={{ gridTemplateColumns: "70px 130px 1fr 90px 90px 1fr 75px 75px" }}>
          <div className="px-2 py-1.5 text-center border-r border-stone-200">WH Loc</div>
          <div className="px-2 py-1.5 border-r border-stone-200">Mfg</div>
          <div className="px-2 py-1.5 border-r border-stone-200">Description</div>
          <div className="px-2 py-1.5 text-center border-r border-stone-200">Size/Unit</div>
          <div className="px-2 py-1.5 text-center border-r border-stone-200">Exp Date</div>
          <div className="px-2 py-1.5 border-r border-stone-200">Notes</div>
          <div className="px-2 py-1.5 text-center border-r border-stone-200">Case Qty</div>
          <div className="px-2 py-1.5 text-center">Picked</div>
        </div>

        {/* Print header */}
        <table className="hidden print:table w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
          <thead style={{ display: "table-header-group" }}>
            <tr className="border-b-2 border-stone-400 text-[10px] font-bold text-stone-600 uppercase">
              <th className="px-2 py-1.5 text-center whitespace-nowrap">WH Loc</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap">Mfg</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-center whitespace-nowrap">Size/Unit</th>
              <th className="px-2 py-1.5 text-center whitespace-nowrap">Exp Date</th>
              <th className="px-2 py-1.5 text-left" style={{ minWidth: "1.5in" }}>Notes</th>
              <th className="px-2 py-1.5 text-center" style={{ width: "60px" }}>Case Qty</th>
              <th className="px-2 py-1.5 text-center" style={{ width: "70px" }}>Picked</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, ii) => {
              const sizeUnit = [item.item_size || item._item_size, item._ref_unit_cd ? unitMap[String(item._ref_unit_cd)] : null].filter(Boolean).join(" ");
              return (
                <tr key={`p-${item.id}`} className={ii % 2 ? "bg-stone-50" : ""}>
                  <td className="px-2 py-1.5 text-center font-bold text-stone-800 border-b border-stone-200 whitespace-nowrap">{item.warehouse_location || "—"}</td>
                  <td className="px-2 py-1.5 text-stone-500 border-b border-stone-200 whitespace-nowrap">{item._mfg_name || "—"}</td>
                  <td className="px-2 py-1.5 font-medium text-stone-800 border-b border-stone-200">{item.item_name}</td>
                  <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{sizeUnit || "—"}</td>
                  <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{item._expiration_date ? fmtDate(item._expiration_date) : "—"}</td>
                  <td className="px-2 py-1.5 text-xs text-stone-700 border-b border-stone-200">{item.notes || ""}</td>
                  <td className="px-2 py-1.5 text-center text-base font-black text-amber-700 border border-stone-300">{item.cases_requested}</td>
                  <td className="px-1 py-1 border border-stone-300" style={{ height: "32px" }}></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Screen rows */}
        <div className="print:hidden">
          {items.map((item, ii) => {
            const sizeUnit = [item.item_size, item._ref_unit_cd ? unitMap[String(item._ref_unit_cd)] : null].filter(Boolean).join(" ");
            return (
              <div key={item.id}
                className={`grid border-b border-stone-100 items-center text-sm ${item.picked_yn ? "bg-green-50" : ii % 2 ? "bg-stone-50/40" : ""}`}
                style={{ gridTemplateColumns: "70px 130px 1fr 90px 90px 1fr 75px 75px" }}>
                {isEditable ? (
                  <div className="px-1 py-1 text-center border-r border-stone-100">
                    <input type="text" defaultValue={item.warehouse_location || ""}
                      onBlur={e => { if (e.target.value !== (item.warehouse_location || "")) updateItemField(item, "warehouse_location", e.target.value); }}
                      className="w-full text-center px-1 py-1 text-xs font-bold border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                ) : (
                  <div className="px-2 py-2 text-center border-r border-stone-100 font-bold text-stone-800">{item.warehouse_location || "—"}</div>
                )}
                <div className="px-2 py-2 border-r border-stone-100 truncate text-stone-500 text-xs">{item._mfg_name || "—"}</div>
                <div className={`px-2 py-2 border-r border-stone-100 truncate font-medium ${item.picked_yn ? "line-through text-stone-400" : "text-stone-800"}`}>{item.item_name}</div>
                <div className="px-2 py-2 text-center border-r border-stone-100 text-stone-500 text-xs">{sizeUnit || "—"}</div>
                {isEditable ? (
                  <div className="px-1 py-1 text-center border-r border-stone-100">
                    <input type="date" defaultValue={item._expiration_date ? new Date(item._expiration_date).toISOString().slice(0, 10) : ""}
                      onBlur={e => updateItemField(item, "expiration_date", e.target.value)}
                      className="w-full px-1 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                ) : (
                  <div className="px-2 py-2 text-center border-r border-stone-100 text-stone-500 text-xs">{item._expiration_date ? fmtDate(item._expiration_date) : "—"}</div>
                )}
                <div className="px-2 py-2 border-r border-stone-100 text-xs text-amber-700 italic truncate">{item.notes || ""}</div>
                <div className="px-2 py-2 text-center border-r border-stone-100 text-xl font-black text-amber-700">{item.cases_requested}</div>
                <div className="px-1 py-1 flex items-center justify-center">
                  {isEditable ? (
                    <input type="number" min={0} value={item.cases_picked ?? ""} placeholder="—"
                      onChange={e => setCasesPicked(item.id, parseInt(e.target.value) || 0)}
                      className="w-14 text-center py-1.5 rounded border border-stone-300 text-base font-bold focus:outline-none focus:ring-2 focus:ring-green-500" />
                  ) : (
                    <span className="text-base font-bold text-stone-700">{item.cases_picked || "—"}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
