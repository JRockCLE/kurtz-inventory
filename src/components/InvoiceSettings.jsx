import { useEffect, useState, useRef } from "react";
import { qry, uploadPhoto } from "../lib/hooks";

/**
 * Editor for the singleton invoice_settings row. Values here populate the
 * header of every generated wholesale invoice PDF.
 */
export default function InvoiceSettings() {
  const [f, setF] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await qry("invoice_settings", { filters: "id=eq.1", limit: 1 });
        setF(rows[0] || { id: 1 });
      } catch (e) {
        setErr(e.message);
      }
      setLoading(false);
    })();
  }, []);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        business_name: f.business_name?.trim() || null,
        address_line1: f.address_line1?.trim() || null,
        address_line2: f.address_line2?.trim() || null,
        city:          f.city?.trim()          || null,
        state:         f.state?.trim()         || null,
        postal_code:   f.postal_code?.trim()   || null,
        phone:         f.phone?.trim()         || null,
        email:         f.email?.trim()         || null,
        website:       f.website?.trim()       || null,
        logo_url:      f.logo_url?.trim()      || null,
        show_logo_on_invoice: !!f.show_logo_on_invoice,
        footer_note:   f.footer_note?.trim()   || null,
        updated_at:    new Date().toISOString(),
      };
      await qry("invoice_settings", { update: payload, match: { id: 1 } });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-stone-400 text-sm">Loading...</div>;
  }
  if (!f) {
    return (
      <div className="p-8 text-center text-red-600 text-sm">
        Couldn't load settings: {err || "unknown error"}
        <div className="text-xs text-stone-500 mt-1">Run the wholesale.sql migration in Supabase first.</div>
      </div>
    );
  }

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-bold text-stone-500 uppercase tracking-wide mb-1";

  return (
    <div className="h-full overflow-auto p-6">
      {savedToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold">
          ✓ Saved
        </div>
      )}
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h2 className="text-lg font-bold text-stone-800">Company Info</h2>
          <p className="text-sm text-stone-500 mt-1">
            Your business details. These appear at the top of every wholesale invoice PDF.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
          <div>
            <label className={lc}>Business name</label>
            <input className={ic} value={f.business_name || ""} onChange={e => set("business_name", e.target.value)} placeholder="Kurtz Discount Groceries" />
          </div>

          <div>
            <label className={lc}>Address line 1</label>
            <input className={ic} value={f.address_line1 || ""} onChange={e => set("address_line1", e.target.value)} placeholder="123 Main St" />
          </div>
          <div>
            <label className={lc}>Address line 2</label>
            <input className={ic} value={f.address_line2 || ""} onChange={e => set("address_line2", e.target.value)} placeholder="Suite / floor (optional)" />
          </div>

          <div className="grid grid-cols-[1fr_100px_130px] gap-3">
            <div>
              <label className={lc}>City</label>
              <input className={ic} value={f.city || ""} onChange={e => set("city", e.target.value)} />
            </div>
            <div>
              <label className={lc}>State</label>
              <input className={ic} value={f.state || ""} onChange={e => set("state", e.target.value)} maxLength={2} placeholder="OH" />
            </div>
            <div>
              <label className={lc}>ZIP</label>
              <input className={ic} value={f.postal_code || ""} onChange={e => set("postal_code", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Phone</label>
              <input className={ic} value={f.phone || ""} onChange={e => set("phone", e.target.value)} placeholder="555-555-5555" />
            </div>
            <div>
              <label className={lc}>Email</label>
              <input className={ic} value={f.email || ""} onChange={e => set("email", e.target.value)} placeholder="orders@example.com" />
            </div>
          </div>

          <div>
            <label className={lc}>Website</label>
            <input className={ic} value={f.website || ""} onChange={e => set("website", e.target.value)} placeholder="kurtzdiscountgroceries.com" />
          </div>

          <div>
            <label className={lc}>Logo</label>
            <LogoUploader value={f.logo_url} onChange={(url) => set("logo_url", url)} />
            <p className="text-[11px] text-stone-400 mt-1">PNG or JPG. Drop a file below or click to browse. Shows in the top-left of the app.</p>
            <label className="flex items-center gap-2 mt-2 text-sm text-stone-700 cursor-pointer select-none">
              <input type="checkbox"
                checked={!!f.show_logo_on_invoice}
                onChange={e => set("show_logo_on_invoice", e.target.checked)}
                className="w-4 h-4 accent-amber-600" />
              Show on invoices
            </label>
          </div>

          <div>
            <label className={lc}>Footer note</label>
            <textarea className={`${ic} resize-y`} rows={2} value={f.footer_note || ""} onChange={e => set("footer_note", e.target.value)} placeholder="Thank you for your business. Payment due within 30 days." />
          </div>

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Logo upload / drop widget ────────────────────────────────────────

function LogoUploader({ value, onChange }) {
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) { setErr("File must be an image (PNG or JPG)."); return; }
    setErr(null);
    setUploading(true);
    try {
      // Reuse the product-photos bucket with a `logos/` prefix — no separate
      // bucket needed. Timestamp on the filename means we don't clobber the
      // previous logo (browsers may still cache the URL otherwise).
      const url = await uploadPhoto(file, "logos");
      onChange(url);
    } catch (e) {
      setErr(`Upload failed: ${e.message || e}`);
    }
    setUploading(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  return (
    <div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`cursor-pointer border-2 border-dashed rounded-lg transition-colors flex items-center gap-4 p-4 ${
          dragging ? "border-amber-400 bg-amber-50" : "border-stone-300 hover:border-stone-400 bg-white"
        }`}>
        {value ? (
          <img src={value} alt="Logo" className="h-16 w-16 object-contain rounded border border-stone-200 bg-white shrink-0" />
        ) : (
          <div className="h-16 w-16 rounded border border-stone-200 bg-stone-50 flex items-center justify-center text-stone-300 text-2xl shrink-0">
            +
          </div>
        )}
        <div className="flex-1 min-w-0 text-sm">
          {uploading ? (
            <div className="text-stone-500">Uploading…</div>
          ) : value ? (
            <>
              <div className="text-stone-700 font-medium">Click or drop to replace</div>
              <div className="text-xs text-stone-400 truncate">{value}</div>
            </>
          ) : (
            <div className="text-stone-500">Click to browse, or drop an image file here</div>
          )}
        </div>
        {value && !uploading && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            className="text-xs text-stone-400 hover:text-red-500 px-2 py-1">
            Remove
          </button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleFile(f); }} />
      {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
    </div>
  );
}
