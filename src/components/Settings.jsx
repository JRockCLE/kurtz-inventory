import { useState } from "react";
import QuickAdd from "./QuickAdd";
import NeedsLocations from "./NeedsLocations";
import Locations from "./Locations";
import UnprocessedItems from "./UnprocessedItems";
import SyncToStoreLive from "./SyncToStoreLive";

export default function Settings({ data }) {
  const [subtab, setSubtab] = useState("quickadd");

  const tabs = [
    { id: "quickadd", label: "Quick Add" },
    { id: "needs-locations", label: "Needs Locations" },
    { id: "unprocessed", label: "Unprocessed Items" },
    { id: "sync", label: "Sync to StoreLIVE" },
    { id: "locations", label: "Locations" },
    { id: "scan-hub", label: "Scan Hub" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 flex items-center gap-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              subtab === t.id ? "border-amber-500 text-amber-700" : "border-transparent text-stone-400 hover:text-stone-600"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {subtab === "quickadd" && <QuickAdd />}
        {subtab === "needs-locations" && <NeedsLocations data={data} />}
        {subtab === "unprocessed" && <UnprocessedItems />}
        {subtab === "sync" && <SyncToStoreLive />}
        {subtab === "locations" && <Locations />}
        {subtab === "scan-hub" && <ScanHubLauncher />}
      </div>
    </div>
  );
}

function ScanHubLauncher() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="text-5xl">📁</div>
        <h3 className="text-xl font-bold text-stone-800">Kurtz Scans</h3>
        <p className="text-sm text-stone-500">
          Document scanning lives in its own installable app. Open it in a new tab — your browser will offer to install it to your desktop / taskbar so you can launch it like a native app.
        </p>
        <div className="flex justify-center gap-2">
          <a href="/scans" target="_blank" rel="noopener"
            className="px-5 py-2.5 bg-stone-800 text-white rounded-lg text-sm font-bold hover:bg-stone-900 transition-colors">
            Open Scan Hub →
          </a>
        </div>
        <p className="text-[11px] text-stone-400">
          In Chrome / Edge, look for the install icon in the address bar after the page loads.
        </p>
      </div>
    </div>
  );
}
