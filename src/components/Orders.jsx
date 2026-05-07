import { useState, useEffect } from "react";
import { fetchOrderTypes } from "../lib/hooks";

const TYPE_BADGE = {
  dry: { label: "Dry", cls: "bg-amber-100 text-amber-800" },
  cooler: { label: "Cooler", cls: "bg-blue-100 text-blue-800" },
  freezer: { label: "Freezer", cls: "bg-green-100 text-green-800" },
  mixed: { label: "Mixed", cls: "bg-stone-200 text-stone-700" },
};

export default function Orders({ orders, loading, onSelect }) {
  const statusColors = {
    submitted: "bg-yellow-100 text-yellow-800 border-yellow-200",
    picking: "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-green-100 text-green-800 border-green-200",
  };
  const statusLabels = { submitted: "Needs Picked", picking: "In Progress", completed: "Completed" };
  const statusEmoji = { submitted: "📋", picking: "📦", completed: "✅" };

  const [typeMap, setTypeMap] = useState({});

  useEffect(() => {
    if (!orders.length) { setTypeMap({}); return; }
    let cancelled = false;
    fetchOrderTypes(orders.map(o => o.id))
      .then(s => { if (!cancelled) setTypeMap(s); })
      .catch(() => { if (!cancelled) setTypeMap({}); });
    return () => { cancelled = true; };
  }, [orders]);

  return (
    <div className="h-full overflow-auto bg-stone-50">
      {loading && orders.length === 0 ? (
        <div className="p-8 text-center text-stone-400">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-4xl mb-2">📦</p>
          <p className="text-stone-500 text-sm">No orders yet</p>
          <p className="text-stone-400 text-xs mt-1">Use the Store Lists tab to create your first list</p>
        </div>
      ) : (
        <div className="divide-y divide-stone-200">
          {orders.map(o => {
            const tb = typeMap[o.id] ? TYPE_BADGE[typeMap[o.id]] : null;
            return (
              <button
                key={o.id}
                onClick={() => onSelect(o.id)}
                className="w-full text-left px-4 py-3 bg-white hover:bg-stone-50 transition-colors grid items-center gap-3"
                style={{ gridTemplateColumns: "auto 360px 100px 130px 1fr" }}
              >
                <span className="text-xl">{statusEmoji[o.status] || "📋"}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-800 truncate">Pick List #{o.id}</div>
                  <div className="text-xs text-stone-400 truncate">
                    {new Date(o.created_at).toLocaleString()}
                    {o.notes && ` — ${o.notes}`}
                  </div>
                </div>
                <div>
                  {tb && (
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${tb.cls}`}>{tb.label}</span>
                  )}
                </div>
                <div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColors[o.status] || "bg-stone-100 text-stone-500 border-stone-200"}`}>
                    {statusLabels[o.status] || o.status}
                  </span>
                </div>
                <div />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
