import { useState, useRef, useEffect } from "react";
import { qry, searchVendors, searchDepts, searchCategories, searchSubCategories, searchUnits, searchLocations } from "../lib/hooks";
import SearchSelect from "./SearchSelect";

const SB_URL = "https://veqsqzzymxjniagodkey.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcXNxenp5bXhqbmlhZ29ka2V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ5NDIxOCwiZXhwIjoyMDkxMDcwMjE4fQ.05MhQ5FB1jEV05f435JhTMn61yEWmzPU22add0tBP64";
const sbH = (schema = "posbe") => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": schema, "Content-Profile": schema, "Content-Type": "application/json" });

async function checkUpcExists(upc) {
  if (!upc || upc.length < 3) return null;
  const res = await fetch(`${SB_URL}/rest/v1/v_items?UPC_TX=eq.${encodeURIComponent(upc)}&select=Item_ID,Name_TX,Mfg_Name,Size_TX,Price,Dept_Name,Category_Name&limit=1`, { headers: sbH() });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.length > 0) return data[0];
  const lr = await fetch(`${SB_URL}/rest/v1/local_items?upc=eq.${encodeURIComponent(upc)}&active_yn=eq.Y&select=id,name,size,retail_price&limit=1`, { headers: sbH("public") });
  if (!lr.ok) return null;
  const ld = await lr.json();
  if (ld.length > 0) return { Item_ID: `local-${ld[0].id}`, Name_TX: ld[0].name, Size_TX: ld[0].size, Price: ld[0].retail_price };
  return null;
}


// ─── Normalize item data from different sources ───
function normalizeItem(item, vendorMap, deptMap, catMap) {
  if (!item) return {};

  // Check if it's a POS v_items row (uppercase keys)
  if (item.Name_TX !== undefined) {
    return {
      upc: item.UPC_TX || "",
      mfg_id: item.Mfg_ID || "",
      mfg_name: item.Mfg_Name || (item.Mfg_ID ? vendorMap[item.Mfg_ID] : "") || "",
      name: item.Name_TX || "",
      size: item.Size_TX || "",
      expDate: item.Exp_Date || null,
      dept_id: item.Dept_ID || "",
      dept_name: item.Dept_Name || (item.Dept_ID ? deptMap[item.Dept_ID] : "") || "",
      category_id: item.Category_ID || "",
      category_name: item.Category_Name || (item.Category_ID ? catMap[item.Category_ID] : "") || "",
      price: item.Price || "",
      localId: item._localId || item.localId || null,
      source: item._source || "pos",
    };
  }

  // Check if it's a local_items row (lowercase keys)
  if (item.name !== undefined) {
    return {
      upc: item.upc || "",
      mfg_id: item.mfg_id || "",
      mfg_name: item._mfg_name || (item.mfg_id ? (vendorMap[item.mfg_id] || "") : ""),
      name: item.name || "",
      size: item.size || "",
      expDate: item.expiration_date || null,
      dept_id: item.dept_id || "",
      dept_name: item.dept_id ? (deptMap[item.dept_id] || "") : "",
      category_id: item.category_id || "",
      category_name: item.category_id ? (catMap[item.category_id] || "") : "",
      sub_category_id: item.sub_category_id || "",
      ref_unit_cd: item.ref_unit_cd || "",
      price: item.retail_price || "",
      cost: item.cost || "",
      case_size: item.case_size || "",
      cases_on_hand: item.cases_on_hand || 0,
      warehouse_location: item.warehouse_location || "",
      store_location: item.store_location || "",
      notes: item.notes || "",
      localId: item._localId || item.localId || item.id || null,
      source: "local",
    };
  }

  // Fallback — try the camelCase format from buildUnifiedItems
  return {
    upc: item.upc || "",
    mfg_id: item.mfgId || "",
    mfg_name: item.mfgId ? (vendorMap[item.mfgId] || "") : "",
    name: item.name || "",
    size: item.size || "",
    expDate: item.expDate || null,
    dept_id: item.deptId || "",
    dept_name: item.deptId ? (deptMap[item.deptId] || "") : "",
    category_id: item.catId || "",
    category_name: item.catId ? (catMap[item.catId] || "") : "",
    price: item.price || "",
    cost: item.cost || "",
    case_size: item.caseSize || "",
    cases_on_hand: item.casesLeft || 0,
    warehouse_location: item.warehouseLocation || "",
    store_location: item.storeLocation || "",
    notes: item.notes || "",
    localId: item.localId || null,
    source: item.source || "pos",
  };
}

export default function ItemModal({ item, categories, depts, vendors, units, onSave, onClose }) {
  const barcodeRef = useRef(null);

  const vendorMap = Object.fromEntries((vendors || []).map(v => [v.Vendor_ID, v.Vendor_Name_TX]));
  const deptMap = Object.fromEntries((depts || []).map(d => [d.Dept_ID, d.Name_TX]));
  const catMap = Object.fromEntries((categories || []).map(c => [c.Category_ID, c.Name_TX]));
  const unitMap = Object.fromEntries((units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX]));

  const normalized = normalizeItem(item, vendorMap, deptMap, catMap);
  const isEdit = !!item && !!normalized.localId;

  const [f, setF] = useState({
    upc: normalized.upc,
    mfg_id: normalized.mfg_id,
    mfg_name: normalized.mfg_name,
    name: normalized.name,
    size: normalized.size,
    unit_cd: normalized.ref_unit_cd || "",
    unit_name: normalized.ref_unit_cd ? (unitMap[String(normalized.ref_unit_cd)] || "") : "",
    expiration_date: normalized.expDate ? new Date(normalized.expDate).toISOString().slice(0, 10) : "",
    dept_id: normalized.dept_id,
    dept_name: normalized.dept_name,
    category_id: normalized.category_id,
    category_name: normalized.category_name,
    sub_category_id: normalized.sub_category_id || "",
    sub_category_name: "",
    retail_price: normalized.price,
    case_cost: normalized.cost && normalized.case_size ? (parseFloat(normalized.cost) * parseInt(normalized.case_size)).toFixed(2) : (normalized.cost || ""),
    case_size: normalized.case_size || "",
    cases_on_hand: normalized.cases_on_hand || 0,
    warehouse_location: normalized.warehouse_location || "",
    store_location: normalized.store_location || "",
    notes: normalized.notes || "",
  });

  const [saving, setSaving] = useState(false);
  const [upcChecking, setUpcChecking] = useState(false);
  const [upcMatch, setUpcMatch] = useState(null);
  const [upcChecked, setUpcChecked] = useState(isEdit);
  const [upcTimer, setUpcTimer] = useState(null);

  useEffect(() => {
    if (!isEdit && barcodeRef.current) setTimeout(() => barcodeRef.current?.focus(), 100);
  }, [isEdit]);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const handleUpcChange = (val) => {
    set("upc", val);
    setUpcMatch(null);
    setUpcChecked(false);
    if (upcTimer) clearTimeout(upcTimer);
    if (val.length >= 6) {
      setUpcChecking(true);
      const t = setTimeout(async () => {
        const match = await checkUpcExists(val);
        // Don't flag as duplicate if editing the same item
        if (match && isEdit && String(match.Item_ID) === String(normalized.localId)) {
          setUpcMatch(null);
        } else {
          setUpcMatch(match);
        }
        setUpcChecked(true);
        setUpcChecking(false);
      }, 500);
      setUpcTimer(t);
    } else {
      setUpcChecking(false);
    }
  };

  const handleUpcKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (upcTimer) clearTimeout(upcTimer);
      if (f.upc.length >= 6) {
        setUpcChecking(true);
        checkUpcExists(f.upc).then(match => {
          if (match && isEdit && String(match.Item_ID) === String(normalized.localId)) setUpcMatch(null);
          else setUpcMatch(match);
          setUpcChecked(true);
          setUpcChecking(false);
          if (!match) document.getElementById("field-mfg")?.focus();
        });
      }
    }
  };

  const canSave = f.name.trim() && f.upc.trim() && !upcMatch;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        upc: f.upc.trim(),
        mfg_id: f.mfg_id ? parseInt(f.mfg_id) : null,
        name: f.name.trim(),
        size: f.size.trim() || null,
        ref_unit_cd: f.unit_cd ? parseInt(f.unit_cd) : null,
        expiration_date: f.expiration_date || null,
        dept_id: f.dept_id ? parseInt(f.dept_id) : null,
        category_id: f.category_id ? parseInt(f.category_id) : null,
        sub_category_id: f.sub_category_id ? parseInt(f.sub_category_id) : null,
        retail_price: f.retail_price ? parseFloat(f.retail_price) : null,
        cost: f.case_cost && f.case_size ? parseFloat((parseFloat(f.case_cost) / parseInt(f.case_size)).toFixed(2)) : null,
        case_size: f.case_size ? parseInt(f.case_size) : null,
        cases_on_hand: parseInt(f.cases_on_hand) || 0,
        warehouse_location: f.warehouse_location.trim() || null,
        store_location: f.store_location.trim() || null,
        notes: f.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (isEdit && normalized.localId) {
        await qry("local_items", { schema: "public", update: payload, match: { id: normalized.localId } });
      } else {
        payload.sync_status = "local";
        payload.created_by = "Store";
        await qry("local_items", { schema: "public", insert: payload });
      }
      onSave();
    } catch (err) { alert("Error: " + err.message); }
    setSaving(false);
  };

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent";
  const lc = "block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-6 px-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mb-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h2 className="text-lg font-bold text-stone-800">{isEdit ? "Edit Item" : "Add New Item"}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-0">
          {/* ─── BARCODE ─── */}
          <div className="pb-4">
            <label className={lc}>Barcode / UPC *{upcChecking && <span className="ml-2 text-stone-400 font-normal">checking...</span>}</label>
            <input ref={barcodeRef} className={`${ic} text-lg font-mono tracking-wider ${upcMatch ? "border-red-400 bg-red-50" : upcChecked && !upcMatch && f.upc.length >= 6 ? "border-green-400 bg-green-50" : ""}`}
              value={f.upc} onChange={e => handleUpcChange(e.target.value)} onKeyDown={handleUpcKeyDown}
              placeholder="Scan or type barcode..." autoFocus={!isEdit} />
            {upcMatch && (
              <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-sm font-bold text-red-700 mb-1">This barcode already exists!</div>
                <div className="text-xs text-red-600 space-y-0.5">
                  <div><span className="font-semibold">Item:</span> {upcMatch.Name_TX}</div>
                  {upcMatch.Mfg_Name && <div><span className="font-semibold">Mfg:</span> {upcMatch.Mfg_Name}</div>}
                  {upcMatch.Size_TX && <div><span className="font-semibold">Size:</span> {upcMatch.Size_TX}</div>}
                  {upcMatch.Price && <div><span className="font-semibold">Price:</span> ${parseFloat(upcMatch.Price).toFixed(2)}</div>}
                  {upcMatch.Dept_Name && <div><span className="font-semibold">Dept:</span> {upcMatch.Dept_Name} › {upcMatch.Category_Name}</div>}
                </div>
              </div>
            )}
            {upcChecked && !upcMatch && f.upc.length >= 6 && <div className="mt-1 text-xs text-green-600 font-medium">Barcode is available</div>}
          </div>

          {/* ─── PRODUCT INFO ─── */}
          <div className="border-t border-stone-200 pt-4 pb-4">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-3 bg-stone-600 -mx-5 px-5 py-1.5">Product Info</div>
            <div className="grid grid-cols-[200px_1fr] gap-3 mb-3">
              <div>
                <label className={lc}>Manufacturer</label>
                <SearchSelect id="field-mfg" value={f.mfg_id} displayValue={f.mfg_name}
                  fetchOptions={searchVendors}
                  onSelect={(val, label) => { set("mfg_id", val || ""); set("mfg_name", label || ""); }}
                  placeholder="Type to search..." />
              </div>
              <div>
                <label className={lc}>Item Name *</label>
                <input className={ic} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g., Classic Roast Coffee" />
              </div>
            </div>
            <div className="flex gap-3">
              <div style={{ width: Math.max(60, Math.min(120, (f.size?.toString().length || 3) * 14 + 30)) }}>
                <label className={lc}>Size</label><input className={ic} value={f.size} onChange={e => set("size", e.target.value)} placeholder="e.g., 30.5" />
              </div>
              <div style={{ width: Math.max(80, Math.min(150, (f.unit_name?.length || 8) * 9 + 30)) }}>
                <label className={lc}>Unit</label>
                <SearchSelect value={f.unit_cd} displayValue={f.unit_name}
                  fetchOptions={searchUnits}
                  onSelect={(val, label) => { set("unit_cd", val || ""); set("unit_name", label || ""); }}
                  placeholder="Type to search..." />
              </div>
              <div className="w-[170px] shrink-0">
                <label className={lc}>Expiration Date</label><input type="date" className={ic} value={f.expiration_date} onChange={e => set("expiration_date", e.target.value)} />
              </div>
              <div className="flex-1" />
            </div>
          </div>

          {/* ─── STORE SORTING ─── */}
          <div className="border-t border-stone-200 pt-4 pb-4">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-3 bg-stone-600 -mx-5 px-5 py-1.5">Store Sorting</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lc}>Department</label>
                <SearchSelect value={f.dept_id} displayValue={f.dept_name}
                  fetchOptions={searchDepts}
                  onSelect={(val, label) => { set("dept_id", val || ""); set("dept_name", label || ""); set("category_id", ""); set("category_name", ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                  placeholder="Type to search..." />
              </div>
              <div>
                <label className={lc}>Category</label>
                <SearchSelect value={f.category_id} displayValue={f.category_name}
                  fetchOptions={(typed) => searchCategories(typed, f.dept_id)}
                  onSelect={(val, label) => { set("category_id", val || ""); set("category_name", label || ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                  placeholder={f.dept_id ? "Type to search..." : "Select dept first"} />
              </div>
              <div>
                <label className={lc}>Sub-Category</label>
                <SearchSelect value={f.sub_category_id} displayValue={f.sub_category_name}
                  fetchOptions={(typed) => searchSubCategories(typed, f.category_id)}
                  onSelect={(val, label) => { set("sub_category_id", val || ""); set("sub_category_name", label || ""); }}
                  placeholder={f.category_id ? "Type to search..." : "Select category first"} />
              </div>
            </div>
          </div>

          {/* ─── PRICING & COST ─── */}
          <div className="border-t border-stone-200 pt-4 pb-4">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-3 bg-stone-600 -mx-5 px-5 py-1.5">Pricing &amp; Cost</div>
            <div className="grid grid-cols-4 gap-3">
              <div><label className={lc}>Retail Price</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input type="number" step="0.01" className={`${ic} pl-7`} value={f.retail_price} onChange={e => set("retail_price", e.target.value)} placeholder="0.00" /></div></div>
              <div><label className={lc}>Cost Per Case</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input type="number" step="0.01" className={`${ic} pl-7`} value={f.case_cost} onChange={e => set("case_cost", e.target.value)} placeholder="0.00" /></div></div>
              <div><label className={lc}>Units Per Case</label><input type="number" className={ic} value={f.case_size} onChange={e => set("case_size", e.target.value)} placeholder="12" /></div>
              <div><label className={lc}>Unit Cost</label>
                <div className="px-3 py-2 text-sm text-stone-600 font-medium">
                  {f.case_cost && f.case_size ? `$${(parseFloat(f.case_cost) / parseInt(f.case_size)).toFixed(2)}` : "—"}
                </div></div>
            </div>
          </div>

          {/* ─── INVENTORY & LOCATIONS ─── */}
          <div className="border-t border-stone-200 pt-4 pb-2">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-3 bg-stone-600 -mx-5 px-5 py-1.5">Inventory &amp; Locations</div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><label className={lc}>Cases On Hand</label><input type="number" className={ic} value={f.cases_on_hand} onChange={e => set("cases_on_hand", e.target.value)} placeholder="0" /></div>
              <div>
                <label className={lc}>Warehouse Location</label>
                <SearchSelect value={f.warehouse_location} displayValue={f.warehouse_location}
                  fetchOptions={searchLocations}
                  onSelect={(v) => set("warehouse_location", v || "")}
                  placeholder="Type to search..." />
                <button type="button" onClick={() => set("_showLocModal", true)}
                  className="text-[11px] text-amber-600 hover:text-amber-700 font-medium mt-1">+ Add new location</button>
              </div>
              <div><label className={lc}>Store Location</label><input className={ic} value={f.store_location} onChange={e => set("store_location", e.target.value)} placeholder="e.g., Aisle 4" /></div>
            </div>
            <div><label className={lc}>Notes</label><input className={ic} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional info..." /></div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-stone-200 bg-stone-50 rounded-b-xl">
          <div className="text-xs text-stone-400">{isEdit ? "Editing local item" : "New items are saved locally until synced to POS"}</div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
            <button onClick={save} disabled={saving || !canSave}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${canSave ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Item"}
            </button>
          </div>
        </div>
      </div>
      {/* ─── Add Location Modal ─── */}
      {f._showLocModal && <AddLocationModal ic={ic} lc={lc} onClose={(label) => {
        if (label) set("warehouse_location", label);
        set("_showLocModal", false);
      }} />}
    </div>
  );
}

function AddLocationModal({ ic, lc, onClose }) {
  const [loc, setLoc] = useState({ section: "", row: "", slot: "", whSection: "", aisle: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const s = (k, v) => setLoc(prev => ({ ...prev, [k]: v }));
  const label = loc.section && loc.row
    ? `${loc.section}${loc.row.toUpperCase()}${loc.slot ? `-${loc.slot}` : ""}`
    : "";

  const save = async () => {
    if (!label) return;
    setSaving(true);
    try {
      await qry("warehouse_locations", {
        insert: {
          label,
          column_num: parseInt(loc.section),
          row_letter: loc.row.toUpperCase().trim(),
          slot_num: loc.slot ? parseInt(loc.slot) : null,
          section: loc.whSection.trim() || null,
          aisle: loc.aisle.trim() || null,
          notes: loc.notes.trim() || null,
          active_yn: "Y",
        },
      });
      onClose(label);
    } catch (err) { alert("Error: " + err.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onClick={() => onClose(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 className="text-base font-bold text-stone-800">Add New Location</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lc}>Section # *</label><input type="number" className={ic} value={loc.section} onChange={e => s("section", e.target.value)} placeholder="1" autoFocus /></div>
            <div><label className={lc}>Row *</label><input className={ic} value={loc.row} onChange={e => s("row", e.target.value)} placeholder="A" maxLength={2} /></div>
            <div><label className={lc}>Slot</label><input type="number" className={ic} value={loc.slot} onChange={e => s("slot", e.target.value)} placeholder="—" /></div>
          </div>
          {label && <div className="text-sm text-stone-700 font-mono font-bold">Label: {label}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>WH Section</label><input className={ic} value={loc.whSection} onChange={e => s("whSection", e.target.value)} placeholder="A" /></div>
            <div><label className={lc}>Aisle</label><input className={ic} value={loc.aisle} onChange={e => s("aisle", e.target.value)} placeholder="A1" /></div>
          </div>
          <div><label className={lc}>Notes</label><input className={ic} value={loc.notes} onChange={e => s("notes", e.target.value)} placeholder="Optional..." /></div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-stone-200 bg-stone-50 rounded-b-xl">
          <button onClick={() => onClose(null)} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
          <button onClick={save} disabled={saving || !label}
            className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
            {saving ? "Adding..." : "Add Location"}
          </button>
        </div>
      </div>
    </div>
  );
}
