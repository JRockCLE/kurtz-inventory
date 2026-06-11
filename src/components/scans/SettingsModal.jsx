import { useEffect, useState } from "react";
import { SB_URL, SB_KEY } from "../../lib/supabase";
import { connectGoogleAccount, GOOGLE_CLIENT_ID } from "../../lib/email";

/**
 * Scan Hub settings modal.
 *
 * Section: Email Senders
 *   - List senders from the `email_senders` table
 *   - "Connect a Google Account" launches an OAuth popup (wires up to the
 *     Supabase Edge Function in Phase 2). For now it just walks the user
 *     through what to expect.
 *   - Each sender shows status, can be set as default, or removed
 *
 * Future sections (Print defaults, Storage limits, etc.) can hang off the
 * same tab structure.
 */
export default function SettingsModal({ onClose }) {
  const [section, setSection] = useState("email");

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">Scan Hub Settings</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

        {/* Body: side nav + content */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-44 border-r border-stone-200 bg-stone-50 p-3 space-y-1">
            {[
              { id: "email", label: "Email Senders" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setSection(t.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${section === t.id ? "bg-amber-100 text-amber-800 font-bold" : "text-stone-600 hover:bg-stone-100"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-6">
            {section === "email" && <EmailSendersSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Email Senders ──────────────────────────────────────────────────────

const restH = () => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
});

function EmailSendersSection() {
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/email_senders?select=id,email_address,display_name,is_default,status,last_used_at,created_at&order=created_at.asc`,
        { headers: restH() }
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      setSenders(await res.json());
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const startConnect = async () => {
    if (!GOOGLE_CLIENT_ID) {
      alert("Email setup incomplete: VITE_GOOGLE_CLIENT_ID is missing from .env.local.\n\n" +
            "Add it (your Google OAuth Client ID) and restart `npm run dev`.");
      return;
    }
    setConnecting(true);
    try {
      const result = await connectGoogleAccount();
      if (result.ok) {
        await load();  // refresh list to show the new sender
      } else {
        alert(`Connection failed: ${result.error || "unknown error"}`);
      }
    } catch (e) {
      alert(`Couldn't start Google sign-in: ${e.message}`);
    }
    setConnecting(false);
  };

  const setDefault = async (id) => {
    try {
      // Clear existing defaults, then set this one
      await fetch(`${SB_URL}/rest/v1/email_senders?is_default=eq.true`, {
        method: "PATCH",
        headers: restH(),
        body: JSON.stringify({ is_default: false }),
      });
      await fetch(`${SB_URL}/rest/v1/email_senders?id=eq.${id}`, {
        method: "PATCH",
        headers: restH(),
        body: JSON.stringify({ is_default: true }),
      });
      load();
    } catch (e) {
      alert(`Couldn't set default: ${e.message}`);
    }
  };

  const remove = async (sender) => {
    if (!confirm(`Disconnect ${sender.email_address}? You'll need to reconnect to send from this address.`)) return;
    try {
      await fetch(`${SB_URL}/rest/v1/email_senders?id=eq.${sender.id}`, {
        method: "DELETE",
        headers: restH(),
      });
      load();
    } catch (e) {
      alert(`Couldn't remove sender: ${e.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-stone-800 mb-1">Email Senders</h3>
        <p className="text-sm text-stone-500">
          Connect Google Workspace or Gmail accounts so the Scan Hub can email scans on your behalf.
          Sent messages appear in that account's Sent folder and thread normally with replies.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-stone-400 py-4">Loading…</div>
      ) : err ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          Couldn't load senders: {err}
          <div className="text-stone-500 mt-1 text-xs">
            (Run the email_senders migration first; see chat for the SQL.)
          </div>
        </div>
      ) : senders.length === 0 ? (
        <div className="text-sm text-stone-400 italic py-2">No senders connected yet.</div>
      ) : (
        <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
          {senders.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-800 truncate">{s.display_name || s.email_address}</span>
                  {s.is_default && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold uppercase">Default</span>
                  )}
                  {s.status !== "connected" && (
                    <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-[10px] font-bold uppercase">{s.status}</span>
                  )}
                </div>
                {s.display_name && <div className="text-xs text-stone-500 truncate">{s.email_address}</div>}
              </div>
              {!s.is_default && (
                <button
                  onClick={() => setDefault(s.id)}
                  className="px-2.5 py-1 text-xs border border-stone-300 text-stone-700 rounded hover:bg-stone-50 transition-colors"
                >
                  Make default
                </button>
              )}
              <button
                onClick={() => remove(s)}
                className="px-2.5 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={startConnect}
        disabled={connecting}
        className="px-4 py-2 bg-stone-800 text-white rounded-lg text-sm font-bold hover:bg-stone-900 disabled:opacity-50 transition-colors"
      >
        {connecting ? "Waiting for Google…" : "Connect a Google Account"}
      </button>
    </div>
  );
}
