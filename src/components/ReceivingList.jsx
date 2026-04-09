import { useState, useEffect, useCallback } from "react";
import { qry } from "../lib/hooks";
import { fmt$ } from "../lib/helpers";

export default function ReceivingList({ onSelect, onCreate }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    qry("receiving_documents", { select: "*", order: "created_at.desc", limit: 100 })
      .then(setDocs).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusStyle = { draft: "bg-yellow-100 text-yellow-800", complete: "bg-green-100 text-green-800" };
  const statusEmoji = { draft: "📝", complete: "✅" };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-800">Receiving</h2>
          <p className="text-xs text-stone-400">Incoming shipments and inventory</p>
        </div>
        <button onClick={onCreate}
          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 transition-colors">
          + New Shipment
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-stone-50">
        {loading ? (
          <div className="p-8 text-center text-stone-400">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-4xl mb-2">📦</p>
            <p className="text-stone-500 text-sm">No receiving documents yet</p>
            <p className="text-stone-400 text-xs mt-1">Click "+ New Shipment" to start receiving inventory</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {docs.map(doc => (
              <button key={doc.id} onClick={() => onSelect(doc.id)}
                className="w-full text-left px-4 py-3 bg-white hover:bg-stone-50 transition-colors flex items-center gap-3">
                <span className="text-xl">{statusEmoji[doc.status] || "📝"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-stone-800">
                    {doc.supplier_name || "Unknown Supplier"}
                  </div>
                  <div className="text-xs text-stone-400">
                    {new Date(doc.received_date).toLocaleDateString()} — {doc.total_items || 0} items, {doc.total_cases || 0} cases
                    {doc.total_cost > 0 && ` — ${fmt$(doc.total_cost)}`}
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusStyle[doc.status] || statusStyle.draft}`}>
                  {doc.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
