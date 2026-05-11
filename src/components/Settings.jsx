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
      </div>
    </div>
  );
}
