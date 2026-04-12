import { useState, useEffect, useCallback } from "react";
import { qry, SB_URL, SB_KEY } from "../lib/hooks";
import { fmt$ } from "../lib/helpers";

const sbH = (schema = "posbe") => ({
  apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
  "Accept-Profile": schema, "Content-Profile": schema,
  "Content-Type": "application/json",
});

export default function SyncToStoreLive() {
  const [newItems, setNewItems] = useState([]);
  const [editedItems, setEditedItems] = useState([]);
  const [pendingItems, setPendingItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // New items: sync_status = 'local', no posbe_item_id
      const newData = await qry("local_items", {
        select: "id,name,upc,size,mfg_id,dept_id,category_id,sub_category_id,ref_unit_cd,retail_price,cost,case_size,sync_status,posbe_item_id,from_posbe,created_at",
        filters: "active_yn=eq.Y&sync_status=eq.local&posbe_item_id=is.null",
        order: "created_at.desc",
        limit: 500,
      });

      // Edited items: disabled for now — edits stay local
      const editedData = [];

      // Pending items: already approved, waiting for sync engine
      const pendingData = await qry("local_items", {
        select: "id,name,upc,size,sync_status,posbe_item_id,created_at",
        filters: "active_yn=eq.Y&sync_status=in.(pending_push,pushing,push_error)",
        order: "created_at.desc",
        limit: 500,
      });

      // Resolve names for display
      const allItems = [...newData, ...editedData];
      if (allItems.length > 0) {
        const resolve = async (ids, table, idCol, nameCol) => {
          if (!ids.length) return {};
          const res = await fetch(
            `${SB_URL}/rest/v1/${table}?${idCol}=in.(${ids.join(",")})&select=${idCol},${nameCol}`,
            { headers: sbH("posbe") }
          );
          if (!res.ok) return {};
          const data = await res.json();
          return Object.fromEntries(data.map(r => [String(r[idCol]), r[nameCol]]));
        };

        const mfgIds = [...new Set(allItems.map(i => i.mfg_id).filter(Boolean))];
        const deptIds = [...new Set(allItems.map(i => i.dept_id).filter(Boolean))];
        const catIds = [...new Set(allItems.map(i => i.category_id).filter(Boolean))];

        const [mfgMap, deptMap, catMap] = await Promise.all([
          resolve(mfgIds, "Vendor", "Vendor_ID", "Vendor_Name_TX"),
          resolve(deptIds, "Dept", "Dept_ID", "Name_TX"),
          resolve(catIds, "Category", "Category_ID", "Name_TX"),
        ]);

        allItems.forEach(i => {
          i._mfg_name = mfgMap[String(i.mfg_id)] || "";
          i._dept_name = deptMap[String(i.dept_id)] || "";
          i._cat_name = catMap[String(i.category_id)] || "";
        });
      }

      setNewItems(newData);
      setEditedItems(editedData);
      setPendingItems(pendingData);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllNew = () => {
    const allIds = newItems.map(i => i.id);
    const allSelected = allIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      allIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const selectAllEdited = () => {
    const allIds = editedItems.map(i => i.id);
    const allSelected = allIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      allIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const sendToStoreLive = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Send ${selected.size} item${selected.size > 1 ? "s" : ""} to StoreLIVE?\n\nThis will mark them as pending. The sync engine on the mini-PC will write them to the SQL Server database.`)) return;

    setSyncing(true);
    const ids = [...selected];
    let success = 0;
    let errors = 0;

    for (const id of ids) {
      try {
        await qry("local_items", {
          update: { sync_status: "pending_push", updated_at: new Date().toISOString() },
          match: { id },
        });
        success++;
      } catch (err) {
        errors++;
        console.error(`Failed to update item ${id}:`, err);
      }
    }

    setSyncLog(prev => [{
      time: new Date(),
      message: `Queued ${success} item${success > 1 ? "s" : ""} for sync${errors > 0 ? ` (${errors} failed)` : ""}`,
      type: errors > 0 ? "warning" : "success",
    }, ...prev].slice(0, 20));

    setSelected(new Set());
    load();
    setSyncing(false);
  };

  // Validation check — items need at minimum: name, upc, category_id, mfg_id
  const getIssues = (item) => {
    const issues = [];
    if (!item.name) issues.push("No name");
    if (!item.upc) issues.push("No UPC");
    if (!item.category_id) issues.push("No category");
    if (!item.mfg_id) issues.push("No manufacturer");
    return issues;
  };

  const statusBadge = (status) => {
    const styles = {
      pending_push: "bg-yellow-100 text-yellow-700",
      pushing: "bg-blue-100 text-blue-700",
      push_error: "bg-red-100 text-red-700",
      synced: "bg-green-100 text-green-700",
    };
    const labels = {
      pending_push: "Queued", pushing: "Syncing...", push_error: "Error", synced: "Synced",
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${styles[status] || "bg-stone-100 text-stone-500"}`}>
        {labels[status] || status}
      </span>
    );
  };

  const ItemRow = ({ item, showCheckbox = true }) => {
    const issues = getIssues(item);
    const hasIssues = issues.length > 0;
    const isChecked = selected.has(item.id);

    return (
      <div className={`flex items-center px-4 py-2.5 border-b border-stone-100 text-sm ${isChecked ? "bg-amber-50" : ""} ${hasIssues ? "opacity-60" : ""}`}>
        {showCheckbox && (
          <button
            onClick={() => !hasIssues && toggleSelect(item.id)}
            disabled={hasIssues}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center mr-3 flex-shrink-0 transition-colors ${
              hasIssues ? "border-stone-200 bg-stone-100 cursor-not-allowed" :
              isChecked ? "bg-amber-500 border-amber-500 text-white" : "border-stone-300 hover:border-amber-400"
            }`}
          >
            {isChecked && <span className="text-xs">✓</span>}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-stone-800 truncate">{item.name || "Unnamed"}</span>
            {item.from_posbe && <span className="text-[10px] text-green-600 font-bold">FROM POS</span>}
          </div>
          <div className="text-[11px] text-stone-400 flex gap-3 mt-0.5">
            <span className="font-mono">{item.upc || "No UPC"}</span>
            {item.size && <span>{item.size}</span>}
            {item._mfg_name && <span>{item._mfg_name}</span>}
            {item._dept_name && <span>{item._dept_name} › {item._cat_name}</span>}
            {item.retail_price && <span>{fmt$(item.retail_price)}</span>}
          </div>
          {hasIssues && (
            <div className="text-[10px] text-red-500 font-medium mt-0.5">
              Missing: {issues.join(", ")}
            </div>
          )}
        </div>
        {item.posbe_item_id && (
          <span className="text-[10px] text-stone-400 font-mono mr-3">POS #{item.posbe_item_id}</span>
        )}
        <span className="text-[10px] text-stone-400 flex-shrink-0">
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-stone-400">Loading...</div>;

  const totalSelectable = [...newItems, ...editedItems].filter(i => getIssues(i).length === 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-800">Sync to StoreLIVE</h2>
          <p className="text-xs text-stone-400">
            {newItems.length} new item{newItems.length !== 1 ? "s" : ""} to sync
            {pendingItems.length > 0 && ` — ${pendingItems.length} pending`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <span className="text-sm text-amber-700 font-semibold">{selected.size} selected</span>
          )}
          <button
            onClick={sendToStoreLive}
            disabled={selected.size === 0 || syncing}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${
              selected.size > 0
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-stone-200 text-stone-400 cursor-not-allowed"
            }`}
          >
            {syncing ? "Queuing..." : `Send to StoreLIVE (${selected.size})`}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ═══ PENDING SYNC (items already queued) ═══ */}
        {pendingItems.length > 0 && (
          <div className="mb-2">
            <div className="bg-yellow-600 text-white px-4 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Pending Sync ({pendingItems.length})</span>
              <span className="font-normal normal-case">Waiting for sync engine on mini-PC</span>
            </div>
            {pendingItems.map(item => (
              <div key={item.id} className="flex items-center px-4 py-2 border-b border-stone-100 text-sm bg-yellow-50/50">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-stone-700">{item.name}</span>
                  <span className="text-[11px] text-stone-400 ml-2 font-mono">{item.upc}</span>
                </div>
                {statusBadge(item.sync_status)}
              </div>
            ))}
          </div>
        )}

        {/* ═══ NEW ITEMS ═══ */}
        <div>
          <div className="bg-blue-700 text-white px-4 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-2">
              {newItems.length > 0 && (
                <button onClick={selectAllNew}
                  className="w-4 h-4 rounded border-2 border-white/50 flex items-center justify-center hover:border-white transition-colors">
                  {newItems.every(i => selected.has(i.id)) && newItems.length > 0 && <span className="text-[9px]">✓</span>}
                </button>
              )}
              <span>New Items ({newItems.length})</span>
            </div>
            <span className="font-normal normal-case">Items not yet in StoreLIVE</span>
          </div>
          {newItems.length === 0 ? (
            <div className="px-4 py-6 text-center text-stone-400 text-sm bg-stone-50">No new items to sync</div>
          ) : (
            newItems.map(item => <ItemRow key={item.id} item={item} />)
          )}
        </div>

        {/* ═══ EDITED ITEMS — hidden for now ═══ */}

        {/* ═══ SYNC LOG ═══ */}
        {syncLog.length > 0 && (
          <div className="mt-4 px-4 pb-4">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Activity Log</div>
            {syncLog.map((entry, i) => (
              <div key={i} className={`text-xs px-3 py-1.5 rounded mb-1 ${
                entry.type === "success" ? "bg-green-50 text-green-700" :
                entry.type === "warning" ? "bg-yellow-50 text-yellow-700" :
                "bg-stone-50 text-stone-500"
              }`}>
                <span className="text-stone-400 mr-2">{entry.time.toLocaleTimeString()}</span>
                {entry.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
