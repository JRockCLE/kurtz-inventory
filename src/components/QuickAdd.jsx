import { useState, useRef, useCallback, useEffect } from "react";
import { qry, checkBarcodeInSystem, lookupBarcode, addItemLocation, searchLocations, uploadPhoto } from "../lib/hooks";
import SearchSelect from "./SearchSelect";
import { Html5Qrcode } from "html5-qrcode";

export default function QuickAdd() {
  const barcodeRef = useRef(null);
  const locationRef = useRef(null);
  const photoInputRef = useRef(null);
  const [barcode, setBarcode] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState(null); // { type, message, item, upc }
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState([]);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);
  const scannerDivId = "qr-reader";

  const [expDate, setExpDate] = useState("");

  // Photo state for unprocessed items
  const [photos, setPhotos] = useState([]); // [{ file, preview }]
  const [notes, setNotes] = useState("");

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1";

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        scannerRef.current.clear();
        scannerRef.current = null;
      }).catch(() => {});
    }
    setScanning(false);
  }, []);

  useEffect(() => () => { if (scannerRef.current) scannerRef.current.stop().catch(() => {}); }, []);

  const resetForm = useCallback(() => {
    setBarcode("");
    setLocation("");
    setExpDate("");
    setStatus(null);
    setPhotos([]);
    setNotes("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }, []);

  // ─── Barcode lookup ───
  const handleBarcodeScan = async (upcOverride) => {
    const upc = (upcOverride || barcode).trim();
    if (!upc) return;
    setStatus({ type: "checking", message: "Looking up..." });

    // Check our system
    const existing = await checkBarcodeInSystem(upc);
    if (existing.length > 0) {
      const item = existing[0];
      setStatus({ type: "found", message: item.name, item, upc });
      setTimeout(() => locationRef.current?.querySelector("input")?.focus(), 100);
      return;
    }

    // Check StoreLIVE
    const posbe = await lookupBarcode(upc);
    if (posbe) {
      try {
        const [newItem] = await qry("local_items", {
          insert: {
            upc, name: posbe.name, size: posbe.size || null,
            mfg_id: posbe.mfg_id ? parseInt(posbe.mfg_id) : null,
            retail_price: posbe.price ? parseFloat(posbe.price) : null,
            dept_id: posbe.dept_id ? parseInt(posbe.dept_id) : null,
            category_id: posbe.category_id ? parseInt(posbe.category_id) : null,
            sub_category_id: posbe.sub_category_id ? parseInt(posbe.sub_category_id) : null,
            ref_unit_cd: posbe.unit_cd ? parseInt(posbe.unit_cd) : null,
            from_posbe: true, posbe_item_id: posbe.item_id,
            sync_status: "local", created_by: "QuickAdd", active_yn: "Y",
            cases_on_hand: 0,
          },
        });
        setStatus({ type: "created", message: `${posbe.name} (from StoreLIVE)`, item: { ...newItem, name: posbe.name }, upc });
        setTimeout(() => locationRef.current?.querySelector("input")?.focus(), 100);
      } catch (err) {
        setStatus({ type: "error", message: `Error creating item: ${err.message}` });
      }
      return;
    }

    // Not found — switch to photo capture mode
    setStatus({ type: "notfound", message: `Not found in system or StoreLIVE`, upc });
  };

  // ─── Assign location (found/created items) ───
  const assignLocation = async () => {
    if (!location || !status?.item) return;
    setSaving(true);
    try {
      const itemId = status.item.id;
      const existingLocs = await qry("local_item_locations", {
        select: "id", filters: `local_item_id=eq.${itemId}`, limit: 1,
      });
      const isFirst = !existingLocs.length;
      try { await addItemLocation(itemId, location, isFirst); } catch { /* dup */ }
      const itemUpdate = {};
      if (isFirst) itemUpdate.warehouse_location = location;
      if (expDate) itemUpdate.expiration_date = expDate;

      // Upload and save photos
      if (photos.length > 0) {
        const photoUrls = [];
        for (const p of photos) {
          const url = await uploadPhoto(p.file, status.upc);
          photoUrls.push(url);
        }
        // Merge with any existing photos
        try {
          const [existing] = await qry("local_items", { select: "photos", filters: `id=eq.${itemId}`, limit: 1 });
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
      setLog(prev => [{ name: status.item.name, upc: status.upc, location, type: "assigned", time: new Date() }, ...prev].slice(0, 50));
      resetForm();
    } catch (err) {
      setStatus({ ...status, type: "error", message: `Error: ${err.message}` });
    }
    setSaving(false);
  };

  // ─── Save unprocessed item (not found) ───
  const saveUnprocessed = async () => {
    if (!status?.upc) return;
    setSaving(true);
    try {
      // Upload photos
      const photoUrls = [];
      for (const p of photos) {
        const url = await uploadPhoto(p.file, status.upc);
        photoUrls.push(url);
      }

      await qry("unprocessed_items", {
        insert: {
          upc: status.upc,
          warehouse_location: location || null,
          expiration_date: expDate || null,
          photos: photoUrls,
          notes: notes.trim() || null,
        },
      });

      setLog(prev => [{ name: `UPC: ${status.upc}`, upc: status.upc, location: location || "—", type: "unprocessed", photos: photoUrls.length, time: new Date() }, ...prev].slice(0, 50));
      resetForm();
    } catch (err) {
      setStatus({ ...status, type: "error", message: `Error: ${err.message}` });
    }
    setSaving(false);
  };

  // ─── Photo handling ───
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

  // ─── Camera scanner ───
  const startScanner = useCallback(() => {
    setScanning(true);
    setTimeout(() => {
      const html5QrCode = new Html5Qrcode(scannerDivId);
      scannerRef.current = html5QrCode;
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 150 }, aspectRatio: 1.5 },
        (decodedText) => {
          stopScanner();
          setBarcode(decodedText);
          handleBarcodeScan(decodedText);
        },
      ).catch((err) => {
        console.error("Camera error:", err);
        setScanning(false);
      });
    }, 100);
  }, [stopScanner]);

  const handleBarcodeKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleBarcodeScan(); }
  };

  const statusColors = {
    found: "bg-green-50 text-green-800 border-green-200",
    created: "bg-blue-50 text-blue-800 border-blue-200",
    notfound: "bg-amber-50 text-amber-800 border-amber-200",
    error: "bg-red-50 text-red-800 border-red-200",
    checking: "bg-stone-50 text-stone-500 border-stone-200",
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <h2 className="text-lg font-bold text-stone-800">Quick Add — Scan & Assign Locations</h2>
        <p className="text-xs text-stone-400 mt-0.5">Scan barcode, assign location. Unknown items are saved with photos for later processing.</p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-xl mx-auto p-6 space-y-4">

          {/* ─── BARCODE ─── */}
          <div>
            <label className={lc}>Scan Barcode</label>
            <div className="flex gap-2">
              <input ref={barcodeRef} className={`${ic} flex-1 text-lg font-mono tracking-wider`}
                value={barcode} onChange={e => setBarcode(e.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                placeholder="Scan or type barcode, press Enter..." autoFocus />
              <button onClick={scanning ? stopScanner : startScanner}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${scanning ? "bg-red-500 text-white hover:bg-red-600" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}>
                {scanning ? "Stop" : "Camera"}
              </button>
            </div>
            {scanning && (
              <div className="mt-2 rounded-lg overflow-hidden border border-stone-200">
                <div id={scannerDivId} />
              </div>
            )}
          </div>

          {/* ─── STATUS ─── */}
          {status && (
            <div className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${statusColors[status.type] || ""}`}>
              {status.type === "found" && "In system: "}
              {status.type === "created" && "Created: "}
              {status.type === "notfound" && "Unknown item — "}
              {status.type === "checking" && "Looking up... "}
              {status.message}
            </div>
          )}

          {/* ─── FOUND / CREATED: assign location ─── */}
          {status && (status.type === "found" || status.type === "created") && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lc}>Expiration Date</label>
                  <input type="date" className={ic} value={expDate} onChange={e => setExpDate(e.target.value)} />
                </div>
                <div>
                  <label className={lc}>Assign Location</label>
                  <div ref={locationRef}>
                    <SearchSelect value={location} displayValue={location}
                      fetchOptions={searchLocations}
                      onSelect={(v) => setLocation(v || "")}
                      placeholder="Type or select location..." />
                  </div>
                </div>
              </div>
              {/* Photos */}
              <div>
                <label className={lc}>Product Photos</label>
                <div className="flex gap-2 flex-wrap">
                  {photos.map((p, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stone-200">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removePhoto(i)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white rounded-full text-[10px] flex items-center justify-center hover:bg-red-600">
                        x
                      </button>
                    </div>
                  ))}
                  <button onClick={() => photoInputRef.current?.click()}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-400 hover:border-stone-400 hover:text-stone-500 transition-colors">
                    <span className="text-xl leading-none">+</span>
                    <span className="text-[9px] mt-0.5">Photo</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={assignLocation} disabled={saving || !location}
                  className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  {saving ? "Saving..." : "Save"}
                </button>
                <button onClick={resetForm} className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700">Cancel</button>
              </div>
            </div>
          )}

          {/* ─── NOT FOUND: photo capture + location + save ─── */}
          {status?.type === "notfound" && (
            <div className="space-y-3 bg-amber-50/50 border border-amber-200 rounded-xl p-4">
              <div className="text-sm font-bold text-amber-800">Take photos and assign a location</div>
              <p className="text-xs text-amber-600">This item will be saved for later processing. Take photos of the product so it can be added to the system remotely.</p>

              {/* Photos */}
              <div>
                <label className={lc}>Product Photos</label>
                <div className="flex gap-2 flex-wrap">
                  {photos.map((p, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-stone-200">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => removePhoto(i)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">
                        x
                      </button>
                    </div>
                  ))}
                  <button onClick={() => photoInputRef.current?.click()}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-amber-300 flex flex-col items-center justify-center text-amber-500 hover:border-amber-400 hover:text-amber-600 transition-colors">
                    <span className="text-2xl leading-none">+</span>
                    <span className="text-[10px] mt-0.5">Photo</span>
                  </button>
                </div>
                <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple
                  className="hidden" onChange={handlePhotoCapture} />
              </div>

              {/* Exp Date + Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lc}>Expiration Date</label>
                  <input type="date" className={ic} value={expDate} onChange={e => setExpDate(e.target.value)} />
                </div>
                <div>
                  <label className={lc}>Location</label>
                  <SearchSelect value={location} displayValue={location}
                    fetchOptions={searchLocations}
                    onSelect={(v) => setLocation(v || "")}
                    placeholder="Type or select location..." />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={lc}>Notes</label>
                <input className={ic} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Optional — product name, size, anything helpful..." />
              </div>

              {/* Save */}
              <div className="flex gap-2 pt-1">
                <button onClick={saveUnprocessed} disabled={saving || photos.length === 0}
                  className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                  {saving ? "Saving..." : "Save for Later"}
                </button>
                <button onClick={resetForm} className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700">Skip</button>
              </div>
            </div>
          )}

          {/* ─── ACTIVITY LOG ─── */}
          {log.length > 0 && (
            <div className="mt-6">
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wide mb-2">Recent ({log.length})</div>
              <div className="space-y-1">
                {log.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-stone-50 rounded text-xs">
                    <div className="truncate flex-1">
                      <span className="font-medium text-stone-700">{entry.name}</span>
                      {entry.type === "unprocessed" && (
                        <span className="ml-1.5 text-amber-600 font-medium">{entry.photos} photo{entry.photos !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <span className="text-amber-700 font-bold font-mono ml-3">{entry.location}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
