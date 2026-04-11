import { useState, useEffect, useCallback, useRef } from "react";
import { qry, searchVendors, searchDepts, searchCategories, searchSubCategories, searchUnits, searchLocations, addItemLocation } from "../lib/hooks";
import SearchSelect from "./SearchSelect";

export default function UnprocessedItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { photos, idx }
  const [leftWidth, setLeftWidth] = useState(340);
  const dragging = useRef(false);
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(null); // { startX, startY, origX, origY }

  // Reset zoom/pan when changing photo or closing
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [lightbox?.idx, lightbox?.photos]);

  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1";

  const emptyForm = () => ({
    name: "", mfg_id: "", mfg_name: "", size: "", unit_cd: "", unit_name: "",
    dept_id: "", dept_name: "", category_id: "", category_name: "",
    sub_category_id: "", sub_category_name: "", retail_price: "",
    case_cost: "", case_size: "", expiration_date: "", warehouse_location: "",
    notes: "",
  });

  const [f, setF] = useState(emptyForm());
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    qry("unprocessed_items", {
      select: "*",
      filters: "status=eq.pending",
      order: "created_at.desc",
      limit: 500,
    }).then(data => {
      setItems(data);
      setCurrentIdx(0);
      if (data.length > 0) resetFormForItem(data[0]);
      else setF(emptyForm());
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetFormForItem = (item) => {
    setF({
      ...emptyForm(),
      warehouse_location: item?.warehouse_location || "",
      expiration_date: item?.expiration_date ? new Date(item.expiration_date).toISOString().slice(0, 10) : "",
      case_size: item?.case_size || "",
      notes: item?.notes || "",
    });
  };

  const current = items[currentIdx] || null;
  const photos = current?.photos || [];

  const goTo = (idx) => {
    if (idx >= 0 && idx < items.length) {
      setCurrentIdx(idx);
      resetFormForItem(items[idx]);
    }
  };

  // ─── Add item to system and mark processed ───
  const addItem = async () => {
    if (!current || !f.name.trim()) return;
    setSaving(true);
    try {
      // Create the local item
      const unitCost = f.case_cost && f.case_size
        ? parseFloat((parseFloat(f.case_cost) / parseInt(f.case_size)).toFixed(2)) : null;
      // Copy photos from unprocessed item
      const itemPhotos = current.photos || [];
      const [newItem] = await qry("local_items", {
        insert: {
          upc: current.upc,
          name: f.name.trim(),
          mfg_id: f.mfg_id ? parseInt(f.mfg_id) : null,
          size: f.size.trim() || null,
          ref_unit_cd: f.unit_cd ? parseInt(f.unit_cd) : null,
          dept_id: f.dept_id ? parseInt(f.dept_id) : null,
          category_id: f.category_id ? parseInt(f.category_id) : null,
          sub_category_id: f.sub_category_id ? parseInt(f.sub_category_id) : null,
          retail_price: f.retail_price ? parseFloat(f.retail_price) : null,
          cost: unitCost,
          case_size: f.case_size ? parseInt(f.case_size) : null,
          expiration_date: f.expiration_date || null,
          warehouse_location: f.warehouse_location.trim() || null,
          notes: f.notes.trim() || null,
          photos: itemPhotos,
          default_photo: itemPhotos[0] || null,
          sync_status: "local",
          created_by: "Unprocessed",
          active_yn: "Y",
          cases_on_hand: 0,
        },
      });

      // Add location mapping if provided
      if (f.warehouse_location.trim() && newItem?.id) {
        try { await addItemLocation(newItem.id, f.warehouse_location.trim(), true); } catch {}
      }

      // Mark unprocessed item as processed
      await qry("unprocessed_items", {
        update: { status: "processed", processed_at: new Date().toISOString() },
        match: { id: current.id },
      });

      // Remove from list and advance
      const newItems = items.filter((_, i) => i !== currentIdx);
      setItems(newItems);
      const nextIdx = Math.min(currentIdx, newItems.length - 1);
      setCurrentIdx(Math.max(0, nextIdx));
      if (newItems.length > 0) resetFormForItem(newItems[Math.max(0, nextIdx)]);
      else setF(emptyForm());
    } catch (err) {
      alert("Error: " + err.message);
    }
    setSaving(false);
  };

  const skipItem = async () => {
    if (!current) return;
    await qry("unprocessed_items", {
      update: { status: "skipped", processed_at: new Date().toISOString() },
      match: { id: current.id },
    });
    const newItems = items.filter((_, i) => i !== currentIdx);
    setItems(newItems);
    const nextIdx = Math.min(currentIdx, newItems.length - 1);
    setCurrentIdx(Math.max(0, nextIdx));
    if (newItems.length > 0) resetFormForItem(newItems[Math.max(0, nextIdx)]);
    else setF(emptyForm());
  };

  const deleteItem = async () => {
    if (!current || !confirm("Delete this unprocessed item?")) return;
    await qry("unprocessed_items", { del: true, match: { id: current.id } });
    const newItems = items.filter((_, i) => i !== currentIdx);
    setItems(newItems);
    const nextIdx = Math.min(currentIdx, newItems.length - 1);
    setCurrentIdx(Math.max(0, nextIdx));
    if (newItems.length > 0) resetFormForItem(newItems[Math.max(0, nextIdx)]);
    else setF(emptyForm());
  };

  if (loading) return <div className="p-8 text-center text-stone-400">Loading...</div>;
  if (items.length === 0) return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <h2 className="text-lg font-bold text-stone-800">Unprocessed Items</h2>
      </div>
      <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">No pending items to process</div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-800">Process Unprocessed Items</h2>
          <p className="text-xs text-stone-400">{items.length} pending — Item {currentIdx + 1} of {items.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
            className="px-3 py-1.5 bg-stone-200 text-stone-600 rounded-lg text-sm font-medium hover:bg-stone-300 disabled:opacity-30">Prev</button>
          <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx >= items.length - 1}
            className="px-3 py-1.5 bg-stone-200 text-stone-600 rounded-lg text-sm font-medium hover:bg-stone-300 disabled:opacity-30">Next</button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 overflow-hidden" ref={containerRef}
        onMouseMove={e => {
          if (!dragging.current || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const newW = Math.max(250, Math.min(e.clientX - rect.left, rect.width - 400));
          setLeftWidth(newW);
        }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}>
        <div className="flex h-full" style={dragging.current ? { userSelect: "none" } : undefined}>
          {/* ─── LEFT: Captured data & photos ─── */}
          <div style={{ width: leftWidth }} className="shrink-0 bg-stone-50 overflow-auto p-4 space-y-4">
            {/* Info */}
            <div>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Captured Info</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">UPC</span>
                  <span className="font-mono font-bold text-stone-800">{current.upc}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Location</span>
                  <span className="font-bold text-amber-700">{current.warehouse_location || "—"}</span>
                </div>
                {current.case_size && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Units/Case</span>
                    <span className="text-stone-700">{current.case_size}</span>
                  </div>
                )}
                {current.expiration_date && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Exp Date</span>
                    <span className="text-stone-700">{new Date(current.expiration_date).toLocaleDateString()}</span>
                  </div>
                )}
                {current.notes && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Notes</span>
                    <span className="text-stone-700 text-right max-w-[180px]">{current.notes}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-stone-500">Scanned</span>
                  <span className="text-stone-500">{new Date(current.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Photos */}
            <div>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">
                Photos ({photos.length})
              </div>
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((url, i) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden border border-stone-200 cursor-pointer hover:border-amber-400 transition-colors"
                      onClick={() => setLightbox({ photos, idx: i })}>
                      <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-stone-400 italic">No photos captured</div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-2 border-t border-stone-200 space-y-2">
              <button onClick={skipItem}
                className="w-full px-3 py-1.5 bg-stone-200 text-stone-600 rounded-lg text-xs font-medium hover:bg-stone-300">
                Skip This Item
              </button>
              <button onClick={deleteItem}
                className="w-full px-3 py-1.5 text-red-500 hover:text-red-700 text-xs font-medium">
                Delete
              </button>
            </div>
          </div>

          {/* ─── Drag handle ─── */}
          <div className="w-1.5 shrink-0 bg-stone-200 hover:bg-amber-400 cursor-col-resize transition-colors relative group"
            onMouseDown={e => { e.preventDefault(); dragging.current = true; }}>
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-stone-400 group-hover:bg-amber-600 transition-colors" />
          </div>

          {/* ─── RIGHT: Item entry form ─── */}
          <div className="flex-1 overflow-auto p-5 space-y-4">
            <div className="text-[10px] font-bold text-white uppercase tracking-wider -mx-5 -mt-5 px-5 py-1.5 bg-stone-600 mb-4">
              Add Item to System
            </div>

            {/* Mfg + Item Name */}
            <div className="grid grid-cols-[200px_1fr] gap-3">
              <div>
                <label className={lc}>Manufacturer</label>
                <SearchSelect value={f.mfg_id} displayValue={f.mfg_name} fetchOptions={searchVendors}
                  onSelect={(v, l) => { set("mfg_id", v || ""); set("mfg_name", l || ""); }} placeholder="Search..." autoFocus />
              </div>
              <div><label className={lc}>Item Description *</label><input className={ic} value={f.name} onChange={e => set("name", e.target.value)} placeholder="Product name..." /></div>
            </div>

            {/* Size + Unit + Exp */}
            <div className="flex gap-3">
              <div className="w-[80px]"><label className={lc}>Size</label><input className={ic} value={f.size} onChange={e => set("size", e.target.value)} placeholder="e.g., 17" /></div>
              <div className="w-[120px]">
                <label className={lc}>Unit</label>
                <SearchSelect value={f.unit_cd} displayValue={f.unit_name} fetchOptions={searchUnits}
                  onSelect={(v, l) => { set("unit_cd", v || ""); set("unit_name", l || ""); }} placeholder="Search..." />
              </div>
              <div className="w-[170px] shrink-0"><label className={lc}>Expiration Date</label><input type="date" className={ic} value={f.expiration_date} onChange={e => set("expiration_date", e.target.value)} /></div>
              <div className="flex-1" />
            </div>

            {/* Dept + Category + SubCategory */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lc}>Department</label>
                <SearchSelect value={f.dept_id} displayValue={f.dept_name} fetchOptions={searchDepts}
                  onSelect={(v, l) => { set("dept_id", v || ""); set("dept_name", l || ""); }} placeholder="Search..." />
              </div>
              <div>
                <label className={lc}>Category</label>
                <SearchSelect value={f.category_id} displayValue={f.category_name} fetchOptions={searchCategories}
                  onSelect={(v, l) => { set("category_id", v || ""); set("category_name", l || ""); }} placeholder="Search..." />
              </div>
              <div>
                <label className={lc}>Sub-Category</label>
                <SearchSelect value={f.sub_category_id} displayValue={f.sub_category_name} fetchOptions={searchSubCategories}
                  onSelect={(v, l) => { set("sub_category_id", v || ""); set("sub_category_name", l || ""); }} placeholder="Search..." />
              </div>
            </div>

            {/* Pricing: Price, Cost/Case, Units/Case + calculated Unit Cost */}
            <div className="grid grid-cols-4 gap-3">
              <div><label className={lc}>Retail Price</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                  <input type="number" step="0.01" className={`${ic} pl-7`} value={f.retail_price} onChange={e => set("retail_price", e.target.value)} placeholder="0.00" /></div></div>
              <div><label className={lc}>Cost / Case</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                  <input type="number" step="0.01" className={`${ic} pl-7`} value={f.case_cost} onChange={e => set("case_cost", e.target.value)} placeholder="0.00" /></div></div>
              <div><label className={lc}>Units / Case</label><input type="number" className={ic} value={f.case_size} onChange={e => set("case_size", e.target.value)} placeholder="12" /></div>
              <div><label className={lc}>Unit Cost</label>
                <div className="px-3 py-2 text-sm text-stone-600 font-medium">
                  {f.case_cost && f.case_size ? `$${(parseFloat(f.case_cost) / parseInt(f.case_size)).toFixed(2)}` : "—"}
                </div></div>
            </div>

            {/* WH Location + Notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lc}>WH Location</label>
                <SearchSelect value={f.warehouse_location} displayValue={f.warehouse_location} fetchOptions={searchLocations}
                  onSelect={(v) => set("warehouse_location", v || "")} placeholder="Search..." />
              </div>
              <div><label className={lc}>Notes</label><input className={ic} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional..." /></div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-3 border-t border-stone-200">
              <button onClick={addItem} disabled={saving || !f.name.trim()}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                {saving ? "Adding..." : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Photo Panel (sized to left panel) ─── */}
      {lightbox && (
        <div className="fixed top-0 bottom-0 z-[90] bg-stone-900 shadow-2xl flex flex-col" style={{ left: 0, width: leftWidth }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-stone-800">
            <span className="text-white/70 text-sm">{lightbox.idx + 1} / {lightbox.photos.length}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom(z => Math.max(1, z - 0.5))}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-sm font-bold">−</button>
              <span className="text-white/70 text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(8, z + 0.5))}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-sm font-bold">+</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="px-2 h-7 bg-white/10 hover:bg-white/20 rounded text-white text-[10px] font-medium">Reset</button>
              <button onClick={() => setLightbox(null)}
                className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-sm ml-1">
                ×
              </button>
            </div>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-4 relative min-h-0 overflow-hidden"
            onWheel={e => {
              e.preventDefault();
              setZoom(z => Math.max(1, Math.min(8, z + (e.deltaY < 0 ? 0.25 : -0.25))));
            }}
            onMouseDown={e => {
              if (zoom <= 1) return;
              panning.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
            }}
            onMouseMove={e => {
              if (!panning.current) return;
              setPan({
                x: panning.current.origX + (e.clientX - panning.current.startX),
                y: panning.current.origY + (e.clientY - panning.current.startY),
              });
            }}
            onMouseUp={() => { panning.current = null; }}
            onMouseLeave={() => { panning.current = null; }}
            style={{ cursor: zoom > 1 ? (panning.current ? "grabbing" : "grab") : "default" }}>
            <img src={lightbox.photos[lightbox.idx]} alt=""
              draggable={false}
              className="max-w-full max-h-full object-contain rounded select-none pointer-events-none"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: panning.current ? "none" : "transform 0.1s" }} />

            {lightbox.idx > 0 && zoom === 1 && (
              <button onClick={() => setLightbox({ ...lightbox, idx: lightbox.idx - 1 })}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-lg font-bold">
                ‹
              </button>
            )}
            {lightbox.idx < lightbox.photos.length - 1 && zoom === 1 && (
              <button onClick={() => setLightbox({ ...lightbox, idx: lightbox.idx + 1 })}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-lg font-bold">
                ›
              </button>
            )}
          </div>

          {/* Thumbnail strip */}
          {lightbox.photos.length > 1 && (
            <div className="flex gap-1.5 px-4 py-2 bg-stone-800 overflow-x-auto">
              {lightbox.photos.map((url, i) => (
                <div key={i} onClick={() => setLightbox({ ...lightbox, idx: i })}
                  className={`w-12 h-12 shrink-0 rounded overflow-hidden cursor-pointer border-2 transition-colors ${i === lightbox.idx ? "border-amber-500" : "border-transparent opacity-60 hover:opacity-100"}`}>
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
