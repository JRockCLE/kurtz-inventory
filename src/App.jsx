import { useState, useEffect } from "react";
import { useRefData, useOrders, qry } from "./lib/hooks";
import Items from "./components/Items";
import ReceivingList from "./components/ReceivingList";
import ReceivingDoc from "./components/ReceivingDoc";
import StoreNeeds from "./components/StoreNeeds";
import Orders from "./components/Orders";
import PickList from "./components/PickList";
import WholesaleOrders from "./components/WholesaleOrders";
import Customers from "./components/Customers";
import QuickAdd from "./components/QuickAdd";
import UnprocessedItems from "./components/UnprocessedItems";
import NeedsLocations from "./components/NeedsLocations";
import Locations from "./components/Locations";
import Archive from "./components/Archive";
import ScanHub from "./components/scans/ScanHub";
import ItemModal from "./components/ItemModal";
import SettingsModal from "./components/SettingsModal";

// ─── Top-nav modules ──────────────────────────────────────────────────
//   Each module lives at #{id} in the URL hash. Modules with sub-pages
//   (Item Management, Wholesale Orders) render a sidebar listing the
//   sub-pages; single-page modules show only the pinned Archived/Settings
//   in the sidebar's bottom section.
// `type: "header"` entries in `sub` render as non-clickable group labels.
// Everything else is a clickable sub-page keyed by `id`.
const MODULES = [
  {
    id: "items",
    label: "Item Management",
    sub: [
      { id: "active",          label: "Items" },
      { id: "archived",        label: "Archived Items",      indent: true },
      { id: "locations",       label: "Warehouse Locations" },
      { type: "header",        label: "Tasks" },
      { id: "quick-add",       label: "Quick Add",           indent: true },
      { id: "unprocessed",     label: "Unprocessed Items",   indent: true },
      { id: "needs-locations", label: "Needs Locations",     indent: true },
    ],
  },
  { id: "store-lists", label: "Store Lists" },
  { id: "pick-lists",  label: "Pick Lists" },
  { id: "receiving",   label: "Receiving" },
  {
    id: "wholesale",
    label: "Wholesale Orders",
    sub: [
      { id: "orders",    label: "Orders" },
      { id: "customers", label: "Customers" },
    ],
  },
  // Hidden from the top nav for now — the module + routing stay wired up,
  // so `#scans` in the URL still opens the Scan Hub if someone bookmarks it.
  // Remove `hidden: true` to bring the button back.
  { id: "scans", label: "Scans", hidden: true },
];

const MODULE_IDS = MODULES.map(m => m.id);

function parseHash() {
  if (typeof window === "undefined") return { module: "items", sub: null };
  const raw = window.location.hash.replace("#", "");
  const [module, sub] = raw.split("/");
  if (!MODULE_IDS.includes(module)) return { module: "items", sub: null };
  return { module, sub: sub || null };
}

export default function App() {
  const [{ module, sub }, setNav] = useState(parseHash);
  const [selectedOrder, setSelectedOrder]     = useState(null);
  const [selectedRecvDoc, setSelectedRecvDoc] = useState(null);
  const [editItem, setEditItem]               = useState(null);
  const [showEditModal, setShowEditModal]     = useState(false);
  const [itemsRefresh, setItemsRefresh]       = useState(0);
  const [settingsOpen, setSettingsOpen]       = useState(false);
  const [companyLogo, setCompanyLogo]         = useState(null);

  // Load the company logo from invoice_settings so we can show it in the nav.
  // Re-load when the Settings modal closes so a fresh upload appears immediately.
  useEffect(() => {
    (async () => {
      try {
        const rows = await qry("invoice_settings", { filters: "id=eq.1", limit: 1 });
        setCompanyLogo(rows?.[0]?.logo_url || null);
      } catch { /* not fatal — falls back to the emoji */ }
    })();
  }, [settingsOpen]);

  // Sidebar defaults to expanded for modules with sub-items, collapsed for
  // modules without (and always collapsed on mobile). Resets to the default
  // when you change modules; manual toggles hold within a single module.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const initialModule = MODULES.find(m => m.id === parseHash().module);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (isMobile) return true;
    return !initialModule?.sub?.length;
  });

  const data = useRefData();
  const { orders, loading: ordersLoading, refresh: refreshOrders } = useOrders();

  // Keep hash in sync with nav
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = sub ? `#${module}/${sub}` : `#${module}`;
    if (window.location.hash !== target) window.history.replaceState(null, "", target);
  }, [module, sub]);

  // Snap sidebar to the module default on module change (not sub change).
  useEffect(() => {
    if (isMobile) { setSidebarCollapsed(true); return; }
    const m = MODULES.find(mod => mod.id === module);
    setSidebarCollapsed(!m?.sub?.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  const pendingCount = orders.filter(o => o.status === "submitted" || o.status === "picking").length;

  const currentModule = MODULES.find(m => m.id === module);
  // Default sub-page = first clickable (skip header entries).
  const effectiveSub = sub || currentModule?.sub?.find(s => s.id)?.id || null;

  const goto = (moduleId, subId = null) => {
    const target = MODULES.find(m => m.id === moduleId);
    // External modules (like Scans) navigate the browser.
    if (target?.external) { window.location.href = target.external; return; }
    setNav({ module: moduleId, sub: subId });
    setSelectedOrder(null);
    setSelectedRecvDoc(null);
  };

  const handleEditItem = (item) => { setEditItem(item); setShowEditModal(true); };
  const handleAddItem  = () => { setEditItem(null); setShowEditModal(true); };
  const handleEditSave = () => { setShowEditModal(false); setEditItem(null); setItemsRefresh(t => t + 1); data.refresh(); };

  if (data.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-100">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">🏪</div>
          <p className="text-stone-500 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-stone-100 print:bg-white print:h-auto">
      {/* ─── Top nav ─── */}
      {/* Grid with three equal-width columns so the module bar always sits at
          the true viewport center regardless of brand or Settings width. */}
      <div className="bg-stone-800 text-white grid grid-cols-3 items-center print:hidden">
        {/* Left: brand */}
        <div className="flex items-center gap-3 px-4 py-1 self-stretch">
          {companyLogo ? (
            <img src={companyLogo} alt="Logo" className="h-14 w-auto object-contain shrink-0" />
          ) : (
            <span className="text-lg">🏪</span>
          )}
          <span className="font-bold text-sm tracking-wide">INVENTORY MANAGEMENT</span>
        </div>

        {/* Center: module buttons */}
        <div className="flex justify-center">
          {MODULES.filter(m => !m.hidden).map(m => {
            const active = m.id === module;
            const badge = m.id === "pick-lists" ? pendingCount : 0;
            return (
              <button key={m.id}
                onClick={() => goto(m.id)}
                className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap ${
                  active ? "border-amber-500 text-amber-400 bg-stone-700" : "border-transparent text-stone-100 hover:text-white hover:bg-stone-700/50"
                }`}>
                <span>{m.label}</span>
                {badge > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">{badge}</span>}
              </button>
            );
          })}
        </div>

        {/* Right: settings */}
        <div className="flex justify-end self-stretch">
          <button onClick={() => setSettingsOpen(true)}
            className="px-4 py-2.5 text-sm font-semibold text-stone-100 hover:text-white hover:bg-stone-700/50 transition-colors"
            title="Settings">
            Settings
          </button>
        </div>
      </div>

      {/* ─── Body: sidebar + content ─── */}
      <div className="flex-1 flex overflow-hidden print:block">
        {/* Sidebar. Collapsed = narrow rail with a » to expand. Expanded =
            full width with a « in the header to collapse. */}
        <div className={`bg-white border-r border-stone-200 flex flex-col transition-[width] duration-150 shrink-0 print:hidden ${
          sidebarCollapsed ? "w-9" : "w-56"
        }`}>
          <button onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center px-2 py-2 hover:bg-stone-100 border-b border-stone-200 shrink-0 w-full ${
              sidebarCollapsed ? "justify-center" : "justify-end"
            }`}>
            <span className="text-amber-600 font-black text-xl leading-none">
              {sidebarCollapsed ? "»" : "«"}
            </span>
          </button>

          {!sidebarCollapsed && (
            <>
              {/* Module title */}
              {currentModule && (
                <div className="px-4 pt-4 pb-3 text-sm font-black uppercase tracking-wider text-stone-800 border-b border-stone-100">
                  {currentModule.label}
                </div>
              )}
              <div className="flex-1 overflow-y-auto py-3">
                {currentModule?.sub?.map((s, i) => {
                  if (s.type === "header") {
                    return (
                      <div key={`h-${i}`}
                        className="px-4 mt-6 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 border-t border-stone-100">
                        {s.label}
                      </div>
                    );
                  }
                  return (
                    <SidebarItem key={s.id}
                      label={s.label}
                      indent={s.indent}
                      active={module === currentModule.id && effectiveSub === s.id}
                      onClick={() => goto(currentModule.id, s.id)} />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden print:overflow-visible">
          {module === "items" && effectiveSub === "active"          && <Items data={data} onEdit={handleEditItem} onAdd={handleAddItem} refreshTick={itemsRefresh} />}
          {module === "items" && effectiveSub === "archived"        && <Archive />}
          {module === "items" && effectiveSub === "quick-add"       && <QuickAdd />}
          {module === "items" && effectiveSub === "unprocessed"     && <UnprocessedItems />}
          {module === "items" && effectiveSub === "needs-locations" && <NeedsLocations data={data} />}
          {module === "items" && effectiveSub === "locations"       && <Locations />}

          {module === "receiving" && !selectedRecvDoc && (
            <ReceivingList onSelect={id => setSelectedRecvDoc(id)} onCreate={() => setSelectedRecvDoc("new")} />
          )}
          {module === "receiving" && selectedRecvDoc && (
            <ReceivingDoc docId={selectedRecvDoc} data={data}
              onBack={() => setSelectedRecvDoc(null)} onUpdate={() => setItemsRefresh(t => t + 1)} />
          )}

          {module === "store-lists" && (
            <StoreNeeds data={data} onSubmitOrder={() => { goto("pick-lists"); refreshOrders(); }} />
          )}

          {module === "pick-lists" && !selectedOrder && (
            <Orders orders={orders} loading={ordersLoading} onSelect={id => setSelectedOrder(id)} />
          )}
          {module === "pick-lists" && selectedOrder && (
            <PickList orderId={selectedOrder} data={data}
              onBack={() => { setSelectedOrder(null); refreshOrders(); }} onUpdate={refreshOrders} />
          )}

          {module === "wholesale" && (effectiveSub === "orders" || !effectiveSub) && <WholesaleOrders data={data} />}
          {module === "wholesale" && effectiveSub === "customers" && <Customers />}

          {module === "scans" && <ScanHub />}
        </div>
      </div>

      {showEditModal && (
        <ItemModal item={editItem} categories={data.categories} depts={data.depts} vendors={[]} units={data.units}
          onClose={() => { setShowEditModal(false); setEditItem(null); }} onSave={handleEditSave} />
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// ─── Sidebar row ──────────────────────────────────────────────────────

function SidebarItem({ label, active, indent, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left py-2 text-sm transition-colors truncate ${
        indent ? "pl-8 pr-4" : "px-4"
      } ${
        active
          ? "bg-amber-100 text-amber-800 font-bold border-r-2 border-amber-500"
          : "text-stone-600 hover:bg-stone-100"
      }`}>
      {label}
    </button>
  );
}
