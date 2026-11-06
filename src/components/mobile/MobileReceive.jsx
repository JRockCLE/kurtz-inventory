import { useState, useRef, useCallback, useEffect } from "react";
import {
  qry,
  checkBarcodeInSystem,
  lookupBarcode,
  addItemLocation,
  searchLocations,
  uploadPhoto,
} from "../../lib/hooks";
import SearchSelect from "../SearchSelect";

// ─── Mobile Receive flow ──────────────────────────────────────────────
// Mobile-tuned version of QuickAdd: scan → lookup → fill out details →
// save → re-focus scan field for the next item. Reuses the same
// Supabase hooks as QuickAdd — only the presentation is new.
//
// Designed for the Zebra TC520K: DataWedge keystroke mode types scans
// into the focused input (barcodeRef), which is auto-refocused after
// every save and whenever the user clears the current item.

const STATUS_TONES = {
  found:    { badge: "bg-green-100 text-green-800 border-green-200", ring: "border-green-200" },
  created:  { badge: "bg-blue-100 text-blue-800 border-blue-200",    ring: "border-blue-200" },
  notfound: { badge: "bg-amber-100 text-amber-800 border-amber-200", ring: "border-amber-300" },
  checking: { badge: "bg-stone-100 text-stone-600 border-stone-200", ring: "border-stone-200" },
  error:    { badge: "bg-red-100 text-red-800 border-red-200",       ring: "border-red-200" },
};

export default function MobileReceive() {
  const barcodeRef = useRef(null);
  const photoInputRef = useRef(null);

  const [barcode, setBarcode] = useState("");
  const [status, setStatus] = useState(null);   // { type, item, upc, message }
  const [location, setLocation] = useState("");
  const [expDate, setExpDate] = useState("");
  const [caseSize, setCaseSize] = useState("");
  const [productType, setProductType] = useState("dry");
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);     // { message, tone }
  const [log, setLog] = useState([]);

  const focusScan = useCallback(() => {
    // Deferred so the input is in the DOM when state swaps the view.
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }, []);

  useEffect(() => { focusScan(); }, [focusScan]);

  const resetForm = useCallback(() => {
    setBarcode("");
    setStatus(null);
    setLocation("");
    setExpDate("");
    setCaseSize("");
    setProductType("dry");
    setPhotos([]);
    setNotes("");
    focusScan();
  }, [focusScan]);

  const showToast = (message, tone = "green") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 1800);
  };

  // ─── Lookup ─────────────────────────────────────────────────────────
  const handleScan = async (upcOverride) => {
    const upc = (upcOverride || barcode).trim();
    if (!upc) return;
    setStatus({ type: "checking", upc, message: "Looking up..." });

    try {
      const existing = await checkBarcodeInSystem(upc);
      if (existing.length > 0) {
        const item = existing[0];
        setProductType(item.product_type || "dry");
        setStatus({ type: "found", item, upc, message: item.name });
        return;
      }

      const posbe = await lookupBarcode(upc);
      if (posbe) {
        setProductType("dry");
        setStatus({
          type: "created",
          item: { _pending: true, _posbe: posbe, name: posbe.name, product_type: "dry" },
          upc,
          message: posbe.name,
        });
        return;
      }

      setStatus({ type: "notfound", upc, message: "Not in system or StoreLIVE" });
    } catch (err) {
      setStatus({ type: "error", upc, message: err.message || String(err) });
    }
  };

  const handleBarcodeKeyDown = (e) => {
    // DataWedge keystroke mode fires Enter by default after typing the code.
    if (e.key === "Enter") { e.preventDefault(); handleScan(); }
  };

  // ─── Photo capture ─────────────────────────────────────────────────
  const handlePhotoCapture = (e) => {
    const files = Array.from(e.target.files || []);
    const newPhotos = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = "";
  };

  const removePhoto = (idx) => {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // ─── Save paths ─────────────────────────────────────────────────────
  // Known item (either in our system or new from StoreLIVE).
  const saveKnownItem = async () => {
    if (!status?.item) return;
    setSaving(true);
    try {
      const trimmedLoc = location?.trim();

      const photoUrls = [];
      for (const p of photos) {
        const url = await uploadPhoto(p.file, status.upc);
        photoUrls.push(url);
      }

      let itemId = status.item.id;

      if (status.item._pending && status.item._posbe) {
        const posbe = status.item._posbe;
        const [newItem] = await qry("local_items", {
          insert: {
            upc: status.upc,
            name: posbe.name,
            size: posbe.size || null,
            mfg_id: posbe.mfg_id ? parseInt(posbe.mfg_id) : null,
            retail_price: posbe.price ? parseFloat(posbe.price) : null,
            dept_id: posbe.dept_id ? parseInt(posbe.dept_id) : null,
            category_id: posbe.category_id ? parseInt(posbe.category_id) : null,
            sub_category_id: posbe.sub_category_id ? parseInt(posbe.sub_category_id) : null,
            ref_unit_cd: posbe.unit_cd ? parseInt(posbe.unit_cd) : null,
            from_posbe: true,
            posbe_item_id: posbe.item_id,
            sync_status: "local",
            created_by: "MobileReceive",
            active_yn: "Y",
            cases_on_hand: 0,
            product_type: productType || "dry",
            expiration_date: expDate || null,
            case_size: caseSize ? parseInt(caseSize) : null,
            warehouse_location: trimmedLoc || null,
            photos: photoUrls,
            default_photo: photoUrls[0] || null,
          },
        });
        itemId = newItem.id;
        if (trimmedLoc) {
          try { await addItemLocation(itemId, trimmedLoc, true); } catch { /* dup */ }
        }
      } else {
        const itemUpdate = {};
        if (trimmedLoc) {
          const existingLocs = await qry("local_item_locations", {
            select: "id", filters: `local_item_id=eq.${itemId}`, limit: 1,
          });
          const isFirst = !existingLocs.length;
          try { await addItemLocation(itemId, trimmedLoc, isFirst); } catch { /* dup */ }
          if (isFirst) itemUpdate.warehouse_location = trimmedLoc;
        }
        if (expDate) itemUpdate.expiration_date = expDate;
        if (caseSize) itemUpdate.case_size = parseInt(caseSize);
        if (productType && productType !== status.item.product_type) itemUpdate.product_type = productType;

        if (photoUrls.length > 0) {
          try {
            const [existing] = await qry("local_items", { select: "photos,default_photo", filters: `id=eq.${itemId}`, limit: 1 });
            const prev = existing?.photos || [];
            itemUpdate.photos = [...prev, ...photoUrls];
            if (!existing?.default_photo) itemUpdate.default_photo = photoUrls[0];
          } catch {
            itemUpdate.photos = photoUrls;
            itemUpdate.default_photo = photoUrls[0];
          }
        }

        if (Object.keys(itemUpdate).length) {
          await qry("local_items", { update: itemUpdate, match: { id: itemId } });
        }
      }

      setLog(prev => [{
        name: status.item.name, upc: status.upc,
        location: location?.trim() || "—",
        type: status.item._pending ? "created" : (location?.trim() ? "assigned" : "updated"),
        time: new Date(),
      }, ...prev].slice(0, 20));
      showToast(`Saved ${status.item.name}`, "green");
      resetForm();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "red");
    }
    setSaving(false);
  };

  // Unknown item → queued for later processing.
  const saveUnprocessed = async () => {
    if (!status?.upc) return;
    setSaving(true);
    try {
      const photoUrls = [];
      for (const p of photos) {
        const url = await uploadPhoto(p.file, status.upc);
        photoUrls.push(url);
      }

      await qry("unprocessed_items", {
        insert: {
          upc: status.upc,
          warehouse_location: location || null,
          expiration_date: expDate && expDate.trim() ? expDate : null,
          case_size: caseSize ? parseInt(caseSize) : null,
          photos: photoUrls,
          notes: notes.trim() || null,
        },
      });

      setLog(prev => [{
        name: `UPC ${status.upc}`, upc: status.upc,
        location: location || "—", type: "unprocessed",
        photos: photoUrls.length, time: new Date(),
      }, ...prev].slice(0, 20));
      showToast("Queued for processing", "amber");
      resetForm();
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "red");
    }
    setSaving(false);
  };

  // ─── Render ────────────────────────────────────────────────────────
  const tone = status ? STATUS_TONES[status.type] : null;
  const hasForm = status && (status.type === "found" || status.type === "created");
  const notFound = status?.type === "notfound";

  return (
    <div className="flex flex-col h-full relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold text-white max-w-[90vw] ${
          toast.tone === "red" ? "bg-red-600" :
          toast.tone === "amber" ? "bg-amber-600" :
          "bg-green-600"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Sticky scan bar */}
      <div className="sticky top-0 bg-white border-b border-stone-200 px-3 py-2 z-20">
        <input ref={barcodeRef} type="text" inputMode="numeric"
          value={barcode} onChange={e => setBarcode(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
          placeholder="Scan or type barcode…"
          autoFocus
          className="w-full px-4 py-3 border-2 border-amber-500 rounded-xl text-lg font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-500" />
      </div>

      {/* Hidden photo file input */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple
        className="hidden" onChange={handlePhotoCapture} />

      {/* Body */}
      <div className="flex-1 overflow-auto pb-32">
        {/* Idle state */}
        {!status && (
          <div className="p-6 text-center text-stone-400">
            <div className="text-5xl mb-3">📥</div>
            <p className="text-sm">Pull the scanner trigger — or type a barcode above and press Enter.</p>
          </div>
        )}

        {/* Status card */}
        {status && (
          <div className="px-3 pt-3">
            <div className={`rounded-xl border-2 ${tone?.ring || "border-stone-200"} bg-white overflow-hidden`}>
              <div className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest border ${tone?.badge || ""}`}>
                {status.type === "found" && "In System"}
                {status.type === "created" && "New from StoreLIVE"}
                {status.type === "notfound" && "Unknown Item"}
                {status.type === "checking" && "Looking up…"}
                {status.type === "error" && "Error"}
              </div>
              <div className="px-3 py-3">
                <div className="text-base font-bold text-stone-800 break-words">{status.message || status.upc}</div>
                <div className="text-xs text-stone-500 font-mono mt-0.5">UPC {status.upc}</div>
                {status.item?.size && <div className="text-xs text-stone-500 mt-0.5">{status.item.size}</div>}
              </div>
            </div>
          </div>
        )}

        {/* Known item form */}
        {hasForm && (
          <div className="px-3 pt-3 space-y-4">
            {/* Type */}
            <Field label="Type">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "dry",     label: "Dry",     active: "bg-amber-600" },
                  { v: "cooler",  label: "Cooler",  active: "bg-blue-600" },
                  { v: "freezer", label: "Freezer", active: "bg-green-600" },
                ].map(o => (
                  <button key={o.v} type="button" onClick={() => setProductType(o.v)}
                    className={`py-3 rounded-xl text-sm font-bold transition-colors ${
                      productType === o.v ? `${o.active} text-white` : "bg-stone-100 text-stone-700 active:bg-stone-200"
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>

            {/* Location */}
            <Field label="Location">
              <SearchSelect value={location} displayValue={location}
                fetchOptions={searchLocations}
                onSelect={(v) => setLocation(v || "")}
                placeholder="Type or select location…" />
            </Field>

            {/* Units/Case + Exp */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units / Case">
                <input type="number" inputMode="numeric" value={caseSize}
                  onChange={e => setCaseSize(e.target.value)}
                  placeholder="12"
                  className={inputCls} />
              </Field>
              <Field label="Expiration">
                <input type="date" value={expDate}
                  onChange={e => setExpDate(e.target.value)}
                  className={inputCls} />
              </Field>
            </div>

            {/* Photos */}
            <Field label="Photos">
              <PhotoRow photos={photos} onAdd={() => photoInputRef.current?.click()} onRemove={removePhoto} />
            </Field>
          </div>
        )}

        {/* Unknown item form */}
        {notFound && (
          <div className="px-3 pt-3 space-y-4">
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Take at least one photo so this product can be added to the system later.
            </div>

            <Field label="Photos">
              <PhotoRow photos={photos} onAdd={() => photoInputRef.current?.click()} onRemove={removePhoto} tone="amber" />
            </Field>

            <Field label="Location (optional)">
              <SearchSelect value={location} displayValue={location}
                fetchOptions={searchLocations}
                onSelect={(v) => setLocation(v || "")}
                placeholder="Type or select location…" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Units / Case">
                <input type="number" inputMode="numeric" value={caseSize}
                  onChange={e => setCaseSize(e.target.value)}
                  placeholder="12"
                  className={inputCls} />
              </Field>
              <Field label="Expiration">
                <input type="date" value={expDate}
                  onChange={e => setExpDate(e.target.value)}
                  className={inputCls} />
              </Field>
            </div>

            <Field label="Notes (optional)">
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Product name, flavor, anything helpful…"
                className={inputCls} />
            </Field>
          </div>
        )}

        {/* Recent log */}
        {log.length > 0 && (
          <div className="px-3 pt-6">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Recent ({log.length})</div>
            <div className="space-y-1">
              {log.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-white border border-stone-200 rounded-lg text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-stone-800 truncate">{entry.name}</div>
                    <div className="text-stone-400 text-[10px]">
                      {entry.type === "unprocessed" ? `queued · ${entry.photos || 0} photo${entry.photos === 1 ? "" : "s"}` :
                       entry.type === "created" ? "added to system" :
                       entry.type === "assigned" ? "location assigned" : "updated"}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-amber-700 shrink-0">{entry.location}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      {(hasForm || notFound) && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-stone-200 px-3 py-3 flex gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <button onClick={resetForm}
            className="px-4 py-3 bg-stone-100 text-stone-700 rounded-xl text-sm font-bold active:bg-stone-200">
            Cancel
          </button>
          {hasForm && (
            <button onClick={saveKnownItem} disabled={saving}
              className="flex-1 py-3 bg-green-600 text-white rounded-xl text-base font-bold active:bg-green-700 disabled:opacity-50">
              {saving ? "Saving…" : (location ? "Save" : "Save (no location)")}
            </button>
          )}
          {notFound && (
            <button onClick={saveUnprocessed} disabled={saving || photos.length === 0}
              className="flex-1 py-3 bg-amber-600 text-white rounded-xl text-base font-bold active:bg-amber-700 disabled:opacity-50">
              {saving ? "Saving…" : "Queue for Processing"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mobile form primitives ───────────────────────────────────────────

const inputCls = "w-full px-3 py-3 border border-stone-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-amber-500";

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function PhotoRow({ photos, onAdd, onRemove, tone = "stone" }) {
  const addCls = tone === "amber"
    ? "border-amber-300 text-amber-600 active:bg-amber-50"
    : "border-stone-300 text-stone-400 active:bg-stone-50";
  return (
    <div className="flex gap-2 flex-wrap">
      {photos.map((p, i) => (
        <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-stone-200">
          <img src={p.preview} alt="" className="w-full h-full object-cover" />
          <button type="button" onClick={() => onRemove(i)}
            className="absolute top-1 right-1 w-6 h-6 bg-black/70 text-white rounded-full text-xs flex items-center justify-center">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd}
        className={`w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center ${addCls}`}>
        <span className="text-2xl leading-none">+</span>
        <span className="text-[10px] mt-0.5">Photo</span>
      </button>
    </div>
  );
}
