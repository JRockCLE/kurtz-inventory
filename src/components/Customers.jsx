import { useEffect, useState, useMemo } from "react";
import { qry } from "../lib/hooks";

/**
 * Wholesale customer management (Settings → Customers). Full CRUD:
 * list, search, add, edit, deactivate. Deactivation is a soft delete
 * (active_yn='N') so historical invoices retain their FK.
 */
export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);   // customer row or {} for new

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await qry("wholesale_customers", {
        select: "id,business_name,address_line1,address_line2,city,state,postal_code,phone,email,active_yn,created_at",
        filters: "active_yn=eq.Y",
        order: "business_name.asc",
        limit: 1000,
      });
      setCustomers(rows || []);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.trim().toLowerCase();
    return customers.filter(c =>
      (c.business_name || "").toLowerCase().includes(q) ||
      (c.city  || "").toLowerCase().includes(q) ||
      (c.state || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  const deactivate = async (c) => {
    if (!confirm(`Deactivate "${c.business_name}"? They'll no longer appear in the customer picker but existing invoices are preserved.`)) return;
    try {
      await qry("wholesale_customers", {
        update: { active_yn: "N", updated_at: new Date().toISOString() },
        match: { id: c.id },
      });
      load();
    } catch (e) { alert(`Failed: ${e.message}`); }
  };

  return (
    <div className="h-full flex flex-col bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-2">
        <input type="text" placeholder="Search customers..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 max-w-md px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <div className="text-xs text-stone-400">{filtered.length} of {customers.length}</div>
        <div className="flex-1" />
        <button onClick={() => setEditing({})}
          className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
          + Add Customer
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-stone-400 text-sm">Loading...</div>
        ) : err ? (
          <div className="p-8 text-center text-red-600 text-sm">
            {err}
            <div className="text-xs text-stone-500 mt-1">Run the wholesale_customers.sql migration first.</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-400 text-sm">
            {search ? "No matches." : "No customers yet — click + Add Customer to create one."}
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {filtered.map(c => (
              <div key={c.id}
                className="px-4 py-3 bg-white hover:bg-stone-50 transition-colors grid items-center gap-3"
                style={{ gridTemplateColumns: "1fr 260px 180px auto" }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-stone-800 truncate">{c.business_name}</div>
                  <div className="text-xs text-stone-500 truncate">
                    {[
                      c.address_line1,
                      [c.city, c.state, c.postal_code].filter(Boolean).join(", ").replace(/, (\w{2}) /, ", $1 "),
                    ].filter(Boolean).join(" · ") || <span className="italic text-stone-400">No address</span>}
                  </div>
                </div>
                <div className="text-xs text-stone-500 truncate">{c.phone || "—"}</div>
                <div className="text-xs text-stone-500 truncate">{c.email || "—"}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setEditing(c)}
                    className="px-3 py-1 text-xs font-bold border border-stone-300 text-stone-700 rounded hover:bg-stone-100">
                    Edit
                  </button>
                  <button onClick={() => deactivate(c)}
                    title="Deactivate"
                    className="px-2 py-1 text-xs text-stone-400 hover:text-red-500 leading-none">×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <CustomerEditModal
          customer={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Edit modal (also used for Add via customer=null) ────────────────

function CustomerEditModal({ customer, onClose, onSaved }) {
  const isEdit = !!customer?.id;
  const [f, setF] = useState({
    business_name: customer?.business_name || "",
    address_line1: customer?.address_line1 || "",
    address_line2: customer?.address_line2 || "",
    city:          customer?.city          || "",
    state:         customer?.state         || "",
    postal_code:   customer?.postal_code   || "",
    phone:         customer?.phone         || "",
    email:         customer?.email         || "",
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
        updated_at:    new Date().toISOString(),
      };
      if (isEdit) {
        await qry("wholesale_customers", { update: payload, match: { id: customer.id } });
      } else {
        await qry("wholesale_customers", { insert: payload });
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-bold text-stone-500 uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">{isEdit ? "Edit Customer" : "Add Customer"}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

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
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
          <button onClick={save} disabled={saving || !f.business_name.trim()}
            className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Customer"}
          </button>
        </div>
      </div>
    </div>
  );
}
