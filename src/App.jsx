import { useState, useEffect } from "react";
import { useRefData, useOrders } from "./lib/hooks";
import Items from "./components/Items";
import ReceivingList from "./components/ReceivingList";
import ReceivingDoc from "./components/ReceivingDoc";
import StoreNeeds from "./components/StoreNeeds";
import Orders from "./components/Orders";
import PickList from "./components/PickList";
import ItemModal from "./components/ItemModal";
import Settings from "./components/Settings";
import ScanHub from "./components/scans/ScanHub";

export default function App() {
  // Initial tab honors a hash like #scans for PWA install entry
  const initialTab = () => {
    if (typeof window === "undefined") return "receiving";
    const h = window.location.hash.replace("#", "");
    const valid = ["receiving", "items", "needs", "orders", "scans", "settings"];
    return valid.includes(h) ? h : "receiving";
  };

  const [tab, setTab] = useState(initialTab);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedRecvDoc, setSelectedRecvDoc] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [itemsRefresh, setItemsRefresh] = useState(0);
  const data = useRefData();
  const { orders, loading: ordersLoading, refresh: refreshOrders } = useOrders();

  // Keep the URL hash in sync with current tab so refresh / share preserves it
  useEffect(() => {
    if (typeof window === "undefined") return;
    const newHash = `#${tab}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", newHash);
    }
  }, [tab]);

  const pendingCount = orders.filter(o => o.status === "submitted" || o.status === "picking").length;

  const tabs = [
    { id: "receiving", label: "Receiving", emoji: "📦" },
    { id: "items", label: "Items", emoji: "🏷️" },
    { id: "needs", label: "Store Lists", emoji: "📋" },
    { id: "orders", label: "Pick Lists", emoji: "🚛", badge: pendingCount },
    // { id: "scans", label: "Scans", emoji: "📁" }, // hidden until Scans is production-ready
  ];

  const handleEditItem = (item) => { setEditItem(item); setShowEditModal(true); };
  const handleEditSave = () => { setShowEditModal(false); setEditItem(null); setItemsRefresh(t => t + 1); data.refresh(); };

  const switchTab = (newTab) => {
    setTab(newTab);
    setSelectedOrder(null);
    setSelectedRecvDoc(null);
  };

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
      <div className="bg-stone-800 text-white flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-lg">🏪</span>
          <span className="font-bold text-sm tracking-wide">KURTZ DISCOUNT GROCERIES</span>
        </div>
        <div className="flex">
          {tabs.map(t => (
            <button key={t.id}
              onClick={() => switchTab(t.id)}
              className={`px-5 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === t.id ? "border-amber-500 text-white bg-stone-700" : "border-transparent text-stone-400 hover:text-white hover:bg-stone-700/50"
              }`}>
              <span>{t.emoji}</span><span>{t.label}</span>
              {t.badge > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">{t.badge}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => switchTab("settings")}
          className={`px-4 py-2.5 text-sm transition-colors ${tab === "settings" ? "text-white" : "text-stone-400 hover:text-white"}`}
          title="Settings">
          Settings
        </button>
      </div>

      <div className="flex-1 overflow-hidden print:overflow-visible">
        {tab === "receiving" && !selectedRecvDoc && (
          <ReceivingList onSelect={id => setSelectedRecvDoc(id)} onCreate={() => setSelectedRecvDoc("new")} />
        )}
        {tab === "receiving" && selectedRecvDoc && (
          <ReceivingDoc docId={selectedRecvDoc} data={data}
            onBack={() => setSelectedRecvDoc(null)} onUpdate={() => setItemsRefresh(t => t + 1)} />
        )}
        {tab === "items" && <Items data={data} onEdit={handleEditItem} refreshTick={itemsRefresh} />}
        {tab === "needs" && <StoreNeeds data={data} onSubmitOrder={() => { switchTab("orders"); refreshOrders(); }} />}
        {tab === "orders" && !selectedOrder && <Orders orders={orders} loading={ordersLoading} onSelect={id => setSelectedOrder(id)} />}
        {tab === "orders" && selectedOrder && <PickList orderId={selectedOrder} data={data} onBack={() => { setSelectedOrder(null); refreshOrders(); }} onUpdate={refreshOrders} />}
        {tab === "scans" && <ScanHub />}
        {tab === "settings" && <Settings />}
      </div>

      {showEditModal && editItem && (
        <ItemModal item={editItem} categories={data.categories} depts={data.depts} vendors={[]} units={data.units}
          onClose={() => { setShowEditModal(false); setEditItem(null); }} onSave={handleEditSave} />
      )}
    </div>
  );
}
