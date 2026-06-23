import { useEffect, useState } from "react";
import { SB_URL, SB_KEY } from "../../lib/supabase";
import { sendEmail, blobToBase64 } from "../../lib/email";
import { scanPdfBlob, scanPdfFilename } from "../../lib/scanPdf";

/**
 * Compose & send an email with the current scan attached as a PDF.
 *
 * Props:
 *   scan:    the loaded scan (with .pages)
 *   onClose: () => void  — invoked on Cancel or after a successful send
 *
 * Loads connected senders on mount. If there are none, points the user at
 * Settings → Email Senders.
 */
export default function ComposeEmailModal({ scan, onClose }) {
  const [senders, setSenders]   = useState([]);
  const [loading, setLoading]   = useState(true);

  const [senderId, setSenderId] = useState("");
  const [to, setTo]             = useState("");
  const [cc, setCc]             = useState("");
  const [subject, setSubject]   = useState(scan?.title || "Scan");
  const [body, setBody]         = useState("");

  const [includeAttachment, setIncludeAttachment] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${SB_URL}/rest/v1/email_senders?select=id,email_address,display_name,is_default,status&status=eq.connected&order=is_default.desc,email_address.asc`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const list = await res.json();
        setSenders(list);
        if (list.length > 0) setSenderId((list.find(s => s.is_default) || list[0]).id);
      } catch (e) {
        setErr(`Couldn't load senders: ${e.message}`);
      }
      setLoading(false);
    })();
  }, []);

  const handleSend = async () => {
    setErr(null);
    if (!senderId)       { setErr("Pick a sender."); return; }
    if (!to.trim())      { setErr("Add at least one recipient."); return; }
    if (!subject.trim()) { setErr("Add a subject."); return; }

    setSending(true);
    try {
      const attachments = [];
      if (includeAttachment && scan?.pages?.length > 0) {
        const blob = await scanPdfBlob(scan);
        const base64 = await blobToBase64(blob);
        attachments.push({
          filename: scanPdfFilename(scan),
          contentType: "application/pdf",
          base64,
        });
      }

      await sendEmail({
        senderId,
        to: to.split(/[;,]+/).map(s => s.trim()).filter(Boolean),
        cc: cc.split(/[;,]+/).map(s => s.trim()).filter(Boolean),
        subject: subject.trim(),
        body: body || "",
        attachments,
      });

      onClose();
    } catch (e) {
      setErr(e.message);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">Email Scan</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3 max-h-[80vh] overflow-auto">
          {loading ? (
            <div className="text-sm text-stone-400 py-4">Loading…</div>
          ) : senders.length === 0 ? (
            <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="font-bold text-amber-800 mb-1">No connected senders</div>
              <div>Open Settings → Email Senders and click "Connect a Google Account" to authorize sending.</div>
            </div>
          ) : (
            <>
              <Field label="From">
                <select
                  value={senderId}
                  onChange={e => setSenderId(e.target.value)}
                  className={input}
                >
                  {senders.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.display_name ? `${s.display_name} <${s.email_address}>` : s.email_address}
                      {s.is_default ? "  (default)" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="To" hint="Comma-separate multiple addresses">
                <input
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className={input}
                  placeholder="someone@example.com"
                />
              </Field>

              <Field label="Cc">
                <input
                  value={cc}
                  onChange={e => setCc(e.target.value)}
                  className={input}
                />
              </Field>

              <Field label="Subject">
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className={input}
                />
              </Field>

              <Field label="Message">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  className={`${input} resize-y`}
                  placeholder="Optional message body…"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={includeAttachment}
                  onChange={e => setIncludeAttachment(e.target.checked)}
                  className="w-4 h-4 accent-amber-600"
                />
                Attach scan as PDF ({scan?.page_count || 0} page{scan?.page_count === 1 ? "" : "s"})
              </label>

              {err && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap">
                  {err}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-200 bg-stone-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || senders.length === 0 || loading}
            className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const input = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-stone-400 mt-0.5">{hint}</div>}
    </label>
  );
}

