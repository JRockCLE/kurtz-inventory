export const fmt$ = (n) => n != null ? `$${parseFloat(n).toFixed(2)}` : "—";

// Natural/smart sort comparator — sorts "2B" before "13A", etc.
const _collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return _collator.compare(String(a), String(b));
};

// Splits a location label into { prefix, rest }. A prefix is a single letter
// followed by a "-" at the start of the label (e.g. "C-159A" → C/159A).
// Plain labels and slot-style labels like "1A-3" return { prefix: "", rest: label }.
export const splitLocation = (label) => {
  if (label == null) return { prefix: "", rest: "" };
  const s = String(label);
  if (s.length >= 2 && s[1] === "-" && /[A-Za-z]/.test(s[0])) {
    return { prefix: s[0].toUpperCase(), rest: s.slice(2) };
  }
  return { prefix: "", rest: s };
};

// Sort comparator for warehouse locations: groups by prefix (alphabetical, no
// prefix first), then natural-compares the remainder.
export const compareLocation = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const sa = splitLocation(a);
  const sb = splitLocation(b);
  if (sa.prefix !== sb.prefix) return sa.prefix.localeCompare(sb.prefix);
  return _collator.compare(sa.rest, sb.rest);
};

// Color class for a location label: orange = dry (no prefix),
// blue = cooler (C-), green = freezer (F-).
export const prefixColorClass = (label) => {
  const p = splitLocation(label).prefix;
  if (p === "C") return "text-blue-600";
  if (p === "F") return "text-green-600";
  return "text-amber-700";
};

// Rewrite a Supabase Storage public URL to go through the image-transform
// endpoint, which serves a resized JPEG instead of the raw upload. ~7x smaller
// for typical phone photos.
export function imgUrl(url, { width, height, quality = 80 } = {}) {
  if (!url) return url;
  if (!url.includes("/storage/v1/object/")) return url;
  const rendered = url.replace("/storage/v1/object/", "/storage/v1/render/image/");
  const params = [];
  if (width) params.push(`width=${width}`);
  if (height) params.push(`height=${height}`);
  if (quality) params.push(`quality=${quality}`);
  return params.length ? `${rendered}?${params.join("&")}` : rendered;
}

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
