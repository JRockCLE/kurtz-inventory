// ═══════════════════════════════════════════════════════════════════
//  Scans API
//
//  All Supabase calls for the Scan Hub. Follows the same patterns as
//  lib/hooks.js (uses SB_URL, SB_KEY directly, REST + storage HTTP).
//
//  Storage layout:
//    scans/{scanId}/page-001.jpg
//    scans/{scanId}/page-002.jpg
//    ...
// ═══════════════════════════════════════════════════════════════════

import { SB_URL, SB_KEY } from "./supabase";

const restH = () => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
});

const storageH = (contentType) => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  ...(contentType ? { "Content-Type": contentType } : {}),
});

// ─── Helpers ────────────────────────────────────────────────────────

function base64ToBlob(b64, mime = "image/jpeg") {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const pad3 = (n) => String(n).padStart(3, "0");
const pagePath = (scanId, pageNum) => `${scanId}/page-${pad3(pageNum)}.jpg`;

// ─── Public API ─────────────────────────────────────────────────────

export const scansApi = {
  /** List scans (most recent first), excluding archived/deleted */
  async list({ limit = 100, includeArchived = false } = {}) {
    const archivedFilter = includeArchived ? "" : "&archived=eq.false";
    const url = `${SB_URL}/rest/v1/scans?select=*&deleted_at=is.null${archivedFilter}&order=created_at.desc&limit=${limit}`;
    const res = await fetch(url, { headers: restH() });
    if (!res.ok) throw new Error(`scans list failed: ${res.status}`);
    return res.json();
  },

  /** Get a single scan with its pages */
  async get(scanId) {
    const [scanRes, pagesRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/scans?id=eq.${scanId}&select=*`, { headers: restH() }),
      fetch(`${SB_URL}/rest/v1/scan_pages?scan_id=eq.${scanId}&select=*&order=page_number.asc`, { headers: restH() }),
    ]);
    if (!scanRes.ok) throw new Error(`scan get failed: ${scanRes.status}`);
    if (!pagesRes.ok) throw new Error(`scan pages get failed: ${pagesRes.status}`);
    const scan = (await scanRes.json())[0];
    if (!scan) return null;
    const pages = await pagesRes.json();
    return { ...scan, pages };
  },

  /** Create a new scan + upload all pages from agent result */
  async createFromAgentResult(result, { userName } = {}) {
    const scanId = crypto.randomUUID();
    const title = `Scan ${new Date(result.scannedAt).toLocaleString()}`;

    // 1. Insert the scan row first (page_count will get updated by trigger)
    const scanRow = {
      id: scanId,
      scanned_on_pc: result.hostname || null,
      scanned_by_user: userName || null,
      title,
      source: result.source,
      dpi: result.dpi,
      color_mode: result.colorMode,
      page_count: 0,
      total_size_kb: 0,
    };

    const insertRes = await fetch(`${SB_URL}/rest/v1/scans`, {
      method: "POST",
      headers: { ...restH(), Prefer: "return=representation" },
      body: JSON.stringify(scanRow),
    });
    if (!insertRes.ok) {
      const txt = await insertRes.text();
      throw new Error(`scan insert failed: ${insertRes.status} ${txt}`);
    }

    // 2. Upload each page to storage AND insert scan_pages rows
    const pageRows = [];
    for (const p of result.pages) {
      const path = pagePath(scanId, p.pageNumber);
      const blob = base64ToBlob(p.imageBase64, "image/jpeg");

      const uploadRes = await fetch(`${SB_URL}/storage/v1/object/scans/${path}`, {
        method: "POST",
        headers: storageH("image/jpeg"),
        body: blob,
      });
      if (!uploadRes.ok) {
        const txt = await uploadRes.text();
        throw new Error(`page ${p.pageNumber} upload failed: ${uploadRes.status} ${txt}`);
      }

      pageRows.push({
        scan_id: scanId,
        page_number: p.pageNumber,
        storage_path: path,
        rotation: 0,
        width_px: p.widthPx,
        height_px: p.heightPx,
        size_bytes: p.sizeBytes,
        format: p.format || "jpeg",
      });
    }

    // 3. Bulk-insert page rows
    if (pageRows.length > 0) {
      const pagesRes = await fetch(`${SB_URL}/rest/v1/scan_pages`, {
        method: "POST",
        headers: restH(),
        body: JSON.stringify(pageRows),
      });
      if (!pagesRes.ok) {
        const txt = await pagesRes.text();
        throw new Error(`scan_pages insert failed: ${pagesRes.status} ${txt}`);
      }
    }

    return scanId;
  },

  /** Update scan fields (title, tags, archived, etc.) */
  async update(scanId, patch) {
    const res = await fetch(`${SB_URL}/rest/v1/scans?id=eq.${scanId}`, {
      method: "PATCH",
      headers: restH(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`scan update failed: ${res.status}`);
  },

  /** Soft-delete a scan */
  async softDelete(scanId) {
    return this.update(scanId, { deleted_at: new Date().toISOString() });
  },

  /** Hard delete (cascades to scan_pages, but we also clean up storage) */
  async hardDelete(scanId) {
    // Storage cleanup: list & delete all objects under {scanId}/
    const listRes = await fetch(
      `${SB_URL}/storage/v1/object/list/scans`,
      {
        method: "POST",
        headers: { ...restH() },
        body: JSON.stringify({ prefix: `${scanId}/`, limit: 1000 }),
      }
    );
    if (listRes.ok) {
      const objs = await listRes.json();
      const paths = objs.map(o => `${scanId}/${o.name}`);
      if (paths.length > 0) {
        await fetch(`${SB_URL}/storage/v1/object/scans`, {
          method: "DELETE",
          headers: restH(),
          body: JSON.stringify({ prefixes: paths }),
        });
      }
    }
    // DB delete (cascades to scan_pages)
    await fetch(`${SB_URL}/rest/v1/scans?id=eq.${scanId}`, {
      method: "DELETE",
      headers: restH(),
    });
  },

  /** Update a page (rotation, etc.) */
  async updatePage(pageId, patch) {
    const res = await fetch(`${SB_URL}/rest/v1/scan_pages?id=eq.${pageId}`, {
      method: "PATCH",
      headers: restH(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`page update failed: ${res.status}`);
  },

  /** Delete a page (and its file). Renumbers remaining pages. */
  async deletePage(scanId, pageId, storagePath) {
    // Delete file from storage
    await fetch(`${SB_URL}/storage/v1/object/scans/${storagePath}`, {
      method: "DELETE",
      headers: restH(),
    });
    // Delete row
    await fetch(`${SB_URL}/rest/v1/scan_pages?id=eq.${pageId}`, {
      method: "DELETE",
      headers: restH(),
    });
    // Renumber remaining pages — fetch, then patch each
    const remaining = await fetch(
      `${SB_URL}/rest/v1/scan_pages?scan_id=eq.${scanId}&select=id,page_number&order=page_number.asc`,
      { headers: restH() }
    ).then(r => r.json());
    for (let i = 0; i < remaining.length; i++) {
      const expected = i + 1;
      if (remaining[i].page_number !== expected) {
        await this.updatePage(remaining[i].id, { page_number: expected });
      }
    }
  },

  /** Reorder pages — pass full ordered array of page IDs */
  async reorderPages(orderedIds) {
    // Two-pass to avoid uniqueness collisions: bump everything to negative first
    for (let i = 0; i < orderedIds.length; i++) {
      await this.updatePage(orderedIds[i], { page_number: -(i + 1) });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await this.updatePage(orderedIds[i], { page_number: i + 1 });
    }
  },

  /** Get a temporary signed URL for a stored page */
  async signedUrl(storagePath, expiresInSec = 3600) {
    const res = await fetch(
      `${SB_URL}/storage/v1/object/sign/scans/${storagePath}`,
      {
        method: "POST",
        headers: restH(),
        body: JSON.stringify({ expiresIn: expiresInSec }),
      }
    );
    if (!res.ok) throw new Error(`signed url failed: ${res.status}`);
    const { signedURL } = await res.json();
    return `${SB_URL}/storage/v1${signedURL}`;
  },

  /** Get many signed URLs in one go */
  async signedUrls(storagePaths, expiresInSec = 3600) {
    if (storagePaths.length === 0) return {};
    const res = await fetch(
      `${SB_URL}/storage/v1/object/sign/scans`,
      {
        method: "POST",
        headers: restH(),
        body: JSON.stringify({ paths: storagePaths, expiresIn: expiresInSec }),
      }
    );
    if (!res.ok) throw new Error(`signed urls failed: ${res.status}`);
    const arr = await res.json();
    const map = {};
    arr.forEach(item => {
      if (item.signedURL) map[item.path] = `${SB_URL}/storage/v1${item.signedURL}`;
    });
    return map;
  },
};
