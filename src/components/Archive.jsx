import { useEffect, useState, useMemo, useCallback } from "react";
import { qry, SB_URL, SB_KEY } from "../lib/hooks";
import { fmtDate, btnSecondary, btnDanger } from "../lib/helpers";
import EmptyState from "./ui/EmptyState";
import { useToast, useConfirm, useAlert } from "./ui/UIProvider";

/**
 * Archive of soft-deleted items. From here you can:
 *   - Restore an item (clear archived_at)
 *   - Permanently delete — but only if no order / receiving history references it,
 *     otherwise we block so history stays coherent.
 *
 * Layout mirrors the Items page: sortable column headers, same row cadence,
 * same ColHead styling. Fewer columns because an archived item doesn't
 * need the full inventory/pricing picture — just enough to identify it.
 */

const sbH = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

async function fetchArchived() {
  const res = await fetch(
    `${SB_URL}/rest/v1/local_items?archived_at=not.is.null` +
    `&select=id,upc,name,size,mfg_id,dept_id,category_id,ref_unit_cd,archived_at,updated_at` +
    `&order=archived_at.desc&limit=1000`,
    { headers: sbH() }
  );
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// Count references in tables that might FK to local_items.id — deletion is
// blocked if any exist so historical documents stay linked.
async function countRefs(itemId) {
  const targets = [
    { table: "store_order_items",     col: "item_id" },
    { table: "wholesale_order_items", col: "item_id" },
    { table: "local_item_locations",  col: "local_item_id" },
  ];
  const results = {};
  await Promise.all(targets.map(async t => {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/${t.table}?${t.col}=eq.${itemId}&select=${t.col}`,
        { headers: { ...sbH(), Prefer: "count=exact", Range: "0-0" } }
      );
      const range = res.headers.get("content-range") || "";
      const total = parseInt(range.split("/")[1], 10);
      results[t.table] = Number.isFinite(total) ? total : 0;
    } catch { results[t.table] = 0; }
  }));
  return results;
}

// Field accessors for sort. Match the keys used by ColHead's `col`.
const SORT_ACCESSORS = {
  upc:          (i, m) => (i.upc || "").toLowerCase(),
  mfg_id:       (i, m) => (m.vendor[i.mfg_id] || "").toLowerCase(),
  name:         (i, m) => (i.name || "").toLowerCase(),
  size:         (i, m) => (i.size || "").toLowerCase(),
  ref_unit_cd:  (i, m) => (m.unit[String(i.ref_unit_cd)] || "").toLowerCase(),
  dept_id:      (i, m) => (m.dept[i.dept_id] || "").toLowerCase(),
  category_id:  (i, m) => (m.cat[i.category_id] || "").toLowerCase(),
  archived_at:  (i)    => i.archived_at ? new Date(i.archived_at).getTime() : 0,
};

export default function Archive({ data = {} }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(null);
  const [sortBy, setSortBy] = useState("archived_at");
  const [sortDir, setSortDir] = useState("desc");

  const toast   = useToast();
  const confirm = useConfirm();
  const alert   = useAlert();

  const maps = useMemo(() => ({
    dept:   Object.fromEntries((data.depts      || []).map(d => [d.Dept_ID,     d.Name_TX])),
    cat:    Object.fromEntries((data.categories || []).map(c => [c.Category_ID, c.Name_TX])),
    unit:   Object.fromEntries((data.units      || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX])),
    vendor: Object.fromEntries((data.vendors    || []).map(v => [v.Vendor_ID,   v.Vendor_Name_TX])),
  }), [data.depts, data.categories, data.units, data.vendors]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try { setItems(await fetchArchived()); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i =>
        (i.name || "").toLowerCase().includes(q) ||
        (i.upc  || "").toLowerCase().includes(q) ||
        (maps.vendor[i.mfg_id]   || "").toLowerCase().includes(q) ||
        (maps.dept[i.dept_id]    || "").toLowerCase().includes(q) ||
        (maps.cat[i.category_id] || "").toLowerCase().includes(q)
      );
    }
    const getter = SORT_ACCESSORS[sortBy] || SORT_ACCESSORS.archived_at;
    const sorted = [...list].sort((a, b) => {
      const va = getter(a, maps);
      const vb = getter(b, maps);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
    return sorted;
  }, [items, search, sortBy, sortDir, maps]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir(col === "archived_at" ? "desc" : "asc"); }
  };
  const arrow = (col) => sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const ColHead = ({ col, children, className = "" }) => (
    <th className={`px-3 py-2 text-[10px] font-bold text-stone-500 uppercase tracking-wider cursor-pointer hover:text-stone-700 select-none whitespace-nowrap ${className}`}
      onClick={() => toggleSort(col)}>{children}{arrow(col)}</th>
  );

  const restore = async (it) => {
    setBusy(it.id);
    try {
      await qry("local_items", {
        update: { archived_at: null, active_yn: "Y", updated_at: new Date().toISOString() },
        match: { id: it.id },
      });
      setItems(prev => prev.filter(x => x.id !== it.id));
      toast.success(`"${it.name}" restored`);
    } catch (e) { toast.error(`Restore failed: ${e.message}`); }
    setBusy(null);
  };

  const hardDelete = async (it) => {
    setBusy(it.id);
    try {
      const refs = await countRefs(it.id);
      const historical = (refs.store_order_items || 0) + (refs.wholesale_order_items || 0);

      if (historical > 0) {
        const parts = [];
        if (refs.store_order_items)     parts.push(`${refs.store_order_items} store list line(s)`);
        if (refs.wholesale_order_items) parts.push(`${refs.wholesale_order_items} wholesale invoice line(s)`);
        await alert({
          title: "Can't delete — item is in use",
          message:
            `"${it.name}" is referenced by:\n\n  • ${parts.join("\n  • ")}\n\n` +
            `Deleting would break history. Leave it archived; the item won't appear in day-to-day lists.`,
        });
        setBusy(null);
        return;
      }

      const extras = refs.local_item_locations
        ? `\n\nThis will also remove ${refs.local_item_locations} location assignment(s).`
        : "";
      const ok = await confirm({
        title: "Delete permanently?",
        message: `Delete "${it.name}"?${extras}\n\nThis cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) { setBusy(null); return; }

      if (refs.local_item_locations > 0) {
        await qry("local_item_locations", { del: true, match: { local_item_id: it.id } });
      }
      await qry("local_items", { del: true, match: { id: it.id } });
      setItems(prev => prev.filter(x => x.id !== it.id));
      toast.success(`"${it.name}" deleted`);
    } catch (e) { toast.error(`Delete failed: ${e.message}`); }
    setBusy(null);
  };

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-stone-800">Archive</h2>
          <p className="text-xs text-stone-400">
            Items removed from active lists. Restore to bring them back, or delete permanently if nothing references them.
          </p>
        </div>
        <div className="flex-1" />
        <input type="text" placeholder="Search archived..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 w-64" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading...</div>
        ) : err ? (
          <div className="p-8 text-center text-red-600 text-sm">
            {err}
            <div className="text-xs text-stone-500 mt-1">Run the local_items_archived.sql migration first.</div>
          </div>
        ) : filtered.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title="Nothing archived"
              message="Items you remove from the Items list will show up here so you can restore or permanently delete them." />
          ) : (
            <EmptyState title="No matches" message={`No archived items match "${search}".`} />
          )
        ) : (
          <table className="w-full text-sm border-collapse bg-white">
            <thead className="sticky top-0 z-10">
              <tr className="bg-stone-700 text-white text-[10px] font-bold uppercase tracking-wider">
                <th colSpan={5} className="px-2 py-1 text-left border-r border-stone-500/50">Item Info</th>
                <th colSpan={2} className="px-2 py-1 text-left border-r border-stone-500/50">Categorization</th>
                <th colSpan={1} className="px-2 py-1 text-left border-r border-stone-500/50">Archive</th>
                <th className="bg-stone-700"></th>
              </tr>
              <tr className="bg-stone-100 border-b border-stone-300">
                <ColHead col="upc"         className="text-left w-[130px]">UPC</ColHead>
                <ColHead col="mfg_id"      className="text-left w-[120px]">Mfg</ColHead>
                <ColHead col="name"        className="text-left">Name</ColHead>
                <ColHead col="size"        className="text-left w-[60px]">Size</ColHead>
                <ColHead col="ref_unit_cd" className="text-left w-[50px] border-r border-stone-200">Unit</ColHead>
                <ColHead col="dept_id"     className="text-left w-[120px]">Dept</ColHead>
                <ColHead col="category_id" className="text-left w-[140px] border-r border-stone-200">Category</ColHead>
                <ColHead col="archived_at" className="text-left w-[130px] border-r border-stone-200">Archived</ColHead>
                <th className="px-3 py-2 w-[180px]"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => {
                const mfgRaw   = maps.vendor[it.mfg_id]   || "—";
                const mfgShort = mfgRaw.length > 16 ? mfgRaw.slice(0, 14) + "…" : mfgRaw;
                const dept     = maps.dept[it.dept_id]    || "—";
                const cat      = maps.cat[it.category_id] || "—";
                const unit     = maps.unit[String(it.ref_unit_cd)] || "—";
                return (
                  <tr key={it.id}
                    className={`border-b border-stone-100 hover:bg-amber-50/70 transition-colors ${i % 2 ? "bg-stone-50/40" : "bg-white"}`}>
                    <td className="px-3 py-1.5">
                      <div className="text-[11px] text-stone-500 font-mono truncate max-w-[110px]" title={it.upc || ""}>{it.upc || "—"}</div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate" title={mfgRaw}>{mfgShort}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-stone-800 truncate max-w-[400px]" title={it.name}>{it.name}</div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-500">{it.size || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 border-r border-stone-100">{unit}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate" title={dept}>{dept}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-500 truncate border-r border-stone-100" title={cat}>{cat}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-400 border-r border-stone-100 whitespace-nowrap">{fmtDate(it.archived_at)}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => restore(it)} disabled={busy === it.id} className={btnSecondary}>
                          Restore
                        </button>
                        <button onClick={() => hardDelete(it)} disabled={busy === it.id} className={btnDanger}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
