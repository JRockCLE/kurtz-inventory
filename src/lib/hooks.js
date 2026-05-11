import { useState, useEffect, useCallback } from "react";

export const SB_URL = "https://veqsqzzymxjniagodkey.supabase.co";
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcXNxenp5bXhqbmlhZ29ka2V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ5NDIxOCwiZXhwIjoyMDkxMDcwMjE4fQ.05MhQ5FB1jEV05f435JhTMn61yEWmzPU22add0tBP64";

export async function uploadPhoto(file, upc) {
  const ext = file.name?.split(".").pop() || "jpg";
  const path = `${upc}/${Date.now()}.${ext}`;
  const res = await fetch(`${SB_URL}/storage/v1/object/product-photos/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  return `${SB_URL}/storage/v1/object/public/product-photos/${path}`;
}

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
// Reads posbe."UPC" + posbe."Item" + related tables directly. The denormalized
// posbe.v_items table is populated by the mini-PC sync engine on a delay (and
// sometimes silently drops new items), so going to the source tables makes
// brand-new items findable the moment UPC+Item rows land.
export async function lookupBarcode(barcode) {
  if (!barcode || barcode.length < 3) return null;
  const h = sbH("posbe");

  try {
    const upcRows = await fetch(
      `${SB_URL}/rest/v1/UPC?UPC_TX=eq.${encodeURIComponent(barcode)}&Activ_YN=eq.Y&select=Item_ID,Primary_YN&order=Primary_YN.desc&limit=1`,
      { headers: h }
    ).then(r => r.ok ? r.json() : []);
    if (!upcRows.length) return null;
    const itemId = upcRows[0].Item_ID;

    const itemRows = await fetch(
      `${SB_URL}/rest/v1/Item?Item_ID=eq.${itemId}&Activ_YN=eq.Y&select=Item_ID,Name_TX,Store_Name_TX,Size_TX,Category_ID,Sub_Category_ID,Mfg_ID,Ref_Unit_CD&limit=1`,
      { headers: h }
    ).then(r => r.ok ? r.json() : []);
    if (!itemRows.length) return null;
    const it = itemRows[0];

    const fetchJson = (url) => fetch(url, { headers: h }).then(r => r.ok ? r.json() : []).catch(() => []);

    const [cats, mfgs, subCats, units, prices] = await Promise.all([
      it.Category_ID
        ? fetchJson(`${SB_URL}/rest/v1/Category?Category_ID=eq.${it.Category_ID}&select=Category_ID,Dept_ID,Name_TX&limit=1`)
        : Promise.resolve([]),
      it.Mfg_ID
        ? fetchJson(`${SB_URL}/rest/v1/Vendor?Vendor_ID=eq.${it.Mfg_ID}&select=Vendor_ID,Vendor_Name_TX&limit=1`)
        : Promise.resolve([]),
      it.Sub_Category_ID && it.Sub_Category_ID > 0
        ? fetchJson(`${SB_URL}/rest/v1/Sub_Category?Sub_Category_ID=eq.${it.Sub_Category_ID}&select=Name_TX&limit=1`)
        : Promise.resolve([]),
      it.Ref_Unit_CD
        ? fetchJson(`${SB_URL}/rest/v1/Ref_Units?Unit_ID=eq.${it.Ref_Unit_CD}&select=Unit_ID,Unit_Name_TX&limit=1`)
        : Promise.resolve([]),
      fetchJson(`${SB_URL}/rest/v1/Price?Item_ID=eq.${itemId}&Activ_YN=eq.Y&Ref_Price_CD=eq.SLPRC&End_Time_DT=is.null&select=Amnt_NR,Start_Time_DT&order=Start_Time_DT.desc&limit=1`),
    ]);

    const cat = cats[0] || null;
    const deptId = cat?.Dept_ID || null;
    let deptName = null;
    if (deptId) {
      const d = await fetchJson(`${SB_URL}/rest/v1/Dept?Dept_ID=eq.${deptId}&select=Name_TX&limit=1`);
      deptName = d[0]?.Name_TX || null;
    }

    return {
      item_id: it.Item_ID,
      name: it.Name_TX,
      store_name: it.Store_Name_TX,
      size: it.Size_TX,
      mfg_id: it.Mfg_ID,
      mfg_name: mfgs[0]?.Vendor_Name_TX || null,
      category_id: it.Category_ID,
      category_name: cat?.Name_TX || null,
      dept_id: deptId,
      dept_name: deptName,
      sub_category_id: it.Sub_Category_ID && it.Sub_Category_ID > 0 ? it.Sub_Category_ID : null,
      sub_category_name: subCats[0]?.Name_TX || null,
      price: prices[0]?.Amnt_NR ?? null,
      unit_cd: it.Ref_Unit_CD || null,
      unit_name: units[0]?.Unit_Name_TX || null,
      source: "posbe",
    };
  } catch (e) {
    console.error("lookupBarcode failed:", e);
    return null;
  }
}

// ─── Check if barcode already exists in OUR system (returns ALL matches) ───
export async function checkBarcodeInSystem(barcode) {
  if (!barcode || barcode.length < 3) return [];
  try {
    const items = await qry("local_items", {
      select: "id,name,size,upc,warehouse_location,cases_on_hand,expiration_date,case_size,retail_price,mfg_id,cost,dept_id,category_id,sub_category_id,photos,default_photo,product_type",
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
export async function addItemLocation(localItemId, location, isPrimary = false, sortOrder = 0) {
  return qry("local_item_locations", {
    insert: { local_item_id: localItemId, location, is_primary: isPrimary, sort_order: sortOrder },
  });
}

export async function getItemLocations(localItemId) {
  return qry("local_item_locations", {
    select: "id,location,is_primary,sort_order",
    filters: `local_item_id=eq.${localItemId}`,
    order: "sort_order.asc,is_primary.desc,location.asc",
  });
}

export async function setPrimaryLocation(locationRowId) {
  // The DB trigger handles unsetting the old primary
  return qry("local_item_locations", {
    update: { is_primary: true, updated_at: new Date().toISOString() },
    match: { id: locationRowId },
  });
}

export async function removeItemLocation(locationRowId) {
  return qry("local_item_locations", { del: true, match: { id: locationRowId } });
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
export function useLocalItems({ search = "", sortBy = "name", sortDir = "asc", page = 0, colFilters = {}, productType = null, refreshTick = 0 } = {}) {
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
    if (productType) filters.push(`product_type=eq.${productType}`);

    const filterStr = filters.join("&");
    const needsNaturalSort = sortBy === "warehouse_location";
    const order = needsNaturalSort ? "name.asc" : `${sortBy}.${sortDir}.nullslast`;
    const offset = page * PAGE_SIZE;

    // For warehouse_location sort, fetch all items so we can natural-sort across pages
    const fetchHeaders = { ...sbH("public"), Prefer: "count=exact" };
    if (!needsNaturalSort) fetchHeaders.Range = `${offset}-${offset + PAGE_SIZE - 1}`;

    fetch(`${SB_URL}/rest/v1/local_items?${filterStr}&order=${order}`, {
      headers: fetchHeaders,
    }).then(async res => {
      const range = res.headers.get("content-range");
      if (range) { const t = parseInt(range.split("/")[1]); if (!isNaN(t)) setTotal(t); }
      let data = await res.json();
      if (!Array.isArray(data)) data = [];

      // Prefix-aware sort + client-side pagination for warehouse_location
      if (needsNaturalSort) {
        const splitLoc = (s) => {
          if (s == null) return null;
          const v = String(s);
          if (v.length >= 2 && v[1] === "-" && /[A-Za-z]/.test(v[0])) return { prefix: v[0].toUpperCase(), rest: v.slice(2) };
          return { prefix: "", rest: v };
        };
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        data.sort((a, b) => {
          const sa = splitLoc(a.warehouse_location), sb = splitLoc(b.warehouse_location);
          if (sa == null && sb == null) return 0;
          if (sa == null) return 1;
          if (sb == null) return -1;
          if (sa.prefix !== sb.prefix) return sa.prefix.localeCompare(sb.prefix);
          return collator.compare(sa.rest, sb.rest);
        });
        if (sortDir === "desc") data.reverse();
        setTotal(data.length);
        data = data.slice(offset, offset + PAGE_SIZE);
      }

      const list = data;

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
  }, [search, sortBy, sortDir, page, cfKey, productType, refreshTick]);

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

// ─── For each order id, return "dry" | "cooler" | "freezer" | "mixed" ───
export async function fetchOrderTypes(orderIds) {
  if (!orderIds.length) return {};
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "public" };
  const all = [];
  const batch = 1000;
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SB_URL}/rest/v1/store_order_items?order_id=in.(${orderIds.join(",")})&select=order_id,item_id`,
      { headers: { ...headers, Range: `${offset}-${offset + batch - 1}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < batch) break;
    offset += batch;
  }
  const itemIds = [...new Set(all.map(r => r.item_id).filter(Boolean))];
  let typeById = {};
  if (itemIds.length) {
    const items = await qry("local_items", {
      select: "id,product_type",
      filters: `id=in.(${itemIds.join(",")})`,
    });
    typeById = Object.fromEntries(items.map(i => [i.id, i.product_type]));
  }
  const setsByOrder = {};
  all.forEach(r => {
    const t = typeById[r.item_id];
    if (!t) return;
    if (!setsByOrder[r.order_id]) setsByOrder[r.order_id] = new Set();
    setsByOrder[r.order_id].add(t);
  });
  const summary = {};
  Object.keys(setsByOrder).forEach(oid => {
    const types = [...setsByOrder[oid]];
    summary[oid] = types.length > 1 ? "mixed" : types[0];
  });
  return summary;
}

// ─── Fetch all local items for Store Needs print ───
export async function fetchItemsForNeeds() {
  const allItems = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const res = await fetch(
      `${SB_URL}/rest/v1/local_items?active_yn=eq.Y&select=id,name,size,upc,retail_price,cases_on_hand,warehouse_location,store_location,expiration_date,dept_id,category_id,mfg_id,case_size,ref_unit_cd,product_type&order=store_location.asc.nullslast,name.asc`,
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
  // Prefix-aware natural sort so dry/cooler/freezer group, and 2A < 13A within each
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const split = (s) => {
    const v = String(s || "");
    if (v.length >= 2 && v[1] === "-" && /[A-Za-z]/.test(v[0])) return [v[0].toUpperCase(), v.slice(2)];
    return ["", v];
  };
  data.sort((a, b) => {
    const [pa, ra] = split(a.label), [pb, rb] = split(b.label);
    return pa.localeCompare(pb) || collator.compare(ra, rb);
  });
  const ctx = (l) => [l.section, l.aisle].filter(Boolean).join(" / ");
  return data.map(l => ({ value: l.label, label: l.label + (ctx(l) ? `  —  ${ctx(l)}` : "") }));
}
