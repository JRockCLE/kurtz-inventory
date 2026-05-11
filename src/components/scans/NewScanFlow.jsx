import { useState, useEffect } from "react";
import { scanAgent, getUserName, isMockMode } from "../../lib/scanAgent";
import { scansApi } from "../../lib/scansApi";
import SetupWizard from "./SetupWizard";

/**
 * The "I want to scan something" page.
 *
 * Lifecycle:
 *   1. Check agent.getConfig()
 *      - if not configured → render <SetupWizard />
 *      - if configured     → render scan UI (big button)
 *   2. SCAN button → call agent.scan() → on success, upload via scansApi
 *   3. On upload success → onComplete(scanId) so parent can navigate to detail
 *
 * Props:
 *   onComplete: (scanId) => void
 *   onCancel:   () => void
 */
export default function NewScanFlow({ onComplete, onCancel }) {
  const [config, setConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [phase, setPhase] = useState("idle");  // idle | scanning | uploading | done | error
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);

  const loadConfig = async () => {
    setLoadingConfig(true);
    const r = await scanAgent.getConfig();
    setConfig(r.ok ? r.config : { configured: false });
    setLoadingConfig(false);
  };

  useEffect(() => { loadConfig(); }, []);

  const handleScan = async (overrideSource) => {
    setPhase("scanning");
    setError(null);

    const overrides = overrideSource ? { source: overrideSource } : {};
    const r = await scanAgent.scan(overrides);

    if (!r.ok) {
      setError(r.message || r.error || "Scan failed");
      setPhase("error");
      return;
    }

    if (!r.result.pages || r.result.pages.length === 0) {
      setError("No pages were scanned. Check that paper is in the feeder or on the flatbed.");
      setPhase("error");
      return;
    }

    setScanResult(r.result);
    setPhase("uploading");

    try {
      const scanId = await scansApi.createFromAgentResult(r.result, { userName: getUserName() });
      setPhase("done");
      // Brief moment to show success, then go to detail page
      setTimeout(() => onComplete(scanId), 600);
    } catch (e) {
      setError(`Upload failed: ${e.message}`);
      setPhase("error");
    }
  };

  // ─── Loading ──────────────────────────────────────────────────────
  if (loadingConfig) {
    return (
      <div className="h-full flex items-center justify-center bg-stone-50">
        <div className="text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  // ─── First-run setup or settings ──────────────────────────────────
  if (!config?.configured || showSettings) {
    return (
      <div className="h-full overflow-auto bg-stone-50">
        <SetupWizard
          initialConfig={config}
          onComplete={() => { setShowSettings(false); loadConfig(); }}
          onCancel={config?.configured ? () => setShowSettings(false) : onCancel}
        />
      </div>
    );
  }

  // ─── Main scan screen ─────────────────────────────────────────────
  const scanner = config.defaultScanner;
  const sourceLabel = config.defaultSource === "ADF" ? "Document Feeder" : "Flatbed";
  const altSource = config.defaultSource === "ADF" ? "Flatbed" : "ADF";
  const altSourceLabel = altSource === "ADF" ? "Document Feeder" : "Flatbed";

  const isBusy = phase === "scanning" || phase === "uploading";

  return (
    <div className="h-full flex flex-col bg-stone-50">
      {/* Top bar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors flex items-center gap-1"
          title="Scan settings"
        >
          ⚙ Settings
        </button>
      </div>

      {/* Main scan area */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md w-full">
          {phase === "idle" && (
            <>
              <button
                onClick={() => handleScan()}
                className="group w-64 h-64 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-white shadow-2xl hover:shadow-amber-300/50 transition-all transform hover:scale-105 active:scale-95"
              >
                <div className="text-7xl mb-2 group-hover:scale-110 transition-transform">📄</div>
                <div className="text-3xl font-black tracking-wide">SCAN</div>
              </button>

              <div className="mt-8 text-sm text-stone-500">
                <div className="font-semibold text-stone-700">{scanner?.displayName}</div>
                <div className="mt-1">
                  {sourceLabel} · {config.defaultDpi} DPI · {config.defaultColorMode}
                  {isMockMode() && <span className="ml-2 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">MOCK</span>}
                </div>
              </div>

              <button
                onClick={() => handleScan(altSource)}
                className="mt-6 text-sm text-amber-700 hover:text-amber-900 underline transition-colors"
              >
                Scan from {altSourceLabel} instead (one time)
              </button>
            </>
          )}

          {phase === "scanning" && (
            <div className="py-12">
              <div className="text-7xl mb-4 animate-pulse">📄</div>
              <div className="text-2xl font-bold text-stone-700">Scanning...</div>
              <div className="text-sm text-stone-400 mt-2">
                {config.defaultSource === "ADF" ? "Feeding pages through the document feeder" : "Reading from the flatbed"}
              </div>
            </div>
          )}

          {phase === "uploading" && (
            <div className="py-12">
              <div className="text-7xl mb-4 animate-bounce">📤</div>
              <div className="text-2xl font-bold text-stone-700">Uploading...</div>
              <div className="text-sm text-stone-400 mt-2">
                Saving {scanResult?.pages?.length || 0} page{scanResult?.pages?.length === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="py-12">
              <div className="text-7xl mb-4">✅</div>
              <div className="text-2xl font-bold text-green-700">Done!</div>
              <div className="text-sm text-stone-400 mt-2">Opening scan...</div>
            </div>
          )}

          {phase === "error" && (
            <div className="py-12">
              <div className="text-7xl mb-4">⚠️</div>
              <div className="text-xl font-bold text-red-700 mb-2">Scan failed</div>
              <div className="text-sm text-stone-600 bg-red-50 border border-red-200 rounded-lg p-4 text-left">
                {error}
              </div>
              <button
                onClick={() => { setPhase("idle"); setError(null); }}
                className="mt-6 px-6 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
