import { useState, useEffect } from "react";
import { scanAgent, getUserName } from "../../lib/scanAgent";
import { scansApi } from "../../lib/scansApi";
import SetupWizard from "./SetupWizard";

/**
 * "New Scan" entry point.
 *
 * Workflow (per user spec):
 *   1. Always show the scan settings form, pre-filled with saved defaults.
 *   2. User reviews/changes anything (scanner, source, DPI, color, name).
 *   3. Clicking "Save & Start Scanning" persists the new defaults and
 *      immediately triggers the scan.
 *   4. Pages stream in → upload → onComplete(scanId) routes to ScanDetail.
 *
 * Props:
 *   onComplete: (scanId) => void
 *   onCancel:   () => void
 */
export default function NewScanFlow({ onComplete, onCancel }) {
  const [config, setConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [phase, setPhase] = useState("setup");      // setup | scanning | uploading | done | error
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    (async () => {
      const r = await scanAgent.getConfig();
      setConfig(r.ok ? r.config : { configured: false });
      setLoadingConfig(false);
    })();
  }, []);

  const startScan = async () => {
    setPhase("scanning");
    setError(null);

    // Empty body uses whatever was just saved as defaults
    const r = await scanAgent.scan({});

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
      setTimeout(() => onComplete(scanId), 400);
    } catch (e) {
      setError(`Upload failed: ${e.message}`);
      setPhase("error");
    }
  };

  if (loadingConfig) {
    return (
      <div className="h-full flex items-center justify-center bg-stone-50">
        <div className="text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  // Setup form — shown every time, pre-filled with saved defaults.
  if (phase === "setup") {
    return (
      <div className="h-full overflow-auto bg-stone-50">
        <SetupWizard
          initialConfig={config}
          mode="scan"
          onComplete={() => startScan()}
          onCancel={onCancel}
        />
      </div>
    );
  }

  // Scanning / uploading / done / error all share a centered card.
  return (
    <div className="h-full flex flex-col bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <button
          onClick={onCancel}
          disabled={phase === "scanning" || phase === "uploading"}
          className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
        >
          ← Back
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md w-full">
          {phase === "scanning" && (
            <>
              <div className="text-7xl mb-4 animate-pulse">📄</div>
              <div className="text-2xl font-bold text-stone-700">Scanning...</div>
              <div className="text-sm text-stone-400 mt-2">This can take a minute for multi-page feeds.</div>
            </>
          )}
          {phase === "uploading" && (
            <>
              <div className="text-7xl mb-4 animate-bounce">📤</div>
              <div className="text-2xl font-bold text-stone-700">Uploading...</div>
              <div className="text-sm text-stone-400 mt-2">
                Saving {scanResult?.pages?.length || 0} page{scanResult?.pages?.length === 1 ? "" : "s"}
              </div>
            </>
          )}
          {phase === "done" && (
            <>
              <div className="text-7xl mb-4">✅</div>
              <div className="text-2xl font-bold text-green-700">Done!</div>
              <div className="text-sm text-stone-400 mt-2">Opening scan...</div>
            </>
          )}
          {phase === "error" && (
            <>
              <div className="text-7xl mb-4">⚠️</div>
              <div className="text-xl font-bold text-red-700 mb-2">Scan failed</div>
              <div className="text-sm text-stone-600 bg-red-50 border border-red-200 rounded-lg p-4 text-left">
                {error}
              </div>
              <button
                onClick={() => { setPhase("setup"); setError(null); }}
                className="mt-6 px-6 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 transition-colors"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
