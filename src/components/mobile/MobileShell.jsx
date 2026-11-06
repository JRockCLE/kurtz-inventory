import { useState, useEffect } from "react";

// ─── Mobile shell ─────────────────────────────────────────────────────
// Dashboard-first mobile UI. Lives at `#m` / `#m/<screen>` and
// short-circuits the desktop top-nav + sidebar layout entirely.
//
// Each tile launches its own task flow. Flows are stubbed for now —
// swap the <Placeholder> renders for real components as they're built.

const TILES = [
  { id: "receive",     label: "Receive Items",     emoji: "📥", desc: "Scan & assign locations" },
  { id: "locations",   label: "Assign Locations",  emoji: "📍", desc: "Items needing a spot" },
  { id: "unprocessed", label: "Unprocessed Queue", emoji: "📸", desc: "Review scanned unknowns" },
  { id: "count",       label: "Inventory Count",   emoji: "🔢", desc: "Cycle count / recount" },
  { id: "lookup",      label: "Lookup Item",       emoji: "🔍", desc: "Scan to view details" },
];

function parseMobileHash() {
  if (typeof window === "undefined") return { screen: null };
  const raw = window.location.hash.replace("#", "");           // "m" or "m/receive"
  const [, screen] = raw.split("/");
  return { screen: screen || null };
}

export default function MobileShell() {
  const [{ screen }, setNav] = useState(parseMobileHash);

  // Keep local state in sync with hash (back button, deep link).
  useEffect(() => {
    const onHash = () => setNav(parseMobileHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goto = (s) => {
    const target = s ? `#m/${s}` : "#m";
    if (window.location.hash !== target) window.location.hash = target;
    setNav({ screen: s });
  };

  return (
    <div className="h-screen flex flex-col bg-stone-100">
      {screen === null && <Dashboard onPick={goto} />}
      {screen && <TaskScreen screen={screen} onBack={() => goto(null)} />}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────

function Dashboard({ onPick }) {
  return (
    <>
      <div className="bg-stone-800 text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <div className="text-xs uppercase tracking-widest text-stone-400">Kurtz</div>
          <div className="text-lg font-black">Warehouse</div>
        </div>
        <a href="#items"
          className="text-xs text-stone-300 hover:text-white underline underline-offset-2">
          Desktop view
        </a>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-3">
          {TILES.map(t => (
            <button key={t.id} onClick={() => onPick(t.id)}
              className="bg-white border border-stone-200 rounded-2xl px-4 py-5 text-left shadow-sm hover:bg-amber-50 hover:border-amber-300 active:scale-[0.99] transition-all flex items-center gap-4">
              <div className="text-4xl shrink-0">{t.emoji}</div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-stone-800">{t.label}</div>
                <div className="text-xs text-stone-500">{t.desc}</div>
              </div>
              <div className="text-stone-300 text-2xl shrink-0">›</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Task screen shell ────────────────────────────────────────────────
// Thin wrapper every task flow sits inside: sticky header with back
// button + title, scrollable body. Swap <Placeholder> for the real
// mobile component as each flow is built out.

function TaskScreen({ screen, onBack }) {
  const tile = TILES.find(t => t.id === screen);
  const title = tile?.label || "Unknown";
  return (
    <>
      <div className="bg-stone-800 text-white px-2 py-2 flex items-center gap-2 shrink-0">
        <button onClick={onBack}
          className="px-3 py-2 text-base font-semibold text-stone-100 hover:bg-stone-700 rounded-lg active:scale-95 transition-all">
          ‹ Back
        </button>
        <div className="font-bold text-base">{title}</div>
      </div>

      <div className="flex-1 overflow-auto">
        <Placeholder screen={screen} />
      </div>
    </>
  );
}

function Placeholder({ screen }) {
  return (
    <div className="p-6 text-center text-stone-400">
      <div className="text-5xl mb-3">🚧</div>
      <p className="text-sm">Mobile <span className="font-mono">{screen}</span> flow — coming next.</p>
    </div>
  );
}
