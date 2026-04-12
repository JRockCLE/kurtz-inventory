import { useState, useEffect, useRef, useCallback } from "react";
import { qry, lookupBarcode, checkBarcodeInSystem, searchVendors, searchLocations, searchUnits, searchDepts, searchCategories, searchSubCategories, addItemLocation } from "../lib/hooks";
import { fmt$ } from "../lib/helpers";
import SearchSelect from "./SearchSelect";
import { Html5Qrcode } from "html5-qrcode";

// ─── Supplier search ───
async function searchSuppliers(typed) {
  if (!typed || typed.length < 1) return [];
  const data = await qry("suppliers", {
    select: "id,name", filters: `name=ilike.*${typed}*&active_yn=eq.Y`, order: "name.asc", limit: 15,
  });
  return data.map(s => ({ value: s.id, label: s.name }));
}

// ─── Empty form state ───
const emptyForm = () => ({
  mfg_id: "", mfg_name: "", name: "", size: "", unit: "", unit_cd: "", retail_price: "",
  dept_id: "", dept_name: "", category_id: "", category_name: "",
  sub_category_id: "", sub_category_name: "",
  expiration_date: "", cases_received: "1", cost_per_case: "",
  case_size: "", warehouse_location: "",
  // internal tracking
  upc: "", from_posbe: false, posbe_item_id: null, local_item_id: null,
  _status: "idle", // idle, checking, choose, found, exists, new
  _existingItems: [], // populated when UPC matches existing items
  _editing: false, // toggle edit mode for existing items
  _no_exp: false, // user explicitly marked no expiration date
});

// ─── Inline-editable Line Item ───
function LineItem({ item, isDraft, onUpdate, onRemove }) {
  const [exp, setExp] = useState(item.expiration_date ? item.expiration_date.slice(0, 10) : "");
  const [cases, setCases] = useState(String(item.cases_received || ""));
  const [costCase, setCostCase] = useState(item.cost_per_case != null ? parseFloat(item.cost_per_case).toFixed(2) : "");
  const [caseSize, setCaseSize] = useState(item.case_size != null ? String(item.case_size) : "");
  const [loc, setLoc] = useState(item.warehouse_location || "");

  const costUnit = (costCase && caseSize && parseFloat(caseSize) > 0)
    ? (parseFloat(costCase) / parseFloat(caseSize)).toFixed(2)
    : (item.cost_per_unit || "");

  const save = async (field, value) => {
    const updates = {};
    if (field === "expiration_date") updates.expiration_date = value || null;
    else if (field === "cases_received") updates.cases_received = parseInt(value) || 1;
    else if (field === "cost_per_case") {
      updates.cost_per_case = value ? parseFloat(value) : null;
      const cs = parseInt(caseSize) || item.case_size;
      if (updates.cost_per_case && cs) updates.cost_per_unit = updates.cost_per_case / cs;
    }
    else if (field === "case_size") {
      updates.case_size = value ? parseInt(value) : null;
      const cc = parseFloat(costCase) || item.cost_per_case;
      if (cc && updates.case_size) updates.cost_per_unit = cc / updates.case_size;
    }
    else if (field === "warehouse_location") updates.warehouse_location = value || null;

    await qry("receiving_document_items", { update: updates, match: { id: item.id } });

    // Also update the local_item if we have one
    if (item.local_item_id) {
      const localUpdates = {};
      if (field === "warehouse_location") localUpdates.warehouse_location = value || null;
      if (field === "expiration_date") localUpdates.expiration_date = value || null;
      if (field === "cases_received") localUpdates.cases_on_hand = parseInt(value) || 1;
      if (field === "case_size") localUpdates.case_size = value ? parseInt(value) : null;
      if (field === "cost_per_case" && updates.cost_per_unit) localUpdates.cost = updates.cost_per_unit;
      if (Object.keys(localUpdates).length > 0) {
        localUpdates.updated_at = new Date().toISOString();
        await qry("local_items", { update: localUpdates, match: { id: item.local_item_id } });
      }
    }

    onUpdate();
  };

  const inlineIc = "w-full px-1.5 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-center bg-white";

  return (
    <div className="grid grid-cols-[1fr_110px_55px_75px_75px_55px_80px_24px] px-4 py-2 text-sm items-center gap-1">
      <div className="min-w-0">
        <div className="font-medium text-stone-800 truncate">{item.item_name}</div>
        <div className="text-[10px] text-stone-400 truncate">
          {[item.upc, item.size].filter(Boolean).join(" • ")}
          {item.from_posbe && <span className="ml-1 text-green-500 font-bold">●</span>}
        </div>
      </div>
      {isDraft ? (
        <>
          <input type="date" className={`${inlineIc} text-[10px]`} value={exp}
            onChange={e => setExp(e.target.value)} onBlur={() => save("expiration_date", exp)} />
          <input type="number" className={inlineIc} value={cases} min={1}
            onChange={e => setCases(e.target.value)} onBlur={() => save("cases_received", cases)} />
          <div className="relative">
            <span className="absolute left-1 top-1/2 -translate-y-1/2 text-stone-400 text-[10px]">$</span>
            <input type="number" step="0.01" className={`${inlineIc} pl-3`} value={costCase}
              onChange={e => setCostCase(e.target.value)} onBlur={() => { if (costCase) setCostCase(parseFloat(costCase).toFixed(2)); save("cost_per_case", costCase); }} placeholder="—" />
          </div>
          <div className="text-center text-[11px] text-stone-500 tabular-nums">
            {costUnit ? `$${parseFloat(costUnit).toFixed(2)}` : "—"}
          </div>
          <input type="number" className={inlineIc} value={caseSize}
            onChange={e => setCaseSize(e.target.value)} onBlur={() => save("case_size", caseSize)} placeholder="—" />
          <input className={`${inlineIc} text-amber-700 font-medium`} value={loc}
            onChange={e => setLoc(e.target.value)} onBlur={() => save("warehouse_location", loc)} placeholder="—" />
          <button onClick={onRemove} className="text-stone-300 hover:text-red-500 text-xs text-center">✕</button>
        </>
      ) : (
        <>
          <div className="text-center text-[11px] text-stone-500">{exp || "—"}</div>
          <div className="text-center text-xs font-bold text-stone-700">{item.cases_received}</div>
          <div className="text-center text-xs text-stone-500">{item.cost_per_case ? fmt$(item.cost_per_case) : "—"}</div>
          <div className="text-center text-xs text-stone-500">{costUnit ? `$${parseFloat(costUnit).toFixed(2)}` : "—"}</div>
          <div className="text-center text-xs text-stone-500">{item.case_size || "—"}</div>
          <div className="text-center text-xs text-amber-700 font-medium">{item.warehouse_location || "—"}</div>
          <div></div>
        </>
      )}
    </div>
  );
}

export default function ReceivingDoc({ docId, onBack, onUpdate }) {
  const barcodeRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);
  const scannerDivId = "recv-qr-reader";

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
  const casesRef = useRef(null);
  const ic = "w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
  const lc = "block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1";

  const [doc, setDoc] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [barcode, setBarcode] = useState("");
  const [f, setF] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  // Quick-add location
  const [showNewLoc, setShowNewLoc] = useState(false);
  const [newLocSec, setNewLocSec] = useState("");
  const [newLocRow, setNewLocRow] = useState("");
  const [newLocSlot, setNewLocSlot] = useState("");
  const [newLocWhSection, setNewLocWhSection] = useState("");
  const [newLocAisle, setNewLocAisle] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);

  const newLocLabel = newLocSec && newLocRow
    ? `${newLocSec}${newLocRow.toUpperCase()}${newLocSlot ? `-${newLocSlot}` : ""}`
    : "";

  const addNewLocation = async () => {
    if (!newLocLabel) return;
    setSavingLoc(true);
    try {
      await qry("warehouse_locations", {
        insert: {
          column_num: parseInt(newLocSec),
          row_letter: newLocRow.toUpperCase().trim(),
          slot_num: newLocSlot ? parseInt(newLocSlot) : null,
          section: newLocWhSection.trim() || null,
          aisle: newLocAisle.trim() || null,
        },
      });
      set("warehouse_location", newLocLabel);
      setNewLocSec(""); setNewLocRow(""); setNewLocSlot(""); setNewLocWhSection(""); setNewLocAisle(""); setShowNewLoc(false);
    } catch (err) { alert("Error: " + err.message); }
    setSavingLoc(false);
  };

  const resetNewLoc = () => {
    setShowNewLoc(false); setNewLocSec(""); setNewLocRow(""); setNewLocSlot(""); setNewLocWhSection(""); setNewLocAisle("");
  };

  // Supplier (new doc)
  const [supplierId, setSupplierId] = useState(null);
  const [supplierName, setSupplierName] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);

  const isNew = docId === "new";
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Load doc
  const loadDoc = useCallback(async () => {
    if (isNew) { setLoading(false); return; }
    setLoading(true);
    try {
      const [d] = await qry("receiving_documents", { select: "*", filters: `id=eq.${docId}` });
      setDoc(d);
      setSupplierId(d.supplier_id);
      setSupplierName(d.supplier_name || "");
      const items = await qry("receiving_document_items", {
        select: "*", filters: `receiving_doc_id=eq.${docId}`, order: "created_at.asc",
      });
      setLineItems(items);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [docId, isNew]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  // Create doc
  const createDoc = async () => {
    let sid = supplierId;
    let sname = supplierName;
    if (showNewSupplier && newSupplierName.trim()) {
      const [newSup] = await qry("suppliers", { insert: { name: newSupplierName.trim() } });
      sid = newSup.id; sname = newSup.name;
    }
    if (!sname) { alert("Please select or enter a supplier"); return; }
    const [newDoc] = await qry("receiving_documents", {
      insert: { supplier_id: sid, supplier_name: sname, status: "draft" },
    });
    setDoc(newDoc); setSupplierId(sid); setSupplierName(sname);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  // ─── Barcode scan + auto-lookup ───
  const handleBarcodeScan = async (upc) => {
    if (!upc || upc.length < 3) return;
    set("_status", "checking");

    // Check our system first — returns ALL matching items
    const existing = await checkBarcodeInSystem(upc);
    if (existing.length > 0) {
      // Show choice UI: add to existing or create new entry
      setF({ ...emptyForm(), upc, _status: "choose", _existingItems: existing });
      return;
    }

    // Check StoreLIVE
    const posbe = await lookupBarcode(upc);
    if (posbe) {
      setF({
        ...emptyForm(),
        upc, _status: "found", from_posbe: true, posbe_item_id: posbe.item_id,
        name: posbe.name || "", size: posbe.size || "",
        unit: posbe.unit_name || "", unit_cd: posbe.unit_cd || "",
        mfg_id: posbe.mfg_id || "", mfg_name: posbe.mfg_name || "",
        dept_id: posbe.dept_id || "", dept_name: posbe.dept_name || "",
        category_id: posbe.category_id || "", category_name: posbe.category_name || "",
        sub_category_id: posbe.sub_category_id || "", sub_category_name: posbe.sub_category_name || "",
        retail_price: posbe.price ? parseFloat(posbe.price).toFixed(2) : "",
        cases_received: "1",
      });
      return;
    }

    // Not found anywhere
    setF({ ...emptyForm(), upc, _status: "new", cases_received: "1" });
  };

  // User chose to add to an existing item
  const chooseExisting = (item) => {
    const primaryLoc = item._locations?.find(l => l.is_primary)?.location || item.warehouse_location || "";
    // cost on local_items is cost per UNIT — derive cost/case from it
    const costPerUnit = item.cost ? parseFloat(item.cost) : null;
    const caseSize = item.case_size ? parseInt(item.case_size) : null;
    const costPerCase = (costPerUnit && caseSize) ? (costPerUnit * caseSize) : null;
    setF({
      ...emptyForm(),
      upc: f.upc, _status: "exists", local_item_id: item.id,
      name: item.name || "", size: item.size || "",
      mfg_id: item.mfg_id || "", mfg_name: item._mfg_name || "",
      dept_id: item.dept_id || "", dept_name: item._dept_name || "",
      category_id: item.category_id || "", category_name: item._category_name || "",
      sub_category_id: item.sub_category_id || "", sub_category_name: item._sub_category_name || "",
      retail_price: item.retail_price ? parseFloat(item.retail_price).toFixed(2) : "",
      warehouse_location: primaryLoc,
      case_size: caseSize ? String(caseSize) : "",
      cost_per_case: costPerCase ? costPerCase.toFixed(2) : "",
      cases_received: "1",
    });
  };

  // User chose to create a new entry (same UPC, different lot)
  const chooseNewEntry = () => {
    // Pre-fill from the first existing item's product info
    const ref = f._existingItems[0];
    const costPerUnit = ref?.cost ? parseFloat(ref.cost) : null;
    const caseSize = ref?.case_size ? parseInt(ref.case_size) : null;
    const costPerCase = (costPerUnit && caseSize) ? (costPerUnit * caseSize) : null;
    setF({
      ...emptyForm(),
      upc: f.upc, _status: "new",
      name: ref?.name || "", size: ref?.size || "",
      mfg_id: ref?.mfg_id || "", mfg_name: ref?._mfg_name || "",
      dept_id: ref?.dept_id || "", dept_name: ref?._dept_name || "",
      category_id: ref?.category_id || "", category_name: ref?._category_name || "",
      sub_category_id: ref?.sub_category_id || "", sub_category_name: ref?._sub_category_name || "",
      retail_price: ref?.retail_price ? parseFloat(ref.retail_price).toFixed(2) : "",
      case_size: caseSize ? String(caseSize) : "",
      cost_per_case: costPerCase ? costPerCase.toFixed(2) : "",
      cases_received: "1",
    });
  };

  const handleBarcodeChange = (e) => {
    setBarcode(e.target.value);
    // Reset form if user clears barcode
    if (!e.target.value) setF(emptyForm());
  };

  const handleBarcodeKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBarcodeScan(barcode);
    }
  };

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

  // ─── Add item ───
  const addItem = async () => {
    if (!f.name?.trim()) return;
    if (f._status !== "exists" && f._status !== "found") {
      if (!f.unit_cd) { alert("Please select a Unit of Measure"); return; }
      if (!f.dept_id) { alert("Please select a Department"); return; }
      if (!f.category_id) { alert("Please select a Category"); return; }
    }
    setSaving(true);
    try {
      let localItemId = f.local_item_id;
      const casesRcv = parseInt(f.cases_received) || 1;
      const costCase = f.cost_per_case ? parseFloat(f.cost_per_case) : null;
      const caseSize = f.case_size ? parseInt(f.case_size) : null;
      const costUnit = (costCase && caseSize) ? costCase / caseSize : null;

      if (f._status === "exists") {
        // Add cases to existing item
        const [current] = await qry("local_items", { select: "cases_on_hand,warehouse_location,cost", filters: `id=eq.${localItemId}` });
        await qry("local_items", {
          update: {
            cases_on_hand: (current.cases_on_hand || 0) + casesRcv,
            cost: costUnit || current.cost,
            expiration_date: f.expiration_date || null,
            updated_at: new Date().toISOString(),
            // If user edited item details, save those too
            ...(f._editing ? {
              name: f.name.trim(), size: f.size || null,
              mfg_id: f.mfg_id ? parseInt(f.mfg_id) : null,
              dept_id: f.dept_id ? parseInt(f.dept_id) : null,
              category_id: f.category_id ? parseInt(f.category_id) : null,
              sub_category_id: f.sub_category_id ? parseInt(f.sub_category_id) : null,
              retail_price: f.retail_price ? parseFloat(f.retail_price) : null,
            } : {}),
          },
          match: { id: localItemId },
        });
        // Add location if provided and not already assigned
        if (f.warehouse_location) {
          try {
            const isFirstLoc = !(await qry("local_item_locations", {
              select: "id", filters: `local_item_id=eq.${localItemId}`, limit: 1,
            })).length;
            await addItemLocation(localItemId, f.warehouse_location, isFirstLoc);
          } catch { /* unique constraint — location already exists, that's fine */ }
          // Keep local_items.warehouse_location in sync with primary
          const locs = await qry("local_item_locations", {
            select: "location", filters: `local_item_id=eq.${localItemId}&is_primary=eq.true`, limit: 1,
          });
          if (locs.length) {
            await qry("local_items", { update: { warehouse_location: locs[0].location }, match: { id: localItemId } });
          }
        }
      } else {
        // Create new local item
        const [newItem] = await qry("local_items", {
          insert: {
            upc: f.upc, name: f.name.trim(), size: f.size || null,
            mfg_id: f.mfg_id ? parseInt(f.mfg_id) : null,
            ref_unit_cd: f.unit_cd ? parseInt(f.unit_cd) : null,
            dept_id: f.dept_id ? parseInt(f.dept_id) : null,
            category_id: f.category_id ? parseInt(f.category_id) : null,
            sub_category_id: f.sub_category_id ? parseInt(f.sub_category_id) : null,
            retail_price: f.retail_price ? parseFloat(f.retail_price) : null,
            cost: costUnit, case_size: caseSize, cases_on_hand: casesRcv,
            warehouse_location: f.warehouse_location || null,
            expiration_date: f.expiration_date || null,
            from_posbe: f.from_posbe, posbe_item_id: f.posbe_item_id,
            sync_status: "local", created_by: "Receiving", active_yn: "Y",
          },
        });
        localItemId = newItem.id;
        // Add location as primary for new items
        if (f.warehouse_location) {
          try { await addItemLocation(localItemId, f.warehouse_location, true); } catch { /* ignore */ }
        }
      }

      // Add to receiving document
      await qry("receiving_document_items", {
        insert: {
          receiving_doc_id: doc.id, local_item_id: localItemId,
          item_name: f.name.trim(), upc: f.upc, size: f.size || null,
          cases_received: casesRcv, cost_per_case: costCase, cost_per_unit: costUnit,
          case_size: caseSize, warehouse_location: f.warehouse_location || null,
          expiration_date: f.expiration_date || null,
          from_posbe: f.from_posbe, posbe_item_id: f.posbe_item_id,
        },
      });

      // Update doc totals
      const newLineItems = [...lineItems, { cases_received: casesRcv, cost_per_case: costCase }];
      const totalCases = newLineItems.reduce((s, i) => s + (i.cases_received || 0), 0);
      const totalCost = newLineItems.reduce((s, i) => s + ((i.cost_per_case || 0) * (i.cases_received || 0)), 0);
      await qry("receiving_documents", {
        update: { total_items: newLineItems.length, total_cases: totalCases, total_cost: totalCost, updated_at: new Date().toISOString() },
        match: { id: doc.id },
      });

      // Reset for next scan
      setBarcode("");
      setF(emptyForm());
      loadDoc();
      onUpdate?.();
      setTimeout(() => barcodeRef.current?.focus(), 100);
    } catch (err) { alert("Error: " + err.message); }
    setSaving(false);
  };

  const finalize = async () => {
    if (lineItems.length === 0) return;
    await qry("receiving_documents", {
      update: { status: "complete", updated_at: new Date().toISOString() },
      match: { id: doc.id },
    });
    onUpdate?.(); onBack();
  };

  const deleteDoc = async () => {
    if (!confirm("Delete this receiving document and all its line items?")) return;
    if (lineItems.length > 0) {
      await qry("receiving_document_items", { del: true, match: { receiving_doc_id: doc.id } });
    }
    await qry("receiving_documents", { del: true, match: { id: doc.id } });
    onUpdate?.();
    onBack();
  };

  const removeItem = async (itemId) => {
    if (!confirm("Remove this item?")) return;
    await qry("receiving_document_items", { del: true, match: { id: itemId } });
    loadDoc();
  };

  if (loading) return <div className="p-8 text-center text-stone-400">Loading...</div>;

  // ═══ STEP 1: SUPPLIER SELECTION ═══
  if (isNew && !doc) {
    return (
      <div className="flex flex-col h-full">
        <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-stone-500 hover:text-stone-800 text-sm">← Back</button>
          <h2 className="text-lg font-bold text-stone-800">New Shipment</h2>
        </div>
        <div className="flex-1 flex items-start justify-center pt-16">
          <div className="bg-white rounded-xl border border-stone-200 p-6 w-full max-w-md">
            <h3 className="text-sm font-bold text-stone-700 mb-4">Who is this shipment from?</h3>
            {!showNewSupplier ? (
              <>
                <label className={lc}>Search Supplier</label>
                <SearchSelect value={supplierId} displayValue={supplierName}
                  fetchOptions={searchSuppliers}
                  onSelect={(val, label) => { setSupplierId(val); setSupplierName(label || ""); }}
                  placeholder="Type supplier name..." autoFocus />
                <button onClick={() => setShowNewSupplier(true)}
                  className="mt-3 text-xs text-amber-600 hover:text-amber-700 font-medium">+ Add new supplier</button>
              </>
            ) : (
              <>
                <label className={lc}>New Supplier Name</label>
                <input className={ic} value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)}
                  placeholder="e.g., ABC Wholesale" autoFocus />
                <button onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); }}
                  className="mt-2 text-xs text-stone-500 hover:text-stone-700">← Search existing instead</button>
              </>
            )}
            <div className="mt-6 flex gap-2">
              <button onClick={createDoc} disabled={!supplierId && !newSupplierName.trim()}
                className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                Start Receiving
              </button>
              <button onClick={onBack} className="px-4 py-2 text-sm text-stone-500">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══ STEP 2: SCAN + ENTER ITEMS ═══
  const statusLabel = f._status === "exists" ? "Adding to existing item"
    : f._status === "found" ? "Found in StoreLIVE"
    : f._status === "new" ? "New item — enter details"
    : f._status === "choose" ? `Found ${f._existingItems.length} existing entr${f._existingItems.length === 1 ? "y" : "ies"} — choose an option`
    : f._status === "checking" ? "Looking up..."
    : null;

  const statusColor = f._status === "exists" ? "text-yellow-700 bg-yellow-50 border-yellow-200"
    : f._status === "found" ? "text-green-700 bg-green-50 border-green-200"
    : f._status === "new" ? "text-blue-700 bg-blue-50 border-blue-200"
    : f._status === "choose" ? "text-yellow-700 bg-yellow-50 border-yellow-200"
    : "";

  const showForm = f._status === "found" || f._status === "new" || f._status === "exists";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-stone-500 hover:text-stone-800 text-sm">← Back</button>
            <h2 className="text-lg font-bold text-stone-800">{doc?.supplier_name}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${doc?.status === "complete" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
              {doc?.status}
            </span>
          </div>
          {doc?.status === "draft" && (
            <div className="flex items-center gap-2">
              <button onClick={deleteDoc} className="px-3 py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
                Delete
              </button>
              {lineItems.length > 0 && (
                <button onClick={finalize} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">
                  ✓ Finalize ({lineItems.length} items)
                </button>
              )}
            </div>
          )}
        </div>
        <div className="text-xs text-stone-400 mt-1">
          {new Date(doc?.received_date).toLocaleDateString()} — {lineItems.length} items, {lineItems.reduce((s, i) => s + (i.cases_received || 0), 0)} cases
          {doc?.total_cost > 0 && ` — ${fmt$(doc.total_cost)} total`}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-3">

          {/* Barcode + Form Card */}
          {doc?.status === "draft" && (
            <div className={`bg-white rounded-xl border border-stone-200 p-4 ${statusColor ? statusColor : ""}`}>
              {/* Barcode row */}
              <div className="mb-3">
                <label className={lc}>Scan Barcode</label>
                <div className="flex gap-2">
                  <input ref={barcodeRef} className={`${ic} flex-1 text-lg font-mono tracking-wider`}
                    value={barcode} onChange={handleBarcodeChange} onKeyDown={handleBarcodeKeyDown}
                    placeholder="Scan or type barcode, press Enter..." autoFocus />
                  <button type="button" onClick={scanning ? stopScanner : startScanner}
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

              {/* Status indicator */}
              {statusLabel && (
                <div className={`text-xs font-semibold mb-3 ${f._status === "choose" || f._status === "exists" ? "text-yellow-700" : f._status === "found" ? "text-green-700" : f._status === "new" ? "text-blue-700" : "text-stone-400"}`}>
                  {(f._status === "choose" || f._status === "exists") && "⚠️ "}{f._status === "found" && "✓ "}{f._status === "new" && "● "}{statusLabel}
                </div>
              )}

              {/* Choice panel — pick existing entry or create new */}
              {f._status === "choose" && (
                <div className="space-y-2 pt-2 border-t border-yellow-200">
                  {f._existingItems.map(item => {
                    const primaryLoc = item._locations?.find(l => l.is_primary)?.location || item.warehouse_location;
                    const otherLocs = (item._locations || []).filter(l => !l.is_primary).map(l => l.location);
                    const expStr = item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : null;
                    return (
                      <button key={item.id} onClick={() => chooseExisting(item)}
                        className="w-full text-left px-3 py-2.5 rounded-lg border border-stone-200 bg-white hover:border-amber-400 hover:bg-amber-50/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm text-stone-800">{item.name}</div>
                          <span className="text-xs text-stone-400">Add cases →</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-[11px] text-stone-500 flex-wrap">
                          {item._mfg_name && <span className="font-medium">{item._mfg_name}</span>}
                          {item.size && <span>{item.size}</span>}
                          <span>{item.cases_on_hand || 0} cases on hand</span>
                          {expStr && <span>Exp: {expStr}</span>}
                          {item._dept_name && <span>{item._dept_name}{item._category_name ? ` › ${item._category_name}` : ""}</span>}
                          {primaryLoc && <span className="text-amber-700 font-medium">{primaryLoc}</span>}
                          {otherLocs.length > 0 && <span className="text-stone-400">+{otherLocs.length} loc</span>}
                        </div>
                      </button>
                    );
                  })}
                  <button onClick={chooseNewEntry}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-blue-300 bg-blue-50/50 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm text-blue-700">Create New Entry</div>
                      <span className="text-xs text-blue-400">Different exp date or lot →</span>
                    </div>
                    <div className="text-[11px] text-blue-500 mt-0.5">Same UPC, tracked separately</div>
                  </button>
                </div>
              )}

              {/* Item details form — appears after scan */}
              {showForm && (
                <div className="space-y-3 pt-2 border-t border-stone-200">

                  {/* ── EXISTING ITEM: read-only summary + optional edit ── */}
                  {f._status === "exists" && (
                    <>
                      <div className="bg-stone-50 rounded-lg px-3 py-2.5">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-stone-800">{f.name}</div>
                            <div className="flex gap-2 mt-1 text-[11px] text-stone-500 flex-wrap">
                              {f.mfg_name && <span>{f.mfg_name}</span>}
                              {f.size && <span>{f.size}</span>}
                              {f.unit && <span>{f.unit}</span>}
                              {f.retail_price && <span className="text-stone-600 font-medium">${f.retail_price}</span>}
                            </div>
                            {(f.dept_name || f.category_name) && (
                              <div className="text-[11px] text-stone-400 mt-0.5">
                                {[f.dept_name, f.category_name, f.sub_category_name].filter(Boolean).join(" › ")}
                              </div>
                            )}
                          </div>
                          <button onClick={() => set("_editing", !f._editing)}
                            className="text-[11px] text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap ml-3">
                            {f._editing ? "Done editing" : "Edit item details"}
                          </button>
                        </div>
                      </div>

                      {/* Expanded edit fields — only when user clicks Edit */}
                      {f._editing && (
                        <>
                          <div className="grid grid-cols-[160px_1fr_70px_60px_90px] gap-2">
                            <div>
                              <label className={lc}>Manufacturer</label>
                              <SearchSelect value={f.mfg_id} displayValue={f.mfg_name} fetchOptions={searchVendors}
                                onSelect={(v, l) => { set("mfg_id", v || ""); set("mfg_name", l || ""); }}
                                placeholder="Type..." />
                            </div>
                            <div>
                              <label className={lc}>Item Description</label>
                              <input className={ic} value={f.name} onChange={e => set("name", e.target.value)} placeholder="Product name..." />
                            </div>
                            <div>
                              <label className={lc}>Size</label>
                              <input className={ic} value={f.size} onChange={e => set("size", e.target.value)} placeholder="14.9" />
                            </div>
                            <div>
                              <label className={lc}>Unit</label>
                              <SearchSelect value={f.unit_cd} displayValue={f.unit} fetchOptions={searchUnits}
                                onSelect={(v, l) => { set("unit_cd", v || ""); set("unit", l || ""); }}
                                placeholder="Type..." />
                            </div>
                            <div>
                              <label className={lc}>Retail Price</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                                <input type="number" step="0.01" className={`${ic} pl-6`} value={f.retail_price}
                                  onChange={e => set("retail_price", e.target.value)}
                                  onBlur={() => { if (f.retail_price) set("retail_price", parseFloat(f.retail_price).toFixed(2)); }}
                                  placeholder="0.00" />
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className={lc}>Department</label>
                              <SearchSelect value={f.dept_id} displayValue={f.dept_name} fetchOptions={searchDepts}
                                onSelect={(v, l) => { set("dept_id", v || ""); set("dept_name", l || ""); set("category_id", ""); set("category_name", ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                                placeholder="Type dept..." />
                            </div>
                            <div>
                              <label className={lc}>Category</label>
                              <SearchSelect key={`cat-${f.dept_id}`} value={f.category_id} displayValue={f.category_name}
                                fetchOptions={(typed) => searchCategories(typed, f.dept_id)}
                                onSelect={(v, l) => { set("category_id", v || ""); set("category_name", l || ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                                placeholder={f.dept_id ? "Type category..." : "Select dept first"} />
                            </div>
                            <div>
                              <label className={lc}>Sub-Category</label>
                              <SearchSelect key={`sub-${f.category_id}`} value={f.sub_category_id} displayValue={f.sub_category_name}
                                fetchOptions={(typed) => searchSubCategories(typed, f.category_id)}
                                onSelect={(v, l) => { set("sub_category_id", v || ""); set("sub_category_name", l || ""); }}
                                placeholder={f.category_id ? "Type sub-cat..." : "Select category first"} />
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* ── NEW / FOUND: full editable form ── */}
                  {f._status !== "exists" && (
                    <>
                      <div className="grid grid-cols-[160px_1fr_70px_60px_90px] gap-2">
                        <div>
                          <label className={lc}>Manufacturer</label>
                          <SearchSelect value={f.mfg_id} displayValue={f.mfg_name} fetchOptions={searchVendors}
                            onSelect={(v, l) => { set("mfg_id", v || ""); set("mfg_name", l || ""); }}
                            placeholder="Type..." />
                        </div>
                        <div>
                          <label className={lc}>Item Description</label>
                          <input className={ic} value={f.name} onChange={e => set("name", e.target.value)} placeholder="Product name..." />
                        </div>
                        <div>
                          <label className={lc}>Size</label>
                          <input className={ic} value={f.size} onChange={e => set("size", e.target.value)} placeholder="14.9" />
                        </div>
                        <div>
                          <label className={lc}>Unit</label>
                          <SearchSelect value={f.unit_cd} displayValue={f.unit} fetchOptions={searchUnits}
                            onSelect={(v, l) => { set("unit_cd", v || ""); set("unit", l || ""); }}
                            placeholder="Type..." />
                        </div>
                        <div>
                          <label className={lc}>Retail Price</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                            <input type="number" step="0.01" className={`${ic} pl-6`} value={f.retail_price}
                              onChange={e => set("retail_price", e.target.value)}
                              onBlur={() => { if (f.retail_price) set("retail_price", parseFloat(f.retail_price).toFixed(2)); }}
                              placeholder="0.00" />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={lc}>Department</label>
                          {f._status === "found" && f.dept_id ? (
                            <input className={`${ic} bg-stone-50`} value={f.dept_name || "—"} disabled />
                          ) : (
                            <SearchSelect value={f.dept_id} displayValue={f.dept_name} fetchOptions={searchDepts}
                              onSelect={(v, l) => { set("dept_id", v || ""); set("dept_name", l || ""); set("category_id", ""); set("category_name", ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                              placeholder="Type dept..." />
                          )}
                        </div>
                        <div>
                          <label className={lc}>Category</label>
                          {f._status === "found" && f.category_id ? (
                            <input className={`${ic} bg-stone-50`} value={f.category_name || "—"} disabled />
                          ) : (
                            <SearchSelect key={`cat-${f.dept_id}`} value={f.category_id} displayValue={f.category_name}
                              fetchOptions={(typed) => searchCategories(typed, f.dept_id)}
                              onSelect={(v, l) => { set("category_id", v || ""); set("category_name", l || ""); set("sub_category_id", ""); set("sub_category_name", ""); }}
                              placeholder={f.dept_id ? "Type category..." : "Select dept first"} />
                          )}
                        </div>
                        <div>
                          <label className={lc}>Sub-Category</label>
                          {f._status === "found" && f.sub_category_id ? (
                            <input className={`${ic} bg-stone-50`} value={f.sub_category_name || "—"} disabled />
                          ) : (
                            <SearchSelect key={`sub-${f.category_id}`} value={f.sub_category_id} displayValue={f.sub_category_name}
                              fetchOptions={(typed) => searchSubCategories(typed, f.category_id)}
                              onSelect={(v, l) => { set("sub_category_id", v || ""); set("sub_category_name", l || ""); }}
                              placeholder={f.category_id ? "Type sub-cat..." : "Select category first"} />
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Row 3: Exp, Cases, Cost/Case, Units/Case, Cost/Unit, Location */}
                  <div className="grid grid-cols-[minmax(150px,1fr)_1fr_1fr_1fr_1fr_1fr] gap-2">
                    <div>
                      <label className={lc}>Exp Date {f._no_exp
                        ? <button onClick={() => set("_no_exp", false)} className="text-amber-600 hover:text-amber-700 font-medium normal-case tracking-normal ml-1">Set date</button>
                        : <button onClick={() => { set("_no_exp", true); set("expiration_date", ""); }} className="text-amber-600 hover:text-amber-700 font-medium normal-case tracking-normal ml-1">No exp</button>
                      }</label>
                      {f._no_exp ? (
                        <div className={`${ic} bg-stone-50 text-stone-400`}>None</div>
                      ) : (
                        <input type="date" className={ic} value={f.expiration_date}
                          onChange={e => set("expiration_date", e.target.value)} />
                      )}
                    </div>
                    <div>
                      <label className={lc}>Cases</label>
                      <input ref={casesRef} type="number" className={ic} value={f.cases_received}
                        onChange={e => set("cases_received", e.target.value)} min={1} />
                    </div>
                    <div>
                      <label className={lc}>Cost/Case</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                        <input type="number" step="0.01" className={`${ic} pl-6`} value={f.cost_per_case}
                          onChange={e => set("cost_per_case", e.target.value)}
                          onBlur={() => { if (f.cost_per_case) set("cost_per_case", parseFloat(f.cost_per_case).toFixed(2)); }}
                          placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label className={lc}>Units/Case</label>
                      <input type="number" className={ic} value={f.case_size}
                        onChange={e => set("case_size", e.target.value)} placeholder="12" />
                    </div>
                    <div>
                      <label className={lc}>Cost/Unit</label>
                      <div className="px-1 py-2 text-sm text-stone-600 font-medium tabular-nums">
                        {f.cost_per_case && f.case_size && parseFloat(f.case_size) > 0
                          ? `$${(parseFloat(f.cost_per_case) / parseFloat(f.case_size)).toFixed(2)}`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <label className={lc}>WH Location {!showNewLoc
                        ? <button onClick={() => setShowNewLoc(true)} className="text-amber-600 hover:text-amber-700 font-medium normal-case tracking-normal ml-1">+ New</button>
                        : <button onClick={resetNewLoc} className="text-amber-600 hover:text-amber-700 font-medium normal-case tracking-normal ml-1">Cancel</button>
                      }</label>
                      {showNewLoc ? (
                        <div className="space-y-1.5">
                          <div className="flex gap-1">
                            <input type="number" className={`${ic} w-14`} value={newLocSec} onChange={e => setNewLocSec(e.target.value)} placeholder="Sec#" autoFocus />
                            <input className={`${ic} w-10`} value={newLocRow} onChange={e => setNewLocRow(e.target.value)} placeholder="Row" maxLength={2} />
                            <input type="number" className={`${ic} w-12`} value={newLocSlot} onChange={e => setNewLocSlot(e.target.value)} placeholder="Slot" />
                            {newLocLabel && <span className="self-center text-xs font-mono font-bold text-stone-700">= {newLocLabel}</span>}
                          </div>
                          <div className="flex gap-1">
                            <input className={`${ic} flex-1`} value={newLocWhSection} onChange={e => setNewLocWhSection(e.target.value)} placeholder="WH Section" />
                            <input className={`${ic} flex-1`} value={newLocAisle} onChange={e => setNewLocAisle(e.target.value)} placeholder="Aisle" />
                          </div>
                          <button onClick={addNewLocation} disabled={savingLoc || !newLocLabel}
                            className="px-2 py-1 bg-amber-600 text-white rounded text-xs font-bold hover:bg-amber-700 disabled:opacity-50">
                            {savingLoc ? "..." : "Add"}
                          </button>
                        </div>
                      ) : (
                        <SearchSelect value={f.warehouse_location} displayValue={f.warehouse_location}
                          fetchOptions={searchLocations}
                          onSelect={(v) => set("warehouse_location", v || "")}
                          placeholder="Select location..." />
                      )}
                    </div>
                  </div>

                  {/* Add button */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={addItem} disabled={saving || !f.name?.trim() || (f._status !== "exists" && f._status !== "found" && (!f.unit_cd || !f.dept_id || !f.category_id))}
                      className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                      {saving ? "Saving..." : "Add to Shipment"}
                    </button>
                    <button onClick={() => { setBarcode(""); setF(emptyForm()); }}
                      className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700">Clear</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ LINE ITEMS ═══ */}
          {lineItems.length > 0 && (
            <div className="bg-white rounded-xl border border-stone-200">
              <div className="px-4 py-2 border-b border-stone-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wide">
                  Items ({lineItems.length})
                </h3>
                <span className="text-xs text-stone-400">
                  {lineItems.reduce((s, i) => s + (i.cases_received || 0), 0)} cases
                  {doc?.total_cost > 0 && ` — ${fmt$(doc.total_cost)}`}
                </span>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_110px_55px_75px_75px_55px_80px_24px] px-4 py-1.5 border-b border-stone-200 text-[10px] font-bold text-stone-400 uppercase gap-1">
                <div>Item</div>
                <div className="text-center">Exp</div>
                <div className="text-center">Cases</div>
                <div className="text-center">$/Case</div>
                <div className="text-center">$/Unit</div>
                <div className="text-center">U/Cs</div>
                <div className="text-center">Location</div>
                <div></div>
              </div>

              <div className="divide-y divide-stone-100">
                {lineItems.map(item => (
                  <LineItem key={item.id} item={item} isDraft={doc?.status === "draft"}
                    onUpdate={loadDoc} onRemove={() => removeItem(item.id)} />
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
