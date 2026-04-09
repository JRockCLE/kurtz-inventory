import { useState, useEffect, useCallback } from "react";

const SB_URL = "https://veqsqzzymxjniagodkey.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcXNxenp5bXhqbmlhZ29ka2V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ5NDIxOCwiZXhwIjoyMDkxMDcwMjE4fQ.05MhQ5FB1jEV05f435JhTMn61yEWmzPU22add0tBP64";

const sbH = (schema = "public") => ({
  apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
  "Accept-Profile": schema, "Content-Profile": schema,
  "Content-Type": "application/json", Prefer: "return=representation",
});

// ─── Generic query helper ───
export async function qry(table, { schema = "public", select, filters, order, insert, update, match, limit, del } = {}) {
  let url = `${SB_URL}/rest/v1/${table}`;
  const p = [];
  if (select) p.push(`select=${encodeURIComponent(select)}`);
  if (filters) p.push(filters);
  if (order) p.push(`order=${order}`);
  if (limit) p.push(`limit=${limit}`);
  if (match && (update || del)) p.push(...Object.entries(match).map(([k, v]) => `${k}=eq.${v}`));
  if (p.length) url += `?${p.join("&")}`;
  const opts = { headers: sbH(schema) };
  if (insert) { opts.method = "POST"; opts.body = JSON.stringify(insert); }
  else if (update) { opts.method = "PATCH"; opts.body = JSON.stringify(update); }
  else if (del) { opts.method = "DELETE"; }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (del) return null;
  return res.json();
}

// ─── Barcode lookup against StoreLIVE ───
export async function lookupBarcode(barcode) {
  if (!barcode || barcode.length < 3) return null;

  // Query v_items view (has all fields including unit and sub-category)
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/v_items?UPC_TX=eq.${encodeURIComponent(barcode)}&select=Item_ID,Name_TX,Store_Name_TX,Size_TX,Mfg_ID,Mfg_Name,Category_ID,Category_Name,Dept_ID,Dept_Name,Sub_Category_ID,Price,Ref_Unit_CD,Unit_Name&limit=1`,
      { headers: sbH("posbe") }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.length > 0) {
        const r = data[0];
        // Resolve sub-category name if we have an ID
        let subCatName = null;
        if (r.Sub_Category_ID && r.Sub_Category_ID > 0) {
          try {
            const sc = await fetch(
              `${SB_URL}/rest/v1/Sub_Category?Sub_Category_ID=eq.${r.Sub_Category_ID}&select=Name_TX&limit=1`,
              { headers: sbH("posbe") }
            );
            if (sc.ok) { const scd = await sc.json(); if (scd.length) subCatName = scd[0].Name_TX; }
          } catch { /* ignore */ }
        }
        return {
          item_id: r.Item_ID, name: r.Name_TX, store_name: r.Store_Name_TX,
          size: r.Size_TX, mfg_id: r.Mfg_ID, mfg_name: r.Mfg_Name,
          category_id: r.Category_ID, category_name: r.Category_Name,
          dept_id: r.Dept_ID, dept_name: r.Dept_Name,
          sub_category_id: r.Sub_Category_ID || null, sub_category_name: subCatName,
          price: r.Price,
          unit_cd: r.Ref_Unit_CD || null, unit_name: r.Unit_Name || null, source: "posbe",
        };
      }
    }
  } catch (e) { console.error("Fallback lookup failed:", e); }

  return null;
}

// ─── Check if barcode already exists in OUR system (returns ALL matches) ───
export async function checkBarcodeInSystem(barcode) {
  if (!barcode || barcode.length < 3) return [];
  try {
    const items = await qry("local_items", {
      select: "id,name,size,upc,warehouse_location,cases_on_hand,expiration_date,case_size,retail_price,mfg_id,cost,dept_id,category_id,sub_category_id",
      filters: `upc=eq.${encodeURIComponent(barcode)}&active_yn=eq.Y`,
      order: "name.asc",
      limit: 50,
    });
    // Fetch locations for each matched item
    if (items.length > 0) {
      const ids = items.map(i => i.id).join(",");
      const locs = await qry("local_item_locations", {
        select: "local_item_id,location,is_primary",
        filters: `local_item_id=in.(${ids})`,
        order: "is_primary.desc,location.asc",
      });
      const locMap = {};
      locs.forEach(l => {
        if (!locMap[l.local_item_id]) locMap[l.local_item_id] = [];
        locMap[l.local_item_id].push(l);
      });
      items.forEach(i => { i._locations = locMap[i.id] || []; });

      // Resolve reference names (mfg, dept, category, sub_category)
      const uniqueIds = (field) => [...new Set(items.map(i => i[field]).filter(Boolean))];

      const mfgIds = uniqueIds("mfg_id");
      const deptIds = uniqueIds("dept_id");
      const catIds = uniqueIds("category_id");
      const subCatIds = uniqueIds("sub_category_id");

      const [mfgs, depts, cats, subCats] = await Promise.all([
        mfgIds.length ? fetch(`${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`, { headers: sbH("posbe") }).then(r => r.json()).catch(() => []) : [],
        deptIds.length ? fetch(`${SB_URL}/rest/v1/Dept?Dept_ID=in.(${deptIds.join(",")})&select=Dept_ID,Name_TX`, { headers: sbH("posbe") }).then(r => r.json()).catch(() => []) : [],
        catIds.length ? fetch(`${SB_URL}/rest/v1/Category?Category_ID=in.(${catIds.join(",")})&select=Category_ID,Name_TX`, { headers: sbH("posbe") }).then(r => r.json()).catch(() => []) : [],
        subCatIds.length ? fetch(`${SB_URL}/rest/v1/Sub_Category?Sub_Category_ID=in.(${subCatIds.join(",")})&select=Sub_Category_ID,Name_TX`, { headers: sbH("posbe") }).then(r => r.json()).catch(() => []) : [],
      ]);

      const mfgMap = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
      const deptMap = Object.fromEntries(depts.map(d => [String(d.Dept_ID), d.Name_TX]));
      const catMap = Object.fromEntries(cats.map(c => [String(c.Category_ID), c.Name_TX]));
      const subCatMap = Object.fromEntries(subCats.map(s => [String(s.Sub_Category_ID), s.Name_TX]));

      items.forEach(i => {
        i._mfg_name = mfgMap[String(i.mfg_id)] || "";
        i._dept_name = deptMap[String(i.dept_id)] || "";
        i._category_name = catMap[String(i.category_id)] || "";
        i._sub_category_name = subCatMap[String(i.sub_category_id)] || "";
      });
    }
    return items;
  } catch (err) { console.error("useLocalItems error:", err); return []; }
}

// ─── Item location helpers ───
export async function addItemLocation(localItemId, location, isPrimary = false) {
  return qry("local_item_locations", {
    insert: { local_item_id: localItemId, location, is_primary: isPrimary },
  });
}

export async function getItemLocations(localItemId) {
  return qry("local_item_locations", {
    select: "id,location,is_primary",
    filters: `local_item_id=eq.${localItemId}`,
    order: "is_primary.desc,location.asc",
  });
}

export async function setPrimaryLocation(locationRowId) {
  // The DB trigger handles unsetting the old primary
  return qry("local_item_locations", {
    update: { is_primary: true, updated_at: new Date().toISOString() },
    match: { id: locationRowId },
  });
}

// ─── Vendor search (for manufacturer typeahead) ───
export async function searchVendors(typed) {
  const filter = typed ? `Vendor_Name_TX=ilike.*${encodeURIComponent(typed)}*&` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/Vendor?${filter}Activ_YN=eq.Y&select=Vendor_ID,Vendor_Name_TX&order=Vendor_Name_TX.asc&limit=50`,
    { headers: sbH("posbe") }
  );
  if (!res.ok) return [];
  return (await res.json()).map(v => ({ value: v.Vendor_ID, label: v.Vendor_Name_TX }));
}

// ─── Reference data (small tables for dropdowns) ───
export function useRefData() {
  const [d, setD] = useState({ categories: [], depts: [], vendors: [], units: [], loading: true });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    setD(prev => ({ ...prev, loading: true }));
    Promise.all([
      qry("Category", { schema: "posbe", select: "Category_ID,Dept_ID,Name_TX", filters: "Activ_YN=eq.Y", order: "Name_TX.asc", limit: 5000 }),
      qry("Dept", { schema: "posbe", select: "Dept_ID,Name_TX", filters: "Activ_YN=eq.Y", order: "Name_TX.asc", limit: 1000 }),
      qry("Vendor", { schema: "posbe", select: "Vendor_ID,Vendor_Name_TX", filters: "Activ_YN=eq.Y", order: "Vendor_Name_TX.asc", limit: 50000 }),
      qry("Ref_Units", { schema: "posbe", select: "Unit_ID,Unit_Name_TX", filters: "Activ_YN=eq.Y", order: "Unit_Name_TX.asc", limit: 500 }),
    ]).then(([cats, depts, vendors, units]) => {
      setD({ categories: cats, depts, vendors, units, loading: false });
    }).catch(err => { console.error(err); setD(prev => ({ ...prev, loading: false })); });
  }, [tick]);
  return { ...d, refresh };
}

// ─── Local Items (what's in OUR system) ───
export function useLocalItems({ search = "", sortBy = "name", sortDir = "asc", page = 0, colFilters = {}, refreshTick = 0 } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const PAGE_SIZE = 100;
  const cfKey = JSON.stringify(colFilters);

  useEffect(() => {
    setLoading(true);
    const filters = ["active_yn=eq.Y"];
    const cf = colFilters || {};

    if (search) filters.push(`or=(name.ilike.*${search}*,upc.ilike.*${search}*)`);
    if (cf.upc) filters.push(`upc=ilike.*${cf.upc}*`);
    if (cf.name) filters.push(`name=ilike.*${cf.name}*`);
    if (cf.size) filters.push(`size=ilike.*${cf.size}*`);
    if (cf.warehouse_location) filters.push(`warehouse_location=ilike.*${cf.warehouse_location}*`);

    const filterStr = filters.join("&");
    const order = `${sortBy}.${sortDir}.nullslast`;
    const offset = page * PAGE_SIZE;

    fetch(`${SB_URL}/rest/v1/local_items?${filterStr}&order=${order}`, {
      headers: { ...sbH("public"), Prefer: "count=exact", Range: `${offset}-${offset + PAGE_SIZE - 1}` },
    }).then(async res => {
      const range = res.headers.get("content-range");
      if (range) { const t = parseInt(range.split("/")[1]); if (!isNaN(t)) setTotal(t); }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      // Resolve mfg names for this page of items
      const mfgIds = [...new Set(list.map(i => i.mfg_id).filter(Boolean))];
      if (mfgIds.length) {
        try {
          const mfgs = await fetch(
            `${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`,
            { headers: sbH("posbe") }
          ).then(r => r.json());
          const mfgMap = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
          list.forEach(i => { i._mfg_name = mfgMap[String(i.mfg_id)] || ""; });
        } catch {}
      }

      setItems(list);
    }).catch(err => { console.error(err); setItems([]); })
      .finally(() => setLoading(false));
  }, [search, sortBy, sortDir, page, cfKey, refreshTick]);

  return { items, total, loading, pageSize: PAGE_SIZE };
}

// ─── Orders ───
export function useOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    qry("store_orders", { select: "*", filters: "status=neq.draft", order: "created_at.desc", limit: 500 })
      .then(setOrders).catch(console.error).finally(() => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { orders, loading, refresh };
}

// ─── Fetch all local items for Store Needs print ───
export async function fetchItemsForNeeds() {
  const allItems = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const res = await fetch(
      `${SB_URL}/rest/v1/local_items?active_yn=eq.Y&select=id,name,size,upc,retail_price,cases_on_hand,warehouse_location,store_location,expiration_date,dept_id,category_id,mfg_id,case_size,ref_unit_cd&order=store_location.asc.nullslast,name.asc`,
      { headers: { ...sbH("public"), Range: `${offset}-${offset + batchSize - 1}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allItems.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  // Resolve mfg names
  const mfgIds = [...new Set(allItems.map(i => i.mfg_id).filter(Boolean))];
  if (mfgIds.length) {
    try {
      const mfgs = await fetch(
        `${SB_URL}/rest/v1/Vendor?Vendor_ID=in.(${mfgIds.join(",")})&select=Vendor_ID,Vendor_Name_TX`,
        { headers: sbH("posbe") }
      ).then(r => r.json());
      const mfgMap = Object.fromEntries(mfgs.map(m => [String(m.Vendor_ID), m.Vendor_Name_TX]));
      allItems.forEach(i => { i._mfg_name = mfgMap[String(i.mfg_id)] || ""; });
    } catch {}
  }
  return allItems;
}

// ─── Department search ───
export async function searchDepts(typed) {
  const filter = typed ? `Name_TX=ilike.*${encodeURIComponent(typed)}*&` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/Dept?${filter}Activ_YN=eq.Y&select=Dept_ID,Name_TX&order=Name_TX.asc&limit=50`,
    { headers: sbH("posbe") }
  );
  if (!res.ok) return [];
  return (await res.json()).map(d => ({ value: d.Dept_ID, label: d.Name_TX }));
}

// ─── Category search (filtered by dept) ───
export async function searchCategories(typed, deptId) {
  const filter = typed ? `Name_TX=ilike.*${encodeURIComponent(typed)}*&` : "";
  const deptFilter = deptId ? `&Dept_ID=eq.${deptId}` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/Category?${filter}Activ_YN=eq.Y${deptFilter}&select=Category_ID,Dept_ID,Name_TX&order=Name_TX.asc&limit=50`,
    { headers: sbH("posbe") }
  );
  if (!res.ok) return [];
  return (await res.json()).map(c => ({ value: c.Category_ID, label: c.Name_TX, deptId: c.Dept_ID }));
}

// ─── Subcategory search (filtered by category) ───
export async function searchSubCategories(typed, categoryId) {
  const filter = typed ? `Name_TX=ilike.*${encodeURIComponent(typed)}*&` : "";
  const catFilter = categoryId ? `&Category_ID=eq.${categoryId}` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/Sub_Category?${filter}Activ_YN=eq.Y${catFilter}&select=Sub_Category_ID,Category_ID,Name_TX&order=Name_TX.asc&limit=50`,
    { headers: sbH("posbe") }
  );
  if (!res.ok) return [];
  return (await res.json()).map(s => ({ value: s.Sub_Category_ID, label: s.Name_TX }));
}

// ─── Unit of measure search (Ref_Units from posbe) ───
export async function searchUnits(typed) {
  const filter = typed ? `Unit_Name_TX=ilike.*${encodeURIComponent(typed)}*&` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/Ref_Units?${filter}Activ_YN=eq.Y&select=Unit_ID,Unit_Name_TX&order=Unit_Name_TX.asc&limit=50`,
    { headers: sbH("posbe") }
  );
  if (!res.ok) return [];
  return (await res.json()).map(u => ({ value: u.Unit_ID, label: u.Unit_Name_TX }));
}

// ─── Location fuzzy search ───
export async function searchLocations(typed) {
  const filter = typed ? `label=ilike.*${typed}*&` : "";
  const data = await qry("warehouse_locations", {
    select: "id,label,section,aisle",
    filters: `${filter}active_yn=eq.Y`,
    limit: 100,
  });
  // Natural sort so 2A < 13A
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  data.sort((a, b) => collator.compare(a.label || "", b.label || ""));
  const ctx = (l) => [l.section, l.aisle].filter(Boolean).join(" / ");
  return data.map(l => ({ value: l.label, label: l.label + (ctx(l) ? `  —  ${ctx(l)}` : "") }));
}
