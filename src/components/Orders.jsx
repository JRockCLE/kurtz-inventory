export default function Orders({ orders, loading, onSelect }) {
  const statusColors = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    picking: "bg-blue-100 text-blue-800 border-blue-200",
    picked: "bg-green-100 text-green-800 border-green-200",
    delivered: "bg-stone-100 text-stone-500 border-stone-200",
  };
  const statusEmoji = { pending: "📋", picking: "📦", picked: "✅", delivered: "🚛" };

  return (
    <div className="flex-1 overflow-auto bg-stone-50">
      {loading ? (
        <div className="p-8 text-center text-stone-400">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-4xl mb-2">📦</p>
          <p className="text-stone-500 text-sm">No orders yet</p>
          <p className="text-stone-400 text-xs mt-1">Use the Store Lists tab to create your first list</p>
        </div>
      ) : (
        <div className="divide-y divide-stone-200">
          {orders.map(o => (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              className="w-full text-left px-4 py-3 bg-white hover:bg-stone-50 transition-colors flex items-center gap-3"
            >
              <span className="text-xl">{statusEmoji[o.status] || "📋"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-stone-800">Order #{o.id}</div>
                <div className="text-xs text-stone-400">
                  {new Date(o.created_at).toLocaleString()}
                  {o.notes && ` — ${o.notes}`}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColors[o.status]}`}>
                {o.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
