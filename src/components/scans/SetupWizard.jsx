import { useState, useEffect } from "react";
import { scanAgent, isMockMode, setMockMode, getUserName, setUserName } from "../../lib/scanAgent";

/**
 * One-time per-PC setup. Picks a default scanner, source, dpi, color mode,
 * and an optional user name (stored in localStorage).
 *
 * Props:
 *   onComplete: () => void — called after successful save
 *   onCancel:   () => void — optional, used when re-entering settings
 *   initialConfig: existing config to pre-fill (when editing)
 */
export default function SetupWizard({ onComplete, onCancel, initialConfig }) {
  const [scanners, setScanners] = useState([]);
  const [scannerId, setScannerId] = useState(initialConfig?.defaultScanner?.id || "");
  const [source, setSource] = useState(initialConfig?.defaultSource || "Flatbed");
  const [dpi, setDpi] = useState(initialConfig?.defaultDpi || 300);
  const [colorMode, setColorMode] = useState(initialConfig?.defaultColorMode || "Color");
  const [userName, setUserNameLocal] = useState(getUserName() || "");
  const [mockEnabled, setMockEnabled] = useState(isMockMode());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [err, setErr] = useState(null);

  const loadScanners = async () => {
    setLoading(true);
    setErr(null);
    const ping = await scanAgent.ping();
    setAgentStatus(ping);
    if (!ping.ok) {
      setLoading(false);
      return;
    }
    const r = await scanAgent.listScanners();
    if (!r.ok) {
      setErr(r.error);
      setLoading(false);
      return;
    }
    setScanners(r.scanners);
    // Pre-select first scanner if none chosen
    if (!scannerId && r.scanners.length > 0) {
      setScannerId(r.scanners[0].id);
    }
    setLoading(false);
  };

  useEffect(() => { loadScanners(); }, [mockEnabled]);

  const selectedScanner = scanners.find(s => s.id === scannerId);

  const handleToggleMock = (on) => {
    setMockMode(on);
    setMockEnabled(on);
  };

  const handleSave = async () => {
    if (!scannerId) {
      setErr("Please choose a scanner");
      return;
    }
    setSaving(true);
    setErr(null);
    setUserName(userName);
    const r = await scanAgent.saveConfig({
      defaultScanner: {
        id: scannerId,
        displayName: selectedScanner?.displayName || "Scanner",
      },
      defaultSource: source,
      defaultDpi: dpi,
      defaultColorMode: colorMode,
    });
    setSaving(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onComplete();
  };

  const labelCls = "block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5";
  const fieldCls = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const segBtn = (active) =>
    `flex-1 px-4 py-2.5 text-sm font-semibold transition-colors ${
      active ? "bg-amber-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
    }`;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="bg-stone-800 text-white px-6 py-4">
          <h2 className="text-lg font-bold">{initialConfig?.configured ? "Scan Settings" : "Set Up Scanning"}</h2>
          <p className="text-xs text-stone-300 mt-0.5">
            {initialConfig?.configured
              ? "Update the default scanner and quality settings for this computer."
              : "First time on this computer? Pick a scanner and your defaults — you can change these later."}
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Agent status */}
          {!agentStatus?.ok && !loading && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="font-bold text-yellow-800 text-sm mb-1">Scan agent not detected</div>
              <div className="text-xs text-yellow-700 mb-3">
                The LDT Scan Agent doesn't appear to be running on this PC. Either start it, or use mock mode for testing.
              </div>
              <label className="flex items-center gap-2 text-xs text-yellow-800">
                <input
                  type="checkbox"
                  checked={mockEnabled}
                  onChange={e => handleToggleMock(e.target.checked)}
                  className="w-4 h-4 accent-amber-600"
                />
                Use mock mode (fake scanner for testing)
              </label>
            </div>
          )}

          {agentStatus?.ok && (
            <div className="text-xs text-stone-400">
              Agent: <span className="text-green-600 font-bold">connected</span> · {agentStatus.hostname}
              {mockEnabled && <span className="ml-2 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-bold">MOCK</span>}
            </div>
          )}

          {/* Scanner picker */}
          <div>
            <label className={labelCls}>Scanner</label>
            {loading ? (
              <div className="text-sm text-stone-400 py-2">Looking for scanners...</div>
            ) : scanners.length === 0 ? (
              <div className="text-sm text-stone-400 py-2 italic">No scanners found</div>
            ) : (
              <select value={scannerId} onChange={e => setScannerId(e.target.value)} className={fieldCls}>
                {scanners.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                    {s.manufacturer ? ` (${s.manufacturer})` : ""}
                    {s.hasFeeder ? " — ADF" : ""}
                    {s.hasFlatbed ? " + Flatbed" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Source toggle */}
          <div>
            <label className={labelCls}>Default source</label>
            <div className="flex border border-stone-300 rounded-lg overflow-hidden">
              <button onClick={() => setSource("Flatbed")} className={segBtn(source === "Flatbed")}>
                📄 Flatbed
              </button>
              <button
                onClick={() => setSource("ADF")}
                className={segBtn(source === "ADF")}
                disabled={selectedScanner && !selectedScanner.hasFeeder}
                title={selectedScanner && !selectedScanner.hasFeeder ? "This scanner has no document feeder" : ""}
              >
                📑 Document Feeder (ADF)
              </button>
            </div>
            {source === "ADF" && (
              <p className="text-xs text-stone-400 mt-1.5">All pages in the feeder will be scanned automatically.</p>
            )}
          </div>

          {/* DPI + Color side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Quality (DPI)</label>
              <select value={dpi} onChange={e => setDpi(Number(e.target.value))} className={fieldCls}>
                <option value={150}>150 — Draft</option>
                <option value={200}>200 — Standard</option>
                <option value={300}>300 — High</option>
                <option value={600}>600 — Archive</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Color mode</label>
              <select value={colorMode} onChange={e => setColorMode(e.target.value)} className={fieldCls}>
                <option value="Color">Color</option>
                <option value="Grayscale">Grayscale</option>
                <option value="BlackAndWhite">Black &amp; White</option>
              </select>
            </div>
          </div>

          {/* User name */}
          <div>
            <label className={labelCls}>Your name (optional)</label>
            <input
              type="text"
              value={userName}
              onChange={e => setUserNameLocal(e.target.value)}
              placeholder="e.g. Sharon"
              className={fieldCls}
            />
            <p className="text-xs text-stone-400 mt-1.5">
              Tags scans with your name so others know who scanned what. Stored on this PC only.
            </p>
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{err}</div>
          )}

          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-5 py-2.5 border border-stone-300 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !scannerId}
              className={`flex-1 px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                saving || !scannerId
                  ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                  : "bg-amber-600 text-white hover:bg-amber-700"
              }`}
            >
              {saving ? "Saving..." : initialConfig?.configured ? "Save Changes" : "Save & Start Scanning"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
