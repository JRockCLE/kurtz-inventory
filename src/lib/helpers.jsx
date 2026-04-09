export const fmt$ = (n) => n != null ? `$${parseFloat(n).toFixed(2)}` : "—";

// Natural/smart sort comparator — sorts "2B" before "13A", etc.
const _collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return _collator.compare(String(a), String(b));
};

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
