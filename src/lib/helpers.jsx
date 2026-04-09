export const fmt$ = (n) => n != null ? `$${parseFloat(n).toFixed(2)}` : "—";

export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`;
};

export function SyncBadge({ status }) {
  const styles = {
    synced: "bg-green-100 text-green-700",
    local: "bg-purple-100 text-purple-700",
    pending: "bg-yellow-100 text-yellow-700",
    pushed: "bg-blue-100 text-blue-700",
    error: "bg-red-100 text-red-700",
  };
  const labels = {
    synced: "POS", local: "Local", pending: "Pending", pushed: "Pushed", error: "Error",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${styles[status] || styles.synced}`}>
      {labels[status] || status}
    </span>
  );
}
