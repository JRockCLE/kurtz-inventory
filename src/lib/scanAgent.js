// ═══════════════════════════════════════════════════════════════════
//  Scan Agent Client
//
//  Wraps the local LDT Scan Agent (http://localhost:7878).
//  Falls back to MOCK mode if the agent isn't reachable, so we can
//  build/test UI without a real scanner connected.
//
//  All endpoints return well-shaped objects — never throw raw fetch errors.
// ═══════════════════════════════════════════════════════════════════

const AGENT_BASE = "http://localhost:7878";
const TIMEOUT_MS = 10_000;          // most calls
const ENUM_TIMEOUT_MS = 30_000;     // WIA enumeration can be slow, esp. with network-discovered scanners
const SCAN_TIMEOUT_MS = 120_000;    // a real ADF run can take a while

const MOCK_KEY = "ldt_scan_use_mock";

// Module-level in-flight dedup. Coalesces concurrent listScanners callers
// (React StrictMode double-mount in dev, multiple tabs, etc.) into one
// request to the agent so we don't trip its scanner_busy gate against ourselves.
let _scannersInflight = null;

export const isMockMode = () => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MOCK_KEY) === "true";
};

export const setMockMode = (on) => {
  if (on) localStorage.setItem(MOCK_KEY, "true");
  else localStorage.removeItem(MOCK_KEY);
};

// ─── Internal fetch wrapper ─────────────────────────────────────────

async function call(path, { method = "GET", body, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${AGENT_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.error || json?.title || text || "Agent error", data: json };
    }
    return { ok: true, status: res.status, data: json };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, status: 0, error: "timeout" };
    return { ok: false, status: 0, error: "agent_unreachable", message: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export const scanAgent = {
  /** Quick check: is the agent running? */
  async ping() {
    if (isMockMode()) {
      return { ok: true, version: "mock", hostname: "MOCK-PC" };
    }
    const r = await call("/version");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, version: r.data?.version, hostname: r.data?.hostname };
  },

  /**
   * List scanners attached to this PC.
   *
   * Two robustness layers added to handle real-world races:
   *
   *   1. Concurrent-call dedup. React 18+ in dev StrictMode double-mounts and
   *      double-invokes effects, so a single navigation to the setup screen
   *      fires `listScanners` twice in quick succession. The agent's WIA
   *      semaphore can only serve one of them — the loser gets `scanner_busy`.
   *      We coalesce concurrent calls into one in-flight promise.
   *
   *   2. Auto-retry on `scanner_busy`. If a real other caller is mid-enumeration
   *      (another tab, the agent's own background warmup, etc.), wait a moment
   *      and try again before bubbling the error to the UI.
   */
  async listScanners() {
    if (isMockMode()) {
      return {
        ok: true,
        scanners: [
          {
            id: "MOCK\\Scanner-1",
            displayName: "Mock Scanner (Brother MFC)",
            manufacturer: "Mock Inc.",
            hasFlatbed: true,
            hasFeeder: true,
            hasDuplex: false,
          },
        ],
      };
    }
    if (_scannersInflight) return _scannersInflight;
    _scannersInflight = (async () => {
      let r = await call("/scanners", { timeout: ENUM_TIMEOUT_MS });
      if (!r.ok && r.error === "scanner_busy") {
        await new Promise(res => setTimeout(res, 1200));
        r = await call("/scanners", { timeout: ENUM_TIMEOUT_MS });
      }
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, scanners: r.data?.scanners ?? [] };
    })().finally(() => { _scannersInflight = null; });
    return _scannersInflight;
  },

  /** Get current agent config (default scanner, source, dpi, etc.) */
  async getConfig() {
    if (isMockMode()) {
      const saved = localStorage.getItem("ldt_scan_mock_config");
      if (saved) return { ok: true, config: JSON.parse(saved) };
      return { ok: true, config: { configured: false } };
    }
    const r = await call("/config");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, config: r.data ?? { configured: false } };
  },

  /** Save agent config */
  async saveConfig(config) {
    if (isMockMode()) {
      const toSave = { ...config, configured: true, configuredAt: new Date().toISOString() };
      localStorage.setItem("ldt_scan_mock_config", JSON.stringify(toSave));
      return { ok: true, config: toSave };
    }
    const r = await call("/config", { method: "POST", body: config });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, config: r.data };
  },

  /** Trigger a scan. Pass overrides or {} to use saved defaults. */
  async scan(overrides = {}) {
    if (isMockMode()) {
      // Simulate ADF returning 3 pages, flatbed returning 1
      const cfg = JSON.parse(localStorage.getItem("ldt_scan_mock_config") || "{}");
      const source = overrides.source || cfg.defaultSource || "Flatbed";
      const pageCount = source === "ADF" ? 3 : 1;
      await new Promise(r => setTimeout(r, 1500));  // pretend it takes time
      return {
        ok: true,
        result: {
          scanId: crypto.randomUUID(),
          scannedAt: new Date().toISOString(),
          hostname: "MOCK-PC",
          scannerName: cfg.defaultScanner?.displayName || "Mock Scanner",
          source,
          dpi: overrides.dpi || cfg.defaultDpi || 300,
          colorMode: overrides.colorMode || cfg.defaultColorMode || "Color",
          pages: Array.from({ length: pageCount }, (_, i) => makeMockPage(i + 1)),
        },
      };
    }
    const r = await call("/scan", { method: "POST", body: overrides, timeout: SCAN_TIMEOUT_MS });
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        savedScanner: r.data?.savedScanner,
        message: r.data?.message,
      };
    }
    return { ok: true, result: r.data };
  },
};

// ─── Mock helpers ───────────────────────────────────────────────────

function makeMockPage(n) {
  // 1×1 pixel grey JPEG, base64 — tiny so it's free
  const greyJpegBase64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQBAQAAAAAAAAAAAAAAAAAAAAr/2gAMAwEAAhADEAAAAU//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPwf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
  return {
    pageNumber: n,
    imageBase64: greyJpegBase64,
    format: "jpeg",
    widthPx: 1,
    heightPx: 1,
    sizeBytes: 631,
  };
}

// ─── User identity helpers (for created_by-ish field) ───────────────

const USER_KEY = "ldt_scan_user_name";

export const getUserName = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(USER_KEY) || null;
};

export const setUserName = (name) => {
  if (name?.trim()) localStorage.setItem(USER_KEY, name.trim());
  else localStorage.removeItem(USER_KEY);
};
