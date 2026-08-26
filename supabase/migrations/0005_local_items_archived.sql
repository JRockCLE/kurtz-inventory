-- ══════════════════════════════════════════════════════════════════════
--  local_items — add explicit archived_at timestamp
--
--  Adds a nullable archived_at column. When set, the item is archived.
--  When null, the item is active.
--
--  Backfill: items previously soft-deleted via active_yn='N' get their
--  archived_at populated from updated_at so they appear on the Archive
--  page immediately.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.local_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- One-time backfill: mirror the existing soft-delete flag into the new column.
UPDATE public.local_items
SET archived_at = COALESCE(updated_at, now())
WHERE active_yn = 'N' AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS local_items_archived_at_idx
  ON public.local_items (archived_at NULLS FIRST);
