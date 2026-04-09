import { useState, useEffect, useCallback } from "react";
import { qry } from "../lib/hooks";

export default function UnprocessedItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending"); // pending, processed, all
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const filters = filter === "all" ? "" : `status=eq.${filter}`;
    qry("unprocessed_items", {
      select: "*",
      filters: filters || undefined,
      order: "created_at.desc",
      limit: 500,
    }).then(setItems).catch(console.error).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const markProcessed = async (id) => {
    await qry("unprocessed_items", {
      update: { status: "processed", processed_at: new Date().toISOString() },
      match: { id },
    });
    load();
  };

  const markSkipped = async (id) => {
    await qry("unprocessed_items", {
      update: { status: "skipped", processed_at: new Date().toISOString() },
      match: { id },
    });
    load();
  };

  const deleteItem = async (id) => {
    if (!confirm("Delete this unprocessed item?")) return;
    await qry("unprocessed_items", { del: true, match: { id } });
    load();
  };

  const pendingCount = items.filter(i => i.status === "pending").length;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold text-stone-800">Unprocessed Items</h2>
            <p className="text-xs text-stone-400">{pendingCount} pending review</p>
          </div>
          <div className="flex rounded-lg border border-stone-300 overflow-hidden text-xs">
            {[{ id: "pending", label: "Pending" }, { id: "processed", label: "Processed" }, { id: "all", label: "All" }].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 font-medium transition-colors ${filter === f.id ? "bg-amber-600 text-white" : "bg-white text-stone-500 hover:bg-stone-50"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-stone-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-stone-400 text-sm">
            {filter === "pending" ? "No items pending review" : "No items found"}
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {items.map(item => {
              const isExpanded = expandedId === item.id;
              const photos = item.photos || [];
              return (
                <div key={item.id} className={`${item.status === "processed" ? "opacity-60" : ""}`}>
                  {/* Row */}
                  <div className="flex items-center px-4 py-3 hover:bg-stone-50 cursor-pointer gap-4"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-stone-200 flex-shrink-0 bg-stone-100">
                      {photos.length > 0 ? (
                        <img src={photos[0]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-300 text-lg">?</div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-stone-700 font-medium">{item.upc}</div>
                      <div className="text-xs text-stone-400 mt-0.5">
                        {photos.length} photo{photos.length !== 1 ? "s" : ""}
                        {item.notes && <span className="ml-2">— {item.notes}</span>}
                      </div>
                    </div>

                    <div className="text-xs text-amber-700 font-bold font-mono">{item.warehouse_location || "—"}</div>

                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      item.status === "pending" ? "bg-yellow-100 text-yellow-800" :
                      item.status === "processed" ? "bg-green-100 text-green-800" :
                      "bg-stone-100 text-stone-500"
                    }`}>
                      {item.status}
                    </div>

                    <div className="text-xs text-stone-400 w-[70px] text-right">
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-stone-50/50">
                      {/* Photos grid */}
                      {photos.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-3">
                          {photos.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className="block w-40 h-40 rounded-lg overflow-hidden border border-stone-200 hover:border-amber-400 transition-colors">
                              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-stone-500">
                        <span>UPC: <span className="font-mono font-medium text-stone-700">{item.upc}</span></span>
                        <span>Location: <span className="font-medium text-amber-700">{item.warehouse_location || "None"}</span></span>
                        <span>Scanned: {new Date(item.created_at).toLocaleString()}</span>
                      </div>

                      {item.status === "pending" && (
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => markProcessed(item.id)}
                            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">
                            Mark Processed
                          </button>
                          <button onClick={() => markSkipped(item.id)}
                            className="px-3 py-1.5 bg-stone-200 text-stone-700 rounded-lg text-xs font-medium hover:bg-stone-300">
                            Skip
                          </button>
                          <button onClick={() => deleteItem(item.id)}
                            className="px-3 py-1.5 text-red-500 hover:text-red-700 text-xs font-medium">
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
