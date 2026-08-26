import { useEffect, useState } from "react";
import { qry } from "../lib/hooks";
import SearchSelect from "./SearchSelect";

/**
 * Modal to pick (or create) a wholesale customer.
 *
 * Props:
 *   onSelect(customer) — called with the chosen customer row
 *   onClose()          — dismiss without selecting
 */
export default function CustomerPickerModal({ onSelect, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode]           = useState("pick");   // "pick" | "add"
  const [err, setErr]             = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await qry("wholesale_customers", {
        select: "id,business_name,address_line1,address_line2,city,state,postal_code,phone,email",
        filters: "active_yn=eq.Y",
        order: "business_name.asc",
        limit: 500,
      });
      setCustomers(rows || []);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const selectedCustomer = customers.find(c => c.id === selectedId);
  const options = customers.map(c => ({ value: c.id, label: c.business_name }));

  const handleUse = () => {
    if (!selectedCustomer) return;
    onSelect(selectedCustomer);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">
            {mode === "add" ? "Add New Customer" : "Choose Customer"}
          </h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

        {mode === "pick" ? (
          <>
            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">Customer</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    {loading ? (
                      <div className="text-sm text-stone-400 py-2">Loading customers...</div>
                    ) : err ? (
                      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                        Couldn't load: {err}
                        <div className="text-xs text-stone-500 mt-1">Run the wholesale_customers.sql migration first.</div>
                      </div>
                    ) : (
                      <SearchSelect
                        value={selectedId}
                        displayValue={selectedCustomer?.business_name || ""}
                        staticOptions={options}
                        onSelect={(val) => setSelectedId(val)}
                        placeholder={customers.length ? "Search or select a customer..." : "No customers yet — click + Add New"} />
                    )}
                  </div>
                  <button onClick={() => setMode("add")}
                    className="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 shrink-0">
                    + Add New
                  </button>
                </div>
              </div>

            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-200 bg-stone-50 rounded-b-xl">
              <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
              <button onClick={handleUse} disabled={!selectedId}
                className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                Continue
              </button>
            </div>
          </>
        ) : (
          <AddBody
            onCancel={() => setMode("pick")}
            onCreated={(c) => {
              setCustomers(prev => [...prev, c].sort((a, b) => a.business_name.localeCompare(b.business_name)));
              setSelectedId(c.id);
              setMode("pick");
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Add body ─────────────────────────────────────────────────────────

function AddBody({ onCancel, onCreated }) {
  const [f, setF] = useState({
    business_name: "", address_line1: "", address_line2: "",
    city: "", state: "", postal_code: "", phone: "", email: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!f.business_name.trim()) { setErr("Business name is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        business_name: f.business_name.trim(),
        address_line1: f.address_line1.trim() || null,
        address_line2: f.address_line2.trim() || null,
        city:          f.city.trim()          || null,
        state:         f.state.trim()         || null,
        postal_code:   f.postal_code.trim()   || null,
        phone:         f.phone.trim()         || null,
        email:         f.email.trim()         || null,
      };
      const [created] = await qry("wholesale_customers", { insert: payload });
      onCreated(created);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-bold text-stone-500 uppercase tracking-wide mb-1";

  return (
    <>
      <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-auto">
        <div>
          <label className={lc}>Business Name *</label>
          <input autoFocus className={ic} value={f.business_name} onChange={e => set("business_name", e.target.value)} />
        </div>
        <div>
          <label className={lc}>Address Line 1</label>
          <input className={ic} value={f.address_line1} onChange={e => set("address_line1", e.target.value)} />
        </div>
        <div>
          <label className={lc}>Address Line 2</label>
          <input className={ic} value={f.address_line2} onChange={e => set("address_line2", e.target.value)} placeholder="Suite / floor (optional)" />
        </div>
        <div className="grid grid-cols-[1fr_100px_130px] gap-3">
          <div>
            <label className={lc}>City</label>
            <input className={ic} value={f.city} onChange={e => set("city", e.target.value)} />
          </div>
          <div>
            <label className={lc}>State</label>
            <input className={ic} value={f.state} onChange={e => set("state", e.target.value)} maxLength={2} placeholder="OH" />
          </div>
          <div>
            <label className={lc}>ZIP</label>
            <input className={ic} value={f.postal_code} onChange={e => set("postal_code", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lc}>Phone</label>
            <input className={ic} value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="555-555-5555" />
          </div>
          <div>
            <label className={lc}>Email</label>
            <input className={ic} value={f.email} onChange={e => set("email", e.target.value)} placeholder="orders@example.com" />
          </div>
        </div>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>
        )}
      </div>

      <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-200 bg-stone-50 rounded-b-xl">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Back</button>
        <button onClick={save} disabled={saving || !f.business_name.trim()}
          className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save Customer"}
        </button>
      </div>
    </>
  );
}
