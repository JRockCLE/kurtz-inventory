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
 */

const sbH = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

async function fetchArchived() {
  const res = await fetch(
    `${SB_URL}/rest/v1/local_items?archived_at=not.is.null&select=id,upc,name,size,mfg_id,warehouse_location,store_location,archived_at,updated_at&order=archived_at.desc&limit=1000`,
    { headers: sbH() }
  );
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// Count references in tables that might FK to local_items.id — deletion is
// blocked if any exist so historical documents stay linked. All tables use
// `count=exact` via Prefer header and read the content-range for the total.
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

export default function Archive() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(null);   // item id currently mid-operation

  const toast   = useToast();
  const confirm = useConfirm();
  const alert   = useAlert();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try { setItems(await fetchArchived()); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(i =>
      (i.name || "").toLowerCase().includes(q) ||
      (i.upc  || "").toLowerCase().includes(q) ||
      (i.warehouse_location || "").toLowerCase().includes(q)
    );
  }, [items, search]);

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

      // Clean up child rows first (nothing else references this item now)
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
          <div className="divide-y divide-stone-200">
            {filtered.map(it => (
              <div key={it.id}
                className="px-4 py-3 bg-white hover:bg-stone-50 grid items-center gap-3"
                style={{ gridTemplateColumns: "1fr 140px 90px 130px auto" }}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-800 truncate">{it.name}</div>
                  <div className="text-xs text-stone-400 truncate font-mono">{it.upc || "—"}</div>
                </div>
                <div className="text-xs text-stone-500 truncate">{it.warehouse_location || "—"}</div>
                <div className="text-xs text-stone-500">{it.size || "—"}</div>
                <div className="text-xs text-stone-400">Archived {fmtDate(it.archived_at)}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => restore(it)} disabled={busy === it.id}
                    className={btnSecondary}>
                    Restore
                  </button>
                  <button onClick={() => hardDelete(it)} disabled={busy === it.id}
                    className={btnDanger}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
