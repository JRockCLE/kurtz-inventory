import { useState, useRef, useEffect, useCallback } from "react";
import { qry, searchVendors, searchDepts, searchCategories, searchSubCategories, searchUnits, searchLocations, uploadPhoto, addItemLocation, getItemLocations, removeItemLocation, SB_URL, SB_KEY } from "../lib/hooks";
import { imgUrl } from "../lib/helpers";
import SearchSelect from "./SearchSelect";
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
      product_type: item.product_type || "dry",
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

export default function ItemModal({ item, categories, depts, vendors, units, onSave, onClose, onDelete }) {
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
    product_type: normalized.product_type || "dry",
  });

  // Photos
  const [photos, setPhotos] = useState(item?.photos || []);
  const [defaultPhoto, setDefaultPhoto] = useState(item?.default_photo || null);
  const [newPhotos, setNewPhotos] = useState([]); // [{ file, preview }]
  const photoInputRef2 = useRef(null);
  const [lightbox, setLightbox] = useState(null); // { idx }
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(null);

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files || []);
    const added = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setNewPhotos(prev => [...prev, ...added]);
    e.target.value = "";
  };

  const removeExistingPhoto = (url) => {
    setPhotos(prev => prev.filter(u => u !== url));
    if (defaultPhoto === url) setDefaultPhoto(photos.find(u => u !== url) || null);
  };

  const removeNewPhoto = (idx) => {
    setNewPhotos(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      // Upload any new photos
      let allPhotos = [...photos];
      if (newPhotos.length > 0) {
        for (const p of newPhotos) {
          const url = await uploadPhoto(p.file, f.upc.trim());
          allPhotos.push(url);
        }
      }
      const defPhoto = defaultPhoto && allPhotos.includes(defaultPhoto) ? defaultPhoto : (allPhotos[0] || null);

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
        product_type: f.product_type || "dry",
        photos: allPhotos,
        default_photo: defPhoto,
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

  const handleDelete = async () => {
    if (!isEdit || !normalized.localId) return;
    if (!confirm(`Delete "${f.name || f.upc}"?\n\nThis will mark the item inactive and remove it from all lists.`)) return;
    setDeleting(true);
    try {
      await qry("local_items", {
        schema: "public",
        update: { active_yn: "N", updated_at: new Date().toISOString() },
        match: { id: normalized.localId },
      });
      onDelete?.(normalized.localId);
    } catch (err) {
      alert("Error deleting: " + err.message);
      setDeleting(false);
    }
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

          {/* ─── PHOTOS ─── */}
          <div className="border-t border-stone-200 pt-4 pb-4">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-3 bg-stone-600 -mx-5 px-5 py-1.5">Product Photos</div>
            <div className="flex gap-2 flex-wrap">
              {photos.map((url, i) => (
                <div key={url} className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 cursor-pointer transition-colors ${defaultPhoto === url ? "border-amber-500" : "border-stone-200 hover:border-stone-300"}`}
                  onClick={() => { setLightbox({ idx: i }); setZoom(1); setPan({ x: 0, y: 0 }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setDefaultPhoto(url); }}
                  title="Click to view, double-click to set as default">
                  <img src={imgUrl(url, { width: 200 })} alt="" loading="lazy" className="w-full h-full object-cover" />
                  {defaultPhoto === url && (
                    <div className="absolute bottom-0 inset-x-0 bg-amber-500 text-white text-[9px] text-center font-bold py-0.5">DEFAULT</div>
                  )}
                  <button onClick={e => { e.stopPropagation(); removeExistingPhoto(url); }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">
                    x
                  </button>
                </div>
              ))}
              {newPhotos.map((p, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border-2 border-blue-300">
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 inset-x-0 bg-blue-500 text-white text-[9px] text-center font-bold py-0.5">NEW</div>
                  <button onClick={() => removeNewPhoto(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">
                    x
                  </button>
                </div>
              ))}
              <button onClick={() => photoInputRef2.current?.click()}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-400 hover:border-amber-400 hover:text-amber-500 transition-colors">
                <span className="text-2xl leading-none">+</span>
                <span className="text-[10px] mt-0.5">Photo</span>
              </button>
            </div>
            <input ref={photoInputRef2} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handlePhotoUpload} />
            {photos.length === 0 && newPhotos.length === 0 && (
              <p className="text-xs text-stone-400 mt-2">No photos yet. Click + to add.</p>
            )}
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
              <div className="w-[130px] shrink-0">
                <label className={lc}>Type</label>
                <select className={ic} value={f.product_type} onChange={e => set("product_type", e.target.value)}>
                  <option value="dry">Dry</option>
                  <option value="cooler">Cooler</option>
                  <option value="freezer">Freezer</option>
                </select>
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
                <SearchSelect key={`cat-${f.dept_id}`} value={f.category_id} displayValue={f.category_name}
                  fetchOptions={(typed) => searchCategories(typed, f.dept_id)}
                  onSelect={(val, label) => { set("category_id", val || ""); set("category_name", label || ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                  placeholder={f.dept_id ? "Type to search..." : "Select dept first"} />
              </div>
              <div>
                <label className={lc}>Sub-Category</label>
                <SearchSelect key={`sub-${f.category_id}`} value={f.sub_category_id} displayValue={f.sub_category_name}
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
                <label className={lc}>Warehouse Locations</label>
                {isEdit && normalized.localId ? (
                  <LocationsManager localItemId={normalized.localId}
                    onPrimaryChange={(label) => set("warehouse_location", label || "")} />
                ) : (
                  <>
                    <SearchSelect value={f.warehouse_location} displayValue={f.warehouse_location}
                      fetchOptions={searchLocations}
                      onSelect={(v) => set("warehouse_location", v || "")}
                      placeholder="Type to search..." />
                    <button type="button" onClick={() => set("_showLocModal", true)}
                      className="text-[11px] text-amber-600 hover:text-amber-700 font-medium mt-1">+ Add new location</button>
                  </>
                )}
              </div>
              <div><label className={lc}>Store Location</label><input className={ic} value={f.store_location} onChange={e => set("store_location", e.target.value)} placeholder="e.g., Aisle 4" /></div>
            </div>
            <div><label className={lc}>Notes</label><input className={ic} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Additional info..." /></div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-stone-200 bg-stone-50 rounded-b-xl gap-3">
          <div className="flex items-center gap-3">
            {isEdit && onDelete && (
              <button onClick={handleDelete} disabled={saving || deleting}
                className="px-3 py-2 text-sm text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-lg font-medium transition-colors disabled:opacity-50">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            )}
            <div className="text-[11px] text-stone-400 hidden md:block">{isEdit ? "Editing local item" : "New items are saved locally until synced to POS"}</div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
            <button onClick={save} disabled={saving || deleting || !canSave}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${canSave ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Item"}
            </button>
          </div>
        </div>
      </div>
      {/* ─── Add Location Modal ─── */}
      {/* ─── Photo Lightbox ─── */}
      {lightbox && photos[lightbox.idx] && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex flex-col" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-white/70 text-sm">{lightbox.idx + 1} / {photos.length}</span>
            <div className="flex items-center gap-2">
              <button onClick={e => { e.stopPropagation(); setZoom(z => Math.max(1, z - 0.5)); }}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-sm font-bold">−</button>
              <span className="text-white/70 text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={e => { e.stopPropagation(); setZoom(z => Math.min(8, z + 0.5)); }}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-sm font-bold">+</button>
              <button onClick={e => { e.stopPropagation(); setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="px-2 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-[10px] font-medium">Reset</button>
              <button onClick={e => { e.stopPropagation(); setDefaultPhoto(photos[lightbox.idx]); }}
                className={`px-2 h-7 rounded text-[10px] font-bold ${defaultPhoto === photos[lightbox.idx] ? "bg-amber-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}>
                {defaultPhoto === photos[lightbox.idx] ? "Default" : "Set Default"}
              </button>
              <button onClick={() => setLightbox(null)}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-sm ml-2">×</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center relative overflow-hidden min-h-0"
            onClick={e => e.stopPropagation()}
            onWheel={e => { e.preventDefault(); setZoom(z => Math.max(1, Math.min(8, z + (e.deltaY < 0 ? 0.25 : -0.25)))); }}
            onMouseDown={e => { if (zoom > 1) panRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y }; }}
            onMouseMove={e => { if (panRef.current) setPan({ x: panRef.current.origX + (e.clientX - panRef.current.startX), y: panRef.current.origY + (e.clientY - panRef.current.startY) }); }}
            onMouseUp={() => { panRef.current = null; }}
            onMouseLeave={() => { panRef.current = null; }}
            style={{ cursor: zoom > 1 ? (panRef.current ? "grabbing" : "grab") : "default" }}>
            <img src={imgUrl(photos[lightbox.idx], { width: 1600 })} alt="" draggable={false}
              className="max-w-full max-h-full object-contain select-none pointer-events-none"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: panRef.current ? "none" : "transform 0.1s" }} />
            {lightbox.idx > 0 && zoom === 1 && (
              <button onClick={e => { e.stopPropagation(); setLightbox({ idx: lightbox.idx - 1 }); setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-xl font-bold">‹</button>
            )}
            {lightbox.idx < photos.length - 1 && zoom === 1 && (
              <button onClick={e => { e.stopPropagation(); setLightbox({ idx: lightbox.idx + 1 }); setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-xl font-bold">›</button>
            )}
          </div>
          {photos.length > 1 && (
            <div className="flex gap-1.5 justify-center py-2">
              {photos.map((url, i) => (
                <div key={i} onClick={e => { e.stopPropagation(); setLightbox({ idx: i }); setZoom(1); setPan({ x: 0, y: 0 }); }}
                  className={`w-12 h-12 shrink-0 rounded overflow-hidden cursor-pointer border-2 transition-colors ${i === lightbox.idx ? "border-amber-500" : "border-transparent opacity-60 hover:opacity-100"}`}>
                  <img src={imgUrl(url, { width: 120 })} alt="" loading="lazy" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {f._showLocModal && <AddLocationModal ic={ic} lc={lc} onClose={(label) => {
        if (label) set("warehouse_location", label);
        set("_showLocModal", false);
      }} />}
    </div>
  );
}

function LocationsManager({ localItemId, onPrimaryChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const initialLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!initialLoaded.current) setLoading(true);
    try {
      const data = await getItemLocations(localItemId);
      setRows(data);
      initialLoaded.current = true;
    } finally { setLoading(false); }
  }, [localItemId]);

  useEffect(() => { load(); }, [load]);

  const syncPrimary = useCallback(async (label) => {
    await qry("local_items", {
      update: { warehouse_location: label || null, updated_at: new Date().toISOString() },
      match: { id: localItemId },
    });
    onPrimaryChange?.(label);
  }, [localItemId, onPrimaryChange]);

  const persistOrder = async (next) => {
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (!r.id) continue;
      if (r.sort_order === i && r.is_primary === (i === 0)) continue;
      await qry("local_item_locations", {
        update: { sort_order: i, is_primary: i === 0, updated_at: new Date().toISOString() },
        match: { id: r.id },
      });
    }
    await syncPrimary(next[0]?.location || null);
  };

  const handleDrop = async (e, dropIdx) => {
    e.preventDefault();
    const from = draggingIdx;
    setDraggingIdx(null);
    setOverIdx(null);
    if (from == null || from === dropIdx) return;
    const reordered = [...rows];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(dropIdx, 0, moved);
    // Reflect new sort_order/is_primary locally so UI matches what we'll persist
    const synced = reordered.map((r, i) => ({ ...r, sort_order: i, is_primary: i === 0 }));
    setRows(synced);
    setBusy(true);
    try { await persistOrder(synced); }
    catch (err) { alert("Error: " + err.message); await load(); }
    setBusy(false);
  };

  const swap = async (idx, newLocation) => {
    if (!newLocation) return;
    const row = rows[idx];
    if (row && row.location === newLocation) return;
    if (rows.some((r, i) => i !== idx && r.location === newLocation)) {
      alert("That location is already in the list.");
      return;
    }
    setBusy(true);
    try {
      if (row?._draft) {
        await addItemLocation(localItemId, newLocation, idx === 0, idx);
      } else {
        await qry("local_item_locations", {
          update: { location: newLocation, updated_at: new Date().toISOString() },
          match: { id: row.id },
        });
      }
      await load();
      if (idx === 0) await syncPrimary(newLocation);
    } catch (err) { alert("Error: " + err.message); }
    setBusy(false);
  };

  const remove = async (idx) => {
    const row = rows[idx];
    if (row._draft) { setRows(rows.filter((_, i) => i !== idx)); return; }
    if (!confirm(`Remove "${row.location}"?`)) return;
    setBusy(true);
    try {
      await removeItemLocation(row.id);
      const next = rows.filter((_, i) => i !== idx);
      setRows(next);
      await persistOrder(next);
      if (next.length === 0) await syncPrimary(null);
    } catch (err) { alert("Error: " + err.message); }
    setBusy(false);
  };

  const addBlank = () => {
    if (rows.some(r => r._draft)) return;
    setRows([...rows, { id: null, location: "", is_primary: false, sort_order: rows.length, _draft: true }]);
  };

  return (
    <div className="border border-stone-200 rounded-lg bg-white">
      <div className="divide-y divide-stone-100">
        {loading ? (
          <div className="px-3 py-2 text-xs text-stone-400">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-2 text-xs text-stone-400">No locations assigned yet.</div>
        ) : (
          rows.map((row, i) => (
            <div key={row.id ?? `draft-${i}`}
              draggable={!row._draft && !busy}
              onDragStart={() => setDraggingIdx(i)}
              onDragEnd={() => { setDraggingIdx(null); setOverIdx(null); }}
              onDragOver={(e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); }}
              onDrop={(e) => handleDrop(e, i)}
              className={`flex items-center gap-2 px-2 py-1.5 transition-colors ${draggingIdx === i ? "opacity-40" : ""} ${overIdx === i && draggingIdx !== i ? "bg-amber-50" : ""}`}>
              <span className={`text-stone-300 select-none ${row._draft ? "" : "cursor-grab"}`} title="Drag to reorder">⋮⋮</span>
              <div className="flex-1 min-w-0">
                <SearchSelect value={row.location} displayValue={row.location}
                  fetchOptions={searchLocations}
                  onSelect={(v) => v && swap(i, v)}
                  placeholder={row._draft ? "Select a location..." : "Click to swap..."} />
              </div>
              {i === 0 && !row._draft && (
                <span className="text-[10px] italic text-amber-600 shrink-0">Primary</span>
              )}
              <button type="button" disabled={busy} onClick={() => remove(i)}
                className="text-stone-300 hover:text-red-500 text-lg leading-none px-1" title="Remove">×</button>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-stone-100 p-2">
        <button type="button" onClick={addBlank} disabled={busy || rows.some(r => r._draft)}
          className="text-[11px] font-bold uppercase tracking-wide text-amber-600 hover:text-amber-700 disabled:opacity-50">
          + Add Location
        </button>
      </div>
    </div>
  );
}

function AddLocationModal({ ic, lc, onClose }) {
  const [loc, setLoc] = useState({ prefix: "", section: "", row: "", slot: "", whSection: "", aisle: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const s = (k, v) => setLoc(prev => ({ ...prev, [k]: v }));
  const label = loc.section && loc.row
    ? `${loc.prefix ? `${loc.prefix}-` : ""}${loc.section}${loc.row.toUpperCase()}${loc.slot ? `-${loc.slot}` : ""}`
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
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={lc}>Prefix</label>
              <select className={ic} value={loc.prefix} onChange={e => s("prefix", e.target.value)}>
                <option value="">None</option>
                <option value="C">C</option>
                <option value="F">F</option>
              </select>
            </div>
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
