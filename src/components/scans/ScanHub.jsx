import { useState, useEffect, useCallback } from "react";
import { scansApi } from "../../lib/scansApi";
import { isMockMode } from "../../lib/scanAgent";
import NewScanFlow from "./NewScanFlow";
import ScanDetail from "./ScanDetail";
import PageThumbnail from "./PageThumbnail";

/**
 * Top-level Scan Hub.
 * Manages internal sub-views: list | new | detail
 */
export default function ScanHub() {
  const [view, setView] = useState("list");        // 'list' | 'new' | 'detail'
  const [selectedId, setSelectedId] = useState(null);

  const goToList = () => { setView("list"); setSelectedId(null); };
  const goToNew = () => setView("new");
  const goToDetail = (id) => { setSelectedId(id); setView("detail"); };

  if (view === "new") {
    return <NewScanFlow onComplete={(id) => goToDetail(id)} onCancel={goToList} />;
  }
  if (view === "detail" && selectedId) {
    return <ScanDetail scanId={selectedId} onBack={goToList} onDeleted={goToList} />;
  }
  return <ScanList onSelect={goToDetail} onNew={goToNew} />;
}

// ─── List subview ───────────────────────────────────────────────────

function ScanList({ onSelect, onNew }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [pcFilter, setPcFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await scansApi.list({ limit: 200 });
      setScans(list);
    } catch (e) {
      console.error("scans list failed:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Unique PC names for filter dropdown
  const pcs = [...new Set(scans.map(s => s.scanned_on_pc).filter(Boolean))].sort();

  // Apply filters
  const filtered = scans.filter(s => {
    if (filter && !s.title?.toLowerCase().includes(filter.toLowerCase())
              && !s.scanned_by_user?.toLowerCase().includes(filter.toLowerCase())) return false;
    if (pcFilter && s.scanned_on_pc !== pcFilter) return false;
    return true;
  });

  // Group by date label
  const groups = groupByDate(filtered);

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* Top bar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
            📁 Scan Hub
            {isMockMode() && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">MOCK MODE</span>
            )}
          </h2>
          <p className="text-xs text-stone-400">
            {scans.length} scan{scans.length === 1 ? "" : "s"} · all paperwork in one place
          </p>
        </div>
        <button
          onClick={onNew}
          className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-base font-bold shadow-sm hover:shadow transition-all flex items-center gap-2"
        >
          <span className="text-xl leading-none">+</span> NEW SCAN
        </button>
      </div>

      {/* Filters */}
      {scans.length > 0 && (
        <div className="bg-white border-b border-stone-200 px-4 py-2 flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by title or person..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {pcs.length > 1 && (
            <select
              value={pcFilter}
              onChange={e => setPcFilter(e.target.value)}
              className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All PCs</option>
              {pcs.map(pc => <option key={pc} value={pc}>{pc}</option>)}
            </select>
          )}
          {(filter || pcFilter) && (
            <button
              onClick={() => { setFilter(""); setPcFilter(""); }}
              className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-800"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* List body */}
      <div className="flex-1 overflow-auto">
        {loading && scans.length === 0 ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading scans...</div>
        ) : scans.length === 0 ? (
          <EmptyState onNew={onNew} />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-stone-400 text-sm">No scans match your filters.</div>
        ) : (
          <div className="p-4 space-y-6">
            {groups.map(g => (
              <div key={g.label}>
                <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2 px-1">{g.label}</div>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                  {g.scans.map(scan => (
                    <ScanCard key={scan.id} scan={scan} onClick={() => onSelect(scan.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ScanCard ───────────────────────────────────────────────────────

function ScanCard({ scan, onClick }) {
  // Get the first page for preview
  const [firstPage, setFirstPage] = useState(null);
  const [loadingPage, setLoadingPage] = useState(true);

  useEffect(() => {
    let cancelled = false;
    scansApi.get(scan.id).then(s => {
      if (!cancelled && s?.pages?.[0]) setFirstPage(s.pages[0]);
      if (!cancelled) setLoadingPage(false);
    }).catch(() => { if (!cancelled) setLoadingPage(false); });
    return () => { cancelled = true; };
  }, [scan.id]);

  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-stone-200 rounded-xl p-4 hover:border-amber-400 hover:shadow-md transition-all group"
    >
      <div className="flex gap-3">
        {/* Thumbnail */}
        <div className="flex-shrink-0">
          {loadingPage ? (
            <div className="w-20 h-24 bg-stone-100 rounded-lg" />
          ) : firstPage ? (
            <PageThumbnail page={firstPage} size="sm" />
          ) : (
            <div className="w-20 h-24 bg-stone-100 rounded-lg flex items-center justify-center text-stone-300 text-2xl">📄</div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-stone-800 truncate group-hover:text-amber-700 transition-colors">
            {scan.title}
          </div>
          <div className="text-xs text-stone-400 mt-0.5">
            {scan.page_count} page{scan.page_count === 1 ? "" : "s"} · {scan.total_size_kb} KB
          </div>
          <div className="text-xs text-stone-400 mt-1">
            {scan.scanned_by_user && <span className="font-medium">{scan.scanned_by_user}</span>}
            {scan.scanned_by_user && scan.scanned_on_pc && " · "}
            {scan.scanned_on_pc}
          </div>
          <div className="text-xs text-stone-400 mt-1">{formatTime(scan.created_at)}</div>

          {/* Action chips (placeholders for later) */}
          <div className="flex gap-1.5 mt-2">
            <span
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-400 rounded cursor-not-allowed"
              title="Email — coming soon"
            >
              ✉ Email
            </span>
            <span
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-400 rounded cursor-not-allowed"
              title="PDF download — coming soon"
            >
              📑 PDF
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── EmptyState ─────────────────────────────────────────────────────

function EmptyState({ onNew }) {
  return (
    <div className="p-12 text-center">
      <div className="text-6xl mb-4">📁</div>
      <div className="text-stone-700 font-bold text-lg mb-1">No scans yet</div>
      <p className="text-stone-400 text-sm mb-6">
        Scan paperwork once, and the whole team can access it from any computer.
      </p>
      <button
        onClick={onNew}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-base font-bold shadow-sm transition-all"
      >
        Start Your First Scan
      </button>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function groupByDate(scans) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  const groups = { Today: [], Yesterday: [], "This Week": [], Older: [] };
  for (const s of scans) {
    const d = new Date(s.created_at);
    const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
    if (dDay.getTime() === today.getTime()) groups.Today.push(s);
    else if (dDay.getTime() === yesterday.getTime()) groups.Yesterday.push(s);
    else if (d >= weekAgo) groups["This Week"].push(s);
    else groups.Older.push(s);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, scans: list }));
}

function formatTime(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  const isToday = dDay.getTime() === today.getTime();
  return isToday
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
