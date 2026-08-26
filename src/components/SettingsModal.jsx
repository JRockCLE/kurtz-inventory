import { useState } from "react";
// Kept for future — Sync to StoreLIVE is not currently in use.
// eslint-disable-next-line no-unused-vars
import SyncToStoreLive from "./SyncToStoreLive";
import InvoiceSettings from "./InvoiceSettings";

/**
 * App-level settings, opened from the sidebar. Small set of true configuration
 * (not day-to-day workflow) — everything else moved out to its own module.
 */
export default function SettingsModal({ onClose }) {
  const [tab, setTab] = useState("invoice");

  const tabs = [
    { id: "invoice", label: "Company Info" },
    // Sync to StoreLIVE hidden for now — client doesn't use it. Add back here
    // when needed: { id: "sync", label: "Sync to StoreLIVE" }
  ];

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">Settings</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-52 border-r border-stone-200 bg-stone-50 py-3">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  tab === t.id
                    ? "bg-amber-100 text-amber-800 font-bold border-r-2 border-amber-500"
                    : "text-stone-600 hover:bg-stone-100"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {tab === "invoice" && <InvoiceSettings />}
            {tab === "sync"    && <SyncToStoreLive />}
          </div>
        </div>
      </div>
    </div>
  );
}
