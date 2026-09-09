import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { qry, fetchItemsForNeeds } from "../lib/hooks";
import { fmt$, prefixColorClass, compareLocation, btnGhost } from "../lib/helpers";
import { downloadWholesaleInvoice } from "../lib/wholesaleInvoicePdf";
import CustomerPickerModal from "./CustomerPickerModal";
import Modal from "./ui/Modal";

// ─── shared UI helpers ─────────────────────────────────────────────────

const slug = (s) => (s || "other").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const TYPE_DISPLAY = {
  dry:     { label: "Dry",     text: "text-amber-700", banner: "bg-amber-600", hover: "hover:bg-amber-50" },
  cooler:  { label: "Cooler",  text: "text-blue-700",  banner: "bg-blue-600",  hover: "hover:bg-blue-50" },
  freezer: { label: "Freezer", text: "text-green-700", banner: "bg-green-600", hover: "hover:bg-green-50" },
};

// Physical warehouse layout — used for the sidebar jump-to-aisle sub-buttons.
const SECTION_RANGES = {
  "Section A": [1,   149],
  "Section B": [150, 221],
  "Section C": [222, 468],
};
const AISLE_INTERVAL = 25;

function locNumOf(label) {
  if (!label) return null;
  const m = /^(\d+)/.exec(String(label));
  return m ? parseInt(m[1], 10) : null;
}

function milestonesForSection(sectionKey) {
  const range = SECTION_RANGES[sectionKey];
  if (!range) return [];
  const [start, end] = range;
  const first = Math.ceil(start / AISLE_INTERVAL) * AISLE_INTERVAL;
  const out = [];
  for (let n = first; n <= end; n += AISLE_INTERVAL) out.push(n);
  return out;
}

const _canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function measureText(text, font = "500 14px ui-sans-serif, system-ui, sans-serif") {
  if (!_canvas) return text.length * 8;
  const ctx = _canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}
function dynamicWidth(items, field, font, minW = 80, maxW = 300) {
  if (!items.length) return minW;
  const widths = items.map(i => measureText(String(i[field] || ""), font));
  widths.sort((a, b) => b - a);
  const top25 = widths.slice(0, Math.max(1, Math.ceil(widths.length * 0.25)));
  const avg = top25.reduce((s, w) => s + w, 0) / top25.length;
  return Math.max(minW, Math.min(maxW, Math.round(avg * 1.1) + 24));
}

// Fallback section from a numeric prefix — used when the warehouse_locations
// row exists but its `section` field is blank. Ranges match the physical layout:
//   1–149   → A
//   150–221 → B
//   222–468 → C
function sectionFromNumber(label) {
  const m = /^(\d+)/.exec(label || "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1   && n <= 149) return "A";
  if (n >= 150 && n <= 221) return "B";
  if (n >= 222 && n <= 468) return "C";
  return null;
}

// Bucket key for Location grouping. Returns e.g. "Section A", "Cooler",
// "Freezer", "Unassigned". `sectionMap` is label → section letter (A/B/C).
function locationBucket(item, sectionMap) {
  const loc = item.warehouse_location;
  if (!loc) return "Unassigned";
  const upper = loc.toUpperCase();
  if (upper.startsWith("C-") || upper.startsWith("C ")) return "Cooler";
  if (upper.startsWith("F-") || upper.startsWith("F ")) return "Freezer";
  const section = sectionMap[loc] || sectionFromNumber(loc);
  return section ? `Section ${section}` : "Unassigned";
}

// Sort order for the location buckets: Section A, B, C, …, Cooler, Freezer, Unassigned
function bucketRank(bucket) {
  if (bucket.startsWith("Section ")) return [0, bucket.slice(8)];
  if (bucket === "Cooler")   return [1, ""];
  if (bucket === "Freezer")  return [2, ""];
  return [3, ""];
}

// ─── Editable case-price cell ─────────────────────────────────────────
//
// Click-to-edit pattern:
//   • Not editing → shows the price as text ($X.XX). Click to enter edit mode.
//   • Editing     → shows a text input; blur or Enter saves; Escape cancels.
//   • If a per-order override is set, an "×" appears next to the price to
//     revert to the item's stored default (also happens automatically if the
//     entered value equals the default).

function PriceCell({ overrideValue, defaultValue, onChange, onRevert, itemKey, handleGridNav }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const hasOverride = overrideValue !== undefined && overrideValue !== null && overrideValue !== "";
  const effective = hasOverride ? overrideValue : defaultValue;
  const effectiveNum = effective != null && effective !== "" ? Number(effective) : null;
  const defaultNum   = defaultValue != null && defaultValue !== "" ? Number(defaultValue) : null;

  useEffect(() => {
    if (editing) {
      // Deferred focus so the input is in the DOM by the time we grab it.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(effective != null && effective !== "" ? String(effective) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft === "") { onRevert(); return; }
    const n = Number(draft);
    if (!Number.isFinite(n)) { onRevert(); return; }
    // Auto-revert if the user typed exactly the default — no point flagging
    // it as an override.
    if (defaultNum != null && Math.abs(n - defaultNum) < 0.005) { onRevert(); return; }
    onChange(n.toFixed(2));
  };

  if (editing) {
    return (
      <input ref={inputRef} type="text" inputMode="decimal"
        data-grid-cell={`price-${itemKey}`}
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.currentTarget.blur(); return; }
          if (e.key === "Escape") { setEditing(false); return; }
          handleGridNav?.(e, itemKey, "price");
        }}
        onBlur={commit}
        placeholder="—"
        className="w-16 text-center py-1 rounded text-xs tabular-nums border border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 text-stone-700" />
    );
  }

  return (
    <div className="flex items-center gap-1 justify-center min-w-0">
      <button type="button" onClick={startEdit}
        data-grid-cell={`price-${itemKey}`}
        onKeyDown={e => {
          // Enter/Space opens edit mode; arrows navigate the grid.
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); return; }
          handleGridNav?.(e, itemKey, "price");
        }}
        className={`text-xs tabular-nums font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded px-1 ${
          hasOverride ? "text-amber-700" : effectiveNum != null ? "text-stone-700" : "text-stone-300 italic"
        }`}>
        {effectiveNum != null ? `$${effectiveNum.toFixed(2)}` : "—"}
      </button>
      {hasOverride && (
        <button type="button" onClick={onRevert}
          title="Revert to default price"
          className="text-stone-400 hover:text-red-500 text-sm leading-none px-0.5">
          ×
        </button>
      )}
    </div>
  );
}

// ─── Column header for the item grid ──────────────────────────────────
// Column order: WH Loc, Mfg, Description, Size/Unit, Case $, Qty, Total, Notes.

const GRID_COLUMNS = (mfgW, descW) =>
  `70px ${mfgW}px ${descW}px 80px 80px 60px 80px 1fr`;

function ColumnHeader({ mfgW, descW }) {
  return (
    <div className="grid border-b border-stone-300 bg-stone-100 text-[10px] font-bold text-stone-500 uppercase"
      style={{ gridTemplateColumns: GRID_COLUMNS(mfgW, descW) }}>
      <div className="px-2 py-1 text-center border-r border-stone-200">WH Loc</div>
      <div className="px-2 py-1 border-r border-stone-200">Mfg</div>
      <div className="px-2 py-1 border-r border-stone-200">Description</div>
      <div className="px-2 py-1 text-center border-r border-stone-200">Size/Unit</div>
      <div className="px-2 py-1 text-center border-r border-stone-200">Case $</div>
      <div className="px-2 py-1 text-center border-r border-stone-200">Qty</div>
      <div className="px-2 py-1 text-center border-r border-stone-200">Total</div>
      <div className="px-2 py-1">Notes</div>
    </div>
  );
}

// ─── Row (memoized) ────────────────────────────────────────────────────

const WholesaleItemRow = memo(function WholesaleItemRow({
  item, ii, qty, note, priceOverride, mfgW, descW, unitMap, readOnly, setQty, setNote, setPrice, handleGridNav,
}) {
  const itemKey = String(item.id);
  const hasQty = (qty || 0) > 0;
  const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
  // Effective price: user's override wins over the item's default. Blank
  // input means "no price set" — the row shows a placeholder and the total
  // stays at "—" until they enter one.
  const effectivePrice = priceOverride !== undefined && priceOverride !== ""
    ? num(priceOverride)
    : (item.wholesale_case_price != null ? num(item.wholesale_case_price) : 0);
  const lineTotal = hasQty && effectivePrice > 0 ? qty * effectivePrice : 0;

  return (
    <div id={`row-${item.id}`}
      className={`grid border-b border-stone-100 text-sm ${hasQty ? "bg-amber-50" : ii % 2 ? "bg-stone-50/50" : ""}`}
      style={{ gridTemplateColumns: GRID_COLUMNS(mfgW, descW) }}>
      <div className={`px-2 py-1.5 text-center border-r border-stone-100 text-xs font-medium ${item.warehouse_location ? prefixColorClass(item.warehouse_location) : "text-stone-400"}`}>{item.warehouse_location || "—"}</div>
      <div className="px-2 py-1.5 border-r border-stone-100 truncate text-stone-500 text-xs">{item._mfg_name || "—"}</div>
      <div className="px-2 py-1.5 border-r border-stone-100 truncate font-medium text-stone-800">{item.name}</div>
      <div className="px-2 py-1.5 text-center border-r border-stone-100 text-stone-500 text-xs">{sizeUnit || "—"}</div>
      <div className="px-1 py-1 border-r border-stone-100 flex items-center justify-center">
        {readOnly ? (
          <span className="text-xs text-stone-700 tabular-nums">{effectivePrice > 0 ? fmt$(effectivePrice) : "—"}</span>
        ) : (
          <PriceCell
            overrideValue={priceOverride}
            defaultValue={item.wholesale_case_price != null ? String(item.wholesale_case_price) : ""}
            onChange={v => setPrice(itemKey, v)}
            onRevert={() => setPrice(itemKey, "")}
            itemKey={itemKey}
            handleGridNav={handleGridNav} />
        )}
      </div>
      <div className="px-1 py-1 border-r border-stone-100 flex items-center justify-center">
        {readOnly ? (
          <span className={`text-sm font-bold ${hasQty ? "text-amber-800" : "text-stone-300"}`}>{hasQty ? qty : "—"}</span>
        ) : (
          <input type="number" min={0} value={qty || ""} onChange={e => setQty(itemKey, e.target.value)} placeholder="—"
            data-grid-cell={`qty-${itemKey}`}
            onKeyDown={e => handleGridNav(e, itemKey, "qty")}
            className={`w-12 text-center py-1 rounded text-sm font-bold border focus:outline-none focus:ring-2 focus:ring-amber-500 ${hasQty ? "border-amber-400 bg-amber-100 text-amber-800" : "border-stone-200 text-stone-400"}`} />
        )}
      </div>
      <div className="px-2 py-1.5 text-center border-r border-stone-100 text-xs font-bold text-stone-800 tabular-nums">{lineTotal > 0 ? fmt$(lineTotal) : "—"}</div>
      <div className="px-1 py-1 flex items-center">
        {readOnly ? (
          <span className="text-xs text-stone-600 truncate">{note || ""}</span>
        ) : (
          <input type="text" value={note || ""}
            onChange={e => setNote(itemKey, e.target.value)}
            data-grid-cell={`notes-${itemKey}`}
            onKeyDown={e => handleGridNav(e, itemKey, "notes")}
            placeholder="Optional note..."
            className="w-full px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-500" />
        )}
      </div>
    </div>
  );
});

// ─── Print view ────────────────────────────────────────────────────────
// Only visible in @media print. Uses `<table>` so `<thead>` repeats on every
// printed page. Two variants driven by sortMode:
//   - location: Section A/B/C, Cooler, Freezer headers with WH Loc column filled
//   - deptcat:  Dry/Cooler/Freezer banner + dept sub-headers (like Store Lists)

function WholesalePrintView({ sortMode, locationGroups, typeGroups, unitMap, quantities, prices, orderId, scope }) {
  // Narrow the groups to a single product_type when the user picked one
  // via the scope modal. "all" (or unset) means print everything.
  const active = scope && scope !== "all" ? scope : null;
  const scopedLocation = active
    ? locationGroups
        .map(g => ({ ...g, items: g.items.filter(i => i.product_type === active) }))
        .filter(g => g.items.length > 0)
    : locationGroups;
  const scopedType = active
    ? typeGroups.filter(tg => tg.type === active)
    : typeGroups;
  const scopeLabel = active ? active.toUpperCase() : "ALL";
  const effectiveCasePrice = (item) => {
    const key = String(item.id);
    const override = prices?.[key];
    if (override !== undefined && override !== "") return Number(override);
    return item.wholesale_case_price != null ? Number(item.wholesale_case_price) : null;
  };

  const renderRow = (item, ii) => {
    const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
    const cp = effectiveCasePrice(item);
    // Show the system price if it's set to something > 0; otherwise leave
    // the cell blank so the user can write in a price themselves.
    const systemPrice = cp != null && cp > 0 ? `$${cp.toFixed(2)}` : "";
    // Retail case value = per-unit retail price × units per case. Shown as the
    // full expression so the user can eyeball the wholesale price against it.
    const retail   = parseFloat(item.retail_price);
    const caseSize = parseInt(item.case_size);
    const retailExpr = Number.isFinite(retail) && retail > 0 && Number.isFinite(caseSize) && caseSize > 0
      ? `$${retail.toFixed(2)} × ${caseSize} = $${(retail * caseSize).toFixed(2)}`
      : "";
    const qty = quantities?.[String(item.id)];
    return (
      <tr key={`r-${item.id}`} className={ii % 2 ? "bg-stone-50" : ""}>
        <td className="px-2 py-1.5 text-stone-700 font-bold border-b border-stone-200 whitespace-nowrap">{item.warehouse_location || "—"}</td>
        <td className="px-2 py-1.5 text-stone-500 border-b border-stone-200 whitespace-nowrap">{item._mfg_name || "—"}</td>
        <td className="px-2 py-1.5 font-medium text-stone-800 border-b border-stone-200">{item.name}</td>
        <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{sizeUnit || "—"}</td>
        <td className="px-2 py-1.5 text-center text-stone-600 border-b border-stone-200 whitespace-nowrap tabular-nums" style={{ width: "150px" }}>
          {retailExpr}
        </td>
        <td className="px-1 py-1 text-center border border-stone-400 tabular-nums" style={{ width: "55px", height: "28px" }}>
          {qty ? qty : ""}
        </td>
        <td className="px-1 py-1 text-center border border-stone-400 tabular-nums text-stone-700" style={{ width: "70px", height: "28px" }}>
          {systemPrice}
        </td>
      </tr>
    );
  };

  const printHeaderRow = () => (
    <tr className="border-b-2 border-stone-400 text-[10px] font-bold text-stone-600 uppercase">
      <th className="px-2 py-1.5 text-left whitespace-nowrap">WH Loc</th>
      <th className="px-2 py-1.5 text-left whitespace-nowrap">Mfg</th>
      <th className="px-2 py-1.5 text-left">Description</th>
      <th className="px-2 py-1.5 text-center whitespace-nowrap">Size/Unit</th>
      <th className="px-2 py-1.5 text-center whitespace-nowrap" style={{ width: "150px" }}>Retail Case $</th>
      <th className="px-2 py-1.5 text-center" style={{ width: "55px" }}>Cases</th>
      <th className="px-2 py-1.5 text-center whitespace-nowrap" style={{ width: "70px" }}>Case $</th>
    </tr>
  );

  return (
    <div className="hidden print:block">
      <style>{`@page { margin: 0.2in; }`}</style>

      {/* Header banner */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
          <div>
            <h1 className="text-xl font-black">KURTZ DISCOUNT GROCERIES</h1>
            <p className="text-sm font-bold">
              WHOLESALE ORDER {orderId ? `#${orderId}` : "(NEW)"} — {scopeLabel} — SORTED BY {sortMode === "location" ? "LOCATION" : "DEPARTMENT"}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{new Date().toLocaleDateString()}</p>
            <p className="text-xs text-stone-500">Write # of cases in Cases column</p>
          </div>
        </div>
      </div>

      {sortMode === "location" ? (
        <table className="w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
          <thead style={{ display: "table-header-group" }}>{printHeaderRow()}</thead>
          <tbody>
            {scopedLocation.flatMap(g => [
              <tr key={`th-${g.key}`}>
                <td colSpan={7} className="pt-3 pb-1 px-2 font-black text-sm uppercase tracking-wider text-stone-900 border-b-2 border-stone-700">
                  {g.key}
                  <span className="text-stone-400 ml-2 font-normal text-xs">{g.items.length} items</span>
                </td>
              </tr>,
              ...g.items.map((item, ii) => renderRow(item, ii)),
            ])}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
          <thead style={{ display: "table-header-group" }}>{printHeaderRow()}</thead>
          <tbody>
            {scopedType.flatMap(tg => [
              <tr key={`th-${tg.type}`}>
                <td colSpan={7} className="pt-4 pb-1 px-2 font-black text-sm uppercase tracking-wider text-stone-900 border-b-2 border-stone-700">
                  {TYPE_DISPLAY[tg.type].label}
                  <span className="text-stone-400 ml-2 font-normal text-xs">{tg.count} items</span>
                </td>
              </tr>,
              ...tg.depts.flatMap(group => [
                <tr key={`h-${tg.type}-${group.dept}`}>
                  <td colSpan={7} className="pt-2 pb-1 px-2 font-bold text-xs uppercase text-stone-800 border-b border-stone-300">
                    {group.dept}
                    <span className="text-stone-400 ml-2 font-normal">{group.items.length}</span>
                  </td>
                </tr>,
                ...group.items.map((item, ii) => renderRow(item, ii)),
              ]),
            ])}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Pick List print view ─────────────────────────────────────────────
// Ordered-items-only, always sorted by warehouse location, bucketed by
// section (A/B/C, Cooler, Freezer). Meant to be printed and carried into
// the warehouse for pulling stock — includes a checkbox column for pickers.

function WholesalePickListPrintView({ items, sectionMap, quantities, itemNotes, unitMap, orderId, customer }) {
  // Only items with qty > 0, sorted by WH location naturally within their bucket.
  const bucketed = {};
  for (const it of items || []) {
    const q = quantities[String(it.id)];
    if (!q || q <= 0) continue;
    const bucket = locationBucket(it, sectionMap);
    if (!bucketed[bucket]) bucketed[bucket] = [];
    bucketed[bucket].push(it);
  }
  const groups = Object.keys(bucketed)
    .sort((a, b) => {
      const [ra, sa] = bucketRank(a);
      const [rb, sb] = bucketRank(b);
      if (ra !== rb) return ra - rb;
      return sa.localeCompare(sb);
    })
    .map(key => ({
      key,
      items: bucketed[key].sort((a, b) =>
        compareLocation(a.warehouse_location, b.warehouse_location)
        || (a.name || "").localeCompare(b.name || "")
      ),
    }));

  const totalCases = Object.values(quantities).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalLines = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="hidden print:block">
      <style>{`@page { margin: 0.35in; }`}</style>

      <div className="px-2 pt-2 pb-2">
        <div className="flex justify-between items-end border-b-2 border-stone-800 pb-2 mb-1">
          <div>
            <h1 className="text-xl font-black">PICK LIST</h1>
            <p className="text-sm font-bold">
              {orderId ? `Invoice #${orderId}` : "New Order"}
              {customer?.business_name && <> — {customer.business_name}</>}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{new Date().toLocaleDateString()}</p>
            <p className="text-xs text-stone-500">{totalLines} lines · {totalCases} cases</p>
          </div>
        </div>
      </div>

      <table className="w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
        <thead style={{ display: "table-header-group" }}>
          <tr className="border-b-2 border-stone-400 text-[10px] font-bold text-stone-600 uppercase">
            <th className="px-2 py-1.5 text-center" style={{ width: "28px" }}>✓</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap">WH Loc</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap">Mfg</th>
            <th className="px-2 py-1.5 text-left">Description</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">Size/Unit</th>
            <th className="px-2 py-1.5 text-center" style={{ width: "50px" }}>Cases</th>
            <th className="px-2 py-1.5 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(g => [
            <tr key={`th-${g.key}`}>
              <td colSpan={7} className="pt-3 pb-1 px-2 font-black text-sm uppercase tracking-wider text-stone-900 border-b-2 border-stone-700">
                {g.key}
                <span className="text-stone-400 ml-2 font-normal text-xs">{g.items.length} lines</span>
              </td>
            </tr>,
            ...g.items.map((item, ii) => {
              const sizeUnit = [item.size, item.ref_unit_cd ? unitMap[String(item.ref_unit_cd)] : null].filter(Boolean).join(" ");
              const qty = quantities[String(item.id)] || 0;
              const note = itemNotes[String(item.id)];
              return (
                <tr key={`r-${item.id}`} className={ii % 2 ? "bg-stone-50" : ""}>
                  <td className="px-1 py-1.5 text-center border border-stone-400" style={{ height: "26px" }}></td>
                  <td className="px-2 py-1.5 text-stone-700 font-bold border-b border-stone-200 whitespace-nowrap">{item.warehouse_location || "—"}</td>
                  <td className="px-2 py-1.5 text-stone-500 border-b border-stone-200 whitespace-nowrap">{item._mfg_name || "—"}</td>
                  <td className="px-2 py-1.5 font-medium text-stone-800 border-b border-stone-200">{item.name}</td>
                  <td className="px-2 py-1.5 text-center text-stone-500 border-b border-stone-200 whitespace-nowrap">{sizeUnit || "—"}</td>
                  <td className="px-2 py-1.5 text-center text-stone-900 font-black border-b border-stone-200 tabular-nums">{qty}</td>
                  <td className="px-2 py-1.5 text-xs text-stone-600 border-b border-stone-200">{note || ""}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

// ─── Wholesale Order Form ─────────────────────────────────────────────

function WholesaleOrderForm({ data, orderId: initialOrderId, initialCustomer, onDone }) {
  const [allItems, setAllItems] = useState([]);
  const [sectionMap, setSectionMap] = useState({});     // label → section letter
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  // Per-order case-price overrides. Keyed by item.id → string. Undefined =
  // "use the item's default"; empty string = "explicitly cleared".
  const [prices, setPrices] = useState({});
  const [customer, setCustomer] = useState(initialCustomer || null);
  const [customerName, setCustomerName] = useState(initialCustomer?.business_name || "");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderId, setOrderId] = useState(initialOrderId || null);
  const [savedToast, setSavedToast] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [saveErr, setSaveErr] = useState(null);
  // Which print template is currently mounted. Defaults to "full" so an
  // ad-hoc Ctrl+P behaves the same as clicking Full Item List. Toggled to
  // "pickList" temporarily when the user chooses that option.
  const [printMode, setPrintMode] = useState("full");
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  // Which product_type slice the Item List print is scoped to. "all" or a
  // specific type; null means "not currently prompting". The picker modal
  // (below) sets this then triggers window.print().
  const [printScope, setPrintScope] = useState("all");
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Reset back to the default print template after each print job so the
  // next Ctrl+P doesn't accidentally reuse the picklist template.
  useEffect(() => {
    const reset = () => setPrintMode("full");
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const [search, setSearch] = useState("");
  const [mfgLetter, setMfgLetter] = useState(null);
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  const [sortMode, setSortMode] = useState("location");   // "location" | "deptcat"
  const [tocOpen, setTocOpen] = useState(true);

  const deptMap = useMemo(() => Object.fromEntries((data.depts || []).map(d => [d.Dept_ID, d.Name_TX])), [data.depts]);
  const unitMap = useMemo(() => Object.fromEntries((data.units || []).map(u => [String(u.Unit_ID), u.Unit_Name_TX])), [data.units]);

  const mfgW  = useMemo(() => dynamicWidth(allItems, "_mfg_name", "400 12px ui-sans-serif, system-ui, sans-serif", 80, 200), [allItems]);
  const descW = useMemo(() => dynamicWidth(allItems, "name",      "500 14px ui-sans-serif, system-ui, sans-serif", 150, 400), [allItems]);

  // Initial load: items + warehouse_locations map + (if editing) saved lines + order header
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [items, locs] = await Promise.all([
          fetchItemsForNeeds(),
          qry("warehouse_locations", { select: "label,section", filters: "active_yn=eq.Y", limit: 5000 }).catch(() => []),
        ]);
        if (cancelled) return;
        setAllItems(items);
        const sm = {};
        for (const l of locs) if (l.label && l.section) sm[l.label] = l.section;
        setSectionMap(sm);

        if (initialOrderId) {
          const [header, lines] = await Promise.all([
            qry("wholesale_orders", { filters: `id=eq.${initialOrderId}`, limit: 1 }),
            qry("wholesale_order_items", { filters: `order_id=eq.${initialOrderId}` }),
          ]);
          if (cancelled) return;
          const h = header?.[0];
          if (h) {
            setCustomerName(h.customer_name || "");
            setOrderNotes(h.notes || "");
            // If the order has a customer_id, resolve the live customer row
            // so the header shows current contact info. Fall back to a
            // snapshot-only synthetic customer if the row was deleted.
            if (h.customer_id) {
              const [live] = await qry("wholesale_customers", { filters: `id=eq.${h.customer_id}`, limit: 1 });
              if (!cancelled) setCustomer(live || {
                id: null,
                business_name: h.customer_name,
                _snapshot: { address: h.customer_address, phone: h.customer_phone, email: h.customer_email },
              });
            } else if (h.customer_name) {
              setCustomer({
                id: null,
                business_name: h.customer_name,
                _snapshot: { address: h.customer_address, phone: h.customer_phone, email: h.customer_email },
              });
            }
          }
          const q = {}, n = {}, p = {};
          for (const li of lines || []) {
            if (li.cases_ordered > 0) q[String(li.item_id)] = li.cases_ordered;
            if (li.notes) n[String(li.item_id)] = li.notes;
            // Restore the case price the user had on this order — even if
            // the item's default has changed since, we want the invoice to
            // stay stable until they explicitly re-edit.
            if (li.case_price != null) p[String(li.item_id)] = String(li.case_price);
          }
          // eslint-disable-next-line no-console
          console.log(`[wholesale] loaded order #${initialOrderId}: ${lines?.length || 0} line(s), ${Object.keys(q).length} with qty, ${Object.keys(p).length} with price override`, { lines, prices: p });
          setQuantities(q);
          setItemNotes(n);
          setPrices(p);
        }
      } catch (err) {
        console.error("wholesale form load failed:", err);
        if (!cancelled) setLoadErr(err.message || String(err));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [initialOrderId]);

  const availableLetters = useMemo(() => {
    const set = new Set();
    allItems.forEach(i => {
      const c = (i._mfg_name || "").charAt(0).toUpperCase();
      if (/[A-Z]/.test(c)) set.add(c);
    });
    return set;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    let out = allItems;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(i =>
        (i.name || "").toLowerCase().includes(q) ||
        (i._mfg_name || "").toLowerCase().includes(q) ||
        (i.upc || "").toLowerCase().includes(q)
      );
    }
    if (mfgLetter) {
      out = out.filter(i => (i._mfg_name || "").charAt(0).toUpperCase() === mfgLetter);
    }
    return out;
  }, [allItems, search, mfgLetter]);

  // Location mode → flat buckets (Section A/B/C, Cooler, Freezer, Unassigned).
  // Dept mode     → 2-tier: Dry/Cooler/Freezer banners with dept sub-groups
  //                 (mirrors Store Lists exactly).
  const locationGroups = useMemo(() => {
    if (sortMode !== "location") return [];
    const bucketed = {};
    for (const item of filteredItems) {
      const key = locationBucket(item, sectionMap);
      if (!bucketed[key]) bucketed[key] = [];
      bucketed[key].push(item);
    }
    const keys = Object.keys(bucketed).sort((a, b) => {
      const [ra, sa] = bucketRank(a);
      const [rb, sb] = bucketRank(b);
      if (ra !== rb) return ra - rb;
      return sa.localeCompare(sb);
    });
    return keys.map(key => ({
      key,
      items: bucketed[key].sort((a, b) =>
        compareLocation(a.warehouse_location, b.warehouse_location)
        || (a._mfg_name || "zzz").localeCompare(b._mfg_name || "zzz")
        || (a.name || "").localeCompare(b.name || "")
      ),
    }));
  }, [filteredItems, sortMode, sectionMap]);

  const typeGroups = useMemo(() => {
    if (sortMode !== "deptcat") return [];
    const byType = { dry: {}, cooler: {}, freezer: {} };
    for (const item of filteredItems) {
      const t = byType[item.product_type] ? item.product_type : "dry";
      const dk = (item.dept_id ? deptMap[item.dept_id] : null) || "Other";
      if (!byType[t][dk]) byType[t][dk] = [];
      byType[t][dk].push(item);
    }
    return ["dry", "cooler", "freezer"].map(type => {
      const depts = Object.entries(byType[type])
        .map(([dept, items]) => ({
          dept,
          items: [...items].sort((a, b) =>
            (a._mfg_name || "zzz").localeCompare(b._mfg_name || "zzz") ||
            (a.name || "").localeCompare(b.name || "")
          ),
        }))
        .sort((a, b) => a.dept.localeCompare(b.dept));
      return { type, depts, count: depts.reduce((s, d) => s + d.items.length, 0) };
    }).filter(g => g.depts.length > 0);
  }, [filteredItems, sortMode, deptMap]);

  // Apply Ordered-Only filter last (uses quantities so it re-runs on qty edits
  // but doesn't invalidate the base group memo above).
  const visibleLocationGroups = useMemo(() => {
    if (sortMode !== "location") return [];
    if (!onlyOrdered) return locationGroups;
    return locationGroups
      .map(g => ({ ...g, items: g.items.filter(i => (quantities[String(i.id)] || 0) > 0) }))
      .filter(g => g.items.length > 0);
  }, [locationGroups, sortMode, onlyOrdered, quantities]);

  const visibleTypeGroups = useMemo(() => {
    if (sortMode !== "deptcat") return [];
    if (!onlyOrdered) return typeGroups;
    return typeGroups
      .map(tg => ({
        ...tg,
        depts: tg.depts
          .map(d => ({ ...d, items: d.items.filter(i => (quantities[String(i.id)] || 0) > 0) }))
          .filter(d => d.items.length > 0),
      }))
      .map(tg => ({ ...tg, count: tg.depts.reduce((s, d) => s + d.items.length, 0) }))
      .filter(tg => tg.depts.length > 0);
  }, [typeGroups, sortMode, onlyOrdered, quantities]);

  const hasAnyGroup = sortMode === "location"
    ? visibleLocationGroups.length > 0
    : visibleTypeGroups.length > 0;

  const setQty = useCallback((id, val) => {
    const n = parseInt(val) || 0;
    setQuantities(prev => {
      const next = { ...prev };
      if (n > 0) next[id] = n; else delete next[id];
      return next;
    });
  }, []);

  const setNote = useCallback((id, val) => {
    setItemNotes(prev => ({ ...prev, [id]: val }));
  }, []);

  const setPrice = useCallback((id, val) => {
    setPrices(prev => {
      // Empty/nullish → remove the override entirely so we fall back to the
      // item's stored default cleanly.
      if (val === "" || val == null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: val };
    });
  }, []);

  // Effective case price for an item: user's override wins over the item's default.
  const effectivePriceFor = useCallback((it) => {
    if (!it) return 0;
    const key = String(it.id);
    const override = prices[key];
    if (override !== undefined && override !== "") return num(override);
    return it.wholesale_case_price != null ? num(it.wholesale_case_price) : 0;
  }, [prices]);

  const handleGridNav = useCallback((e, itemKey, col) => {
    const key = e.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") return;

    // Text inputs (notes, and price in edit mode) should only consume
    // left/right when the cursor is at the edge of the value. That way you
    // can still move the caret inside the field normally.
    const el = e.currentTarget;
    if (el.tagName === "INPUT" && (col === "notes" || col === "price")) {
      const pos = el.selectionStart;
      const len = el.value.length;
      if (key === "ArrowLeft"  && pos !== 0)   return;
      if (key === "ArrowRight" && pos !== len) return;
    }

    // Cell activator: PriceCell in display mode is a <button>; clicking it
    // enters edit mode and its internal useEffect focuses the input.
    // Everything else is a plain input we can focus + select.
    const activate = (target) => {
      if (!target) return;
      if (target.tagName === "BUTTON") target.click();
      else { target.focus(); target.select?.(); }
    };

    const cols = ["price", "qty", "notes"];  // Total is display-only, skipped
    const colIdx = cols.indexOf(col);

    if (key === "ArrowLeft" && colIdx > 0) {
      e.preventDefault();
      activate(document.querySelector(`[data-grid-cell="${cols[colIdx - 1]}-${itemKey}"]`));
      return;
    }
    if (key === "ArrowRight" && colIdx >= 0 && colIdx < cols.length - 1) {
      e.preventDefault();
      activate(document.querySelector(`[data-grid-cell="${cols[colIdx + 1]}-${itemKey}"]`));
      return;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      e.preventDefault();
      // Traverse cells in the current column across all rows in DOM order.
      const cells = Array.from(document.querySelectorAll(`[data-grid-cell^="${col}-"]`));
      const idx = cells.indexOf(el);
      activate(key === "ArrowDown" ? cells[idx + 1] : cells[idx - 1]);
    }
  }, []);

  const totals = useMemo(() => {
    let items = 0, cases = 0, amount = 0;
    for (const [id, qty] of Object.entries(quantities)) {
      if (!qty) continue;
      items += 1;
      cases += qty;
      const it = allItems.find(i => String(i.id) === id);
      amount += qty * effectivePriceFor(it);
    }
    return { items, cases, amount };
  }, [quantities, allItems, effectivePriceFor]);

  const scrollTo = useCallback((id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const saveOrder = async () => {
    // Guard: every ordered line must have an explicit price (override or
    // item default). $0 is fine, but "no price at all" would produce a
    // blank invoice line — force the user to state their intent.
    const missing = [];
    for (const [id, qty] of Object.entries(quantities)) {
      if (!qty || qty <= 0) continue;
      const it = allItems.find(i => String(i.id) === id);
      if (!it) continue;
      const override = prices[id];
      const hasOverride = override !== undefined && override !== "";
      const hasDefault  = it.wholesale_case_price != null;
      if (!hasOverride && !hasDefault) missing.push(it);
    }
    if (missing.length > 0) {
      const list = missing
        .slice(0, 15)
        .map(it => `  • ${it.warehouse_location || "—"}  ${it.name}`)
        .join("\n");
      const more = missing.length > 15 ? `\n  … and ${missing.length - 15} more` : "";
      alert(
        `Can't save — ${missing.length} item${missing.length === 1 ? " needs" : "s need"} a case price:\n\n` +
        list + more +
        `\n\nEnter a price (or $0 if it's free) for each and try again.`
      );
      // Scroll the first offender into view + flash it briefly so it's easy to spot.
      const first = missing[0];
      const row = document.getElementById(`row-${first.id}`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.add("ring-2", "ring-red-500", "ring-inset");
        setTimeout(() => row.classList.remove("ring-2", "ring-red-500", "ring-inset"), 1800);
      }
      return;
    }

    setSubmitting(true);
    setSaveErr(null);
    try {
      // Denormalize the customer contact info onto the order so the invoice
      // stays historically stable if the customer row is edited later.
      const addressSnapshot = customer ? [
        customer.address_line1,
        customer.address_line2,
        [customer.city, customer.state, customer.postal_code].filter(Boolean).join(", ").replace(/, (\w{2}) /, ", $1 "),
      ].filter(Boolean).join("\n") : null;

      const payload = {
        status: "saved",
        customer_id: customer?.id || null,
        customer_name: customer?.business_name || customerName.trim() || null,
        customer_address: addressSnapshot,
        customer_phone: customer?.phone || null,
        customer_email: customer?.email || null,
        notes: orderNotes.trim() || null,
        total_amount: Number(totals.amount.toFixed(2)),
        updated_at: new Date().toISOString(),
      };

      let oid = orderId;
      if (oid) {
        await qry("wholesale_orders", { update: payload, match: { id: oid } });
        await qry("wholesale_order_items", { del: true, match: { order_id: oid } });
      } else {
        const [order] = await qry("wholesale_orders", {
          insert: { ...payload, created_by: "Store" },
        });
        oid = order.id;
        setOrderId(oid);
      }

      const ids = new Set([
        ...Object.keys(quantities),
        ...Object.keys(itemNotes).filter(k => itemNotes[k]?.trim()),
      ]);
      if (ids.size > 0) {
        const rows = [...ids].map(id => {
          const it = allItems.find(i => String(i.id) === id);
          const q = quantities[id] || 0;
          // Snapshot the effective case price (per-order override wins). Derive
          // unit price from case + case_size for the invoice math.
          const effectiveCase = effectivePriceFor(it);
          const cp = effectiveCase > 0 ? Number(effectiveCase.toFixed(2)) : null;
          const cs = it?.case_size ? Number(it.case_size) : null;
          const up = cp != null && cs ? Number((cp / cs).toFixed(4)) : null;
          return {
            order_id: oid,
            item_id: it?.id ?? null,
            item_name: it?.name || "Unknown",
            item_size: it?.size || null,
            case_size: cs,
            mfg_name: it?._mfg_name || null,
            warehouse_location: it?.warehouse_location || null,
            cases_ordered: q,
            unit_price: up,
            case_price: cp,
            line_total: q > 0 && cp != null ? Number((q * cp).toFixed(2)) : null,
            notes: itemNotes[id]?.trim() || null,
          };
        });
        // eslint-disable-next-line no-console
        console.log(`[wholesale] saving ${rows.length} line(s) for order #${oid}`, rows);
        await qry("wholesale_order_items", { insert: rows });
      }

      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
    } catch (err) {
      console.error("wholesale save failed:", err);
      setSaveErr(err.message || String(err));
      alert("Save failed: " + err.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full relative">
      {savedToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2 print:hidden">
          <span>✓</span><span>Order saved</span>
        </div>
      )}
      {(loadErr || saveErr) && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold max-w-2xl print:hidden">
          {loadErr && <div>Load failed: {loadErr}</div>}
          {saveErr && <div>Save failed: {saveErr}</div>}
        </div>
      )}

      {/* Print-only views. Only the one matching `printMode` is mounted, so
          `window.print()` (from the dropdown or Ctrl+P) picks it up. */}
      {printMode === "full" && (
        <WholesalePrintView
          sortMode={sortMode}
          locationGroups={visibleLocationGroups}
          typeGroups={visibleTypeGroups}
          unitMap={unitMap}
          quantities={quantities}
          prices={prices}
          orderId={orderId}
          scope={printScope} />
      )}
      {printMode === "pickList" && (
        <WholesalePickListPrintView
          items={allItems}
          sectionMap={sectionMap}
          quantities={quantities}
          itemNotes={itemNotes}
          unitMap={unitMap}
          orderId={orderId}
          customer={customer} />
      )}

      {/* Scope picker for the Item List print */}
      <Modal
        open={scopePickerOpen}
        onClose={() => setScopePickerOpen(false)}
        title="Which section?"
        size="sm"
        footer={
          <button className={btnGhost} onClick={() => setScopePickerOpen(false)}>Cancel</button>
        }>
        <p className="text-sm text-stone-500 mb-4">
          Print items from just one section, or all of them.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "all",     label: "All",     cls: "bg-stone-800 hover:bg-stone-900" },
            { id: "dry",     label: "Dry",     cls: "bg-amber-600 hover:bg-amber-700" },
            { id: "cooler",  label: "Cooler",  cls: "bg-blue-600 hover:bg-blue-700" },
            { id: "freezer", label: "Freezer", cls: "bg-green-600 hover:bg-green-700" },
          ].map(opt => (
            <button key={opt.id}
              onClick={() => {
                setPrintScope(opt.id);
                setScopePickerOpen(false);
                setPrintMode("full");
                requestAnimationFrame(() => window.print());
              }}
              className={`px-4 py-3 text-white rounded-lg text-sm font-bold transition-colors ${opt.cls}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </Modal>


      {/* Toolbar */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-2 print:hidden flex-wrap">
        <button onClick={() => onDone?.()} className="text-stone-500 hover:text-stone-800 text-sm shrink-0">← Back</button>
        <div className="shrink-0">
          <h2 className="text-base font-bold text-stone-800 leading-tight">
            {orderId ? `Invoice #${orderId}` : "New Wholesale Order"}
          </h2>
          {customer && (
            <div className="text-xs text-stone-500 truncate max-w-[260px]" title={customer.business_name}>
              For <span className="font-semibold text-amber-700">{customer.business_name}</span>
            </div>
          )}
        </div>

        <input type="text" placeholder="Search name, mfg, UPC..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 w-52 shrink-0" />

        {/* Sort mode toggle */}
        <div className="inline-flex rounded-lg overflow-hidden border border-stone-300 shrink-0">
          <button onClick={() => setSortMode("location")}
            className={`px-3 py-1.5 text-xs font-semibold ${sortMode === "location" ? "bg-amber-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
            By Location
          </button>
          <button onClick={() => setSortMode("deptcat")}
            className={`px-3 py-1.5 text-xs font-semibold ${sortMode === "deptcat" ? "bg-amber-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
            By Dept
          </button>
        </div>

        <div className="flex items-center gap-px shrink-0">
          <button onClick={() => setMfgLetter(null)}
            className={`px-1.5 h-7 text-[10px] font-bold rounded transition-colors ${mfgLetter === null ? "bg-amber-600 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
            All
          </button>
          {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map(L => {
            if (!availableLetters.has(L)) return null;
            const active = mfgLetter === L;
            return (
              <button key={L} onClick={() => setMfgLetter(active ? null : L)}
                className={`w-6 h-7 text-[10px] font-bold rounded transition-colors ${active ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                {L}
              </button>
            );
          })}
        </div>

        <button onClick={() => setOnlyOrdered(o => !o)} disabled={totals.items === 0}
          className={`px-3 h-7 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shrink-0 ${onlyOrdered ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>
          {onlyOrdered ? "Show All" : "Ordered Only"}
        </button>

        {/* Right cluster: totals + Print + Save. `ml-auto` keeps them right-aligned
            without a greedy `flex-1` spacer that misbehaves with flex-wrap. */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {totals.items > 0 && (
            <span className="text-sm text-amber-700 font-semibold">
              {totals.items} items / {totals.cases} cs / <span className="text-stone-800">{fmt$(totals.amount)}</span>
            </span>
          )}
          {/* Print dropdown: Invoice / Order Pick List / Full Item List */}
          <div className="relative">
            <button onClick={() => setPrintMenuOpen(o => !o)}
              className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded-lg text-sm hover:bg-stone-200">
              Print ▾
            </button>
            {printMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPrintMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
                  <button
                    disabled={!orderId || totals.items === 0 || generatingPdf}
                    onClick={async () => {
                      setPrintMenuOpen(false);
                      if (!orderId) return;
                      setGeneratingPdf(true);
                      try { await downloadWholesaleInvoice(orderId); }
                      catch (e) { alert(`Invoice PDF failed: ${e.message}`); }
                      setGeneratingPdf(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-700"
                    title={!orderId ? "Save the order first" : totals.items === 0 ? "Add at least one item" : ""}>
                    Invoice
                  </button>
                  <button
                    disabled={totals.items === 0}
                    onClick={() => {
                      setPrintMenuOpen(false);
                      setPrintMode("pickList");
                      requestAnimationFrame(() => window.print());
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-700"
                    title={totals.items === 0 ? "Add at least one item" : ""}>
                    Order Pick List
                  </button>
                  <div className="border-t border-stone-100 my-1" />
                  <button
                    onClick={() => {
                      setPrintMenuOpen(false);
                      setScopePickerOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-amber-50 hover:text-amber-800">
                    Item List
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={saveOrder} disabled={submitting}
            className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
            {submitting ? "..." : "Save Order"}
          </button>
        </div>
      </div>

      {/* Body: TOC + content */}
      <div className="flex-1 overflow-hidden bg-white flex">
        {/* TOC */}
        <div className={`shrink-0 ${tocOpen ? "w-44" : "w-9"} border-r border-stone-200 bg-stone-50 print:hidden flex flex-col transition-[width] duration-150`}>
          <button onClick={() => setTocOpen(o => !o)}
            className={`flex items-center px-2 py-2 hover:bg-stone-200 border-b border-stone-200 w-full ${tocOpen ? "justify-between" : "justify-center"}`}
            title={tocOpen ? "Collapse" : "Show table of contents"}>
            {tocOpen && <span className="text-[10px] uppercase font-bold tracking-wide text-stone-500">Jump to</span>}
            <span className="text-amber-600 font-black text-xl leading-none">{tocOpen ? "«" : "»"}</span>
          </button>
          {tocOpen && (
            <div className="flex-1 overflow-auto py-1">
              {sortMode === "location" && visibleLocationGroups.map(g => {
                // For "Section X" buckets, generate aisle sub-buttons at
                // AISLE_INTERVAL steps — but only when at least one item in
                // this group sits at or past the milestone.
                const milestones = milestonesForSection(g.key);
                const jumpTargets = milestones
                  .map(m => ({ m, item: g.items.find(i => (locNumOf(i.warehouse_location) ?? -1) >= m) }))
                  .filter(x => x.item);
                return (
                  <div key={g.key} className="mb-1">
                    <button onClick={() => scrollTo(`grp-${slug(g.key)}`)}
                      className="w-full text-left px-3 py-1 text-xs font-bold text-stone-700 hover:bg-stone-200 flex justify-between items-center">
                      <span className="truncate">{g.key}</span>
                      <span className="text-stone-400 shrink-0 ml-2 font-normal">{g.items.length}</span>
                    </button>
                    {jumpTargets.map(({ m, item }) => (
                      <button key={m} onClick={() => scrollTo(`row-${item.id}`)}
                        className="w-full text-left pl-6 pr-3 py-0.5 text-[11px] text-stone-500 hover:bg-stone-200">
                        → {m}
                      </button>
                    ))}
                  </div>
                );
              })}
              {sortMode === "deptcat" && visibleTypeGroups.map(tg => {
                const td = TYPE_DISPLAY[tg.type];
                return (
                  <div key={tg.type} className="mb-2">
                    <button onClick={() => scrollTo(`type-${tg.type}`)}
                      className={`w-full text-left px-2 py-1 text-xs font-bold uppercase tracking-wide ${td.text} ${td.hover} flex justify-between items-center`}>
                      <span>{td.label}</span>
                      <span className="text-stone-400 font-normal">{tg.count}</span>
                    </button>
                    {tg.depts.map(d => (
                      <button key={d.dept} onClick={() => scrollTo(`dept-${tg.type}-${slug(d.dept)}`)}
                        className="w-full text-left px-3 py-0.5 text-[11px] text-stone-600 hover:bg-stone-200 truncate flex justify-between items-center gap-2">
                        <span className="truncate">{d.dept}</span>
                        <span className="text-stone-400 shrink-0">{d.items.length}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto print:overflow-visible">
          {loading ? (
            <div className="p-8 text-center text-stone-400">Loading items...</div>
          ) : !hasAnyGroup ? (
            <div className="p-12 text-center text-stone-400">
              {search || mfgLetter || onlyOrdered ? "No items match your filters." : "No items in the system."}
            </div>
          ) : sortMode === "location" ? (
            <div className="print:hidden">
              {visibleLocationGroups.map(g => (
                <div key={g.key} id={`grp-${slug(g.key)}`}>
                  <div className="bg-stone-800 text-white px-3 py-2 text-sm font-black uppercase tracking-widest flex justify-between items-center sticky top-0 z-10">
                    <span>{g.key}</span>
                    <span className="text-white/60 text-xs font-normal">{g.items.length} items</span>
                  </div>
                  <ColumnHeader mfgW={mfgW} descW={descW} />
                  {g.items.map((item, ii) => (
                    <WholesaleItemRow key={item.id}
                      item={item} ii={ii}
                      qty={quantities[String(item.id)]}
                      note={itemNotes[String(item.id)]}
                      priceOverride={prices[String(item.id)]}
                      mfgW={mfgW} descW={descW} unitMap={unitMap}
                      readOnly={false}
                      setQty={setQty} setNote={setNote} setPrice={setPrice}
                      handleGridNav={handleGridNav} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="print:hidden">
              {visibleTypeGroups.map(tg => {
                const td = TYPE_DISPLAY[tg.type];
                return (
                  <div key={tg.type} id={`type-${tg.type}`}>
                    <div className={`${td.banner} text-white px-3 py-2 text-sm font-black uppercase tracking-widest flex justify-between items-center`}>
                      <span>{td.label}</span>
                      <span className="text-white/70 text-xs font-normal">{tg.count} items</span>
                    </div>
                    {tg.depts.map(group => (
                      <div key={group.dept} id={`dept-${tg.type}-${slug(group.dept)}`}>
                        <div className="bg-stone-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider sticky top-0 z-10 flex gap-2">
                          <span className="text-amber-400">{group.dept}</span>
                          <span className="text-stone-400 ml-auto">{group.items.length}</span>
                        </div>
                        <ColumnHeader mfgW={mfgW} descW={descW} />
                        {group.items.map((item, ii) => (
                          <WholesaleItemRow key={item.id}
                            item={item} ii={ii}
                            qty={quantities[String(item.id)]}
                            note={itemNotes[String(item.id)]}
                            mfgW={mfgW} descW={descW} unitMap={unitMap}
                            readOnly={false}
                            setQty={setQty} setNote={setNote}
                            handleGridNav={handleGridNav} />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List of existing wholesale orders ────────────────────────────────

export default function WholesaleOrders({ data }) {
  // View states:
  //   "list"                             — index of orders
  //   { customer }                       — new order for the picked customer
  //   { id }                             — editing an existing order (loads its customer)
  const [view, setView] = useState("list");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    qry("wholesale_orders", {
      select: "id,status,customer_name,notes,total_amount,created_at,invoiced_at",
      order: "created_at.desc",
      limit: 500,
    }).then(setOrders).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteOrder = async (id) => {
    if (!confirm(`Delete Invoice #${id}? This cannot be undone.`)) return;
    try {
      await qry("wholesale_order_items", { del: true, match: { order_id: id } });
      await qry("wholesale_orders",      { del: true, match: { id } });
      load();
    } catch (err) { alert("Delete failed: " + err.message); }
  };

  if (typeof view === "object" && view !== null) {
    return <WholesaleOrderForm data={data}
      orderId={view.id || null}
      initialCustomer={view.customer || null}
      onDone={() => { setView("list"); load(); }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-800">Wholesale Orders</h2>
        <button onClick={() => setPickerOpen(true)}
          className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
          + Create New Wholesale Order
        </button>
      </div>

      {pickerOpen && (
        <CustomerPickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={(customer) => { setPickerOpen(false); setView({ customer }); }} />
      )}

      <div className="flex-1 overflow-auto bg-stone-50">
        {loading && orders.length === 0 ? (
          <div className="p-8 text-center text-stone-400">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-4xl mb-2">🧾</p>
            <p className="text-stone-500 text-sm">No wholesale orders yet</p>
            <p className="text-stone-400 text-xs mt-1">Click "Create New Wholesale Order" to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {orders.map(o => (
              <div key={o.id}
                className="px-4 py-3 bg-white hover:bg-stone-50 transition-colors grid items-center gap-3 cursor-pointer"
                style={{ gridTemplateColumns: "100px 1fr 120px 130px auto" }}
                onClick={() => setView({ id: o.id })}>
                <div className="text-sm font-bold text-stone-800">Invoice #{o.id}</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-800 truncate">
                    {o.customer_name || <span className="italic text-stone-400">No customer</span>}
                  </div>
                  <div className="text-xs text-stone-400 truncate">
                    {new Date(o.created_at).toLocaleString()}
                    {o.notes && ` — ${o.notes}`}
                  </div>
                </div>
                <div className="text-sm font-bold text-stone-800 tabular-nums">
                  {o.total_amount != null ? fmt$(o.total_amount) : "—"}
                </div>
                <div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    o.status === "invoiced" ? "bg-green-100 text-green-800 border-green-200" :
                    o.status === "saved"    ? "bg-blue-100 text-blue-800 border-blue-200" :
                                              "bg-amber-100 text-amber-800 border-amber-200"
                  }`}>
                    {o.status === "invoiced" ? "Invoiced" : o.status === "saved" ? "Saved" : "Draft"}
                  </span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteOrder(o.id); }}
                  className="text-stone-300 hover:text-red-500 transition-colors text-sm shrink-0" title="Delete">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
