-- ══════════════════════════════════════════════════════════════════════
--  stock_room_locations — match warehouse_locations' addressing shape
--
--  Adds the structured columns (column_num / row_letter / slot_num /
--  section / aisle) so the Stock Room Locations editor can offer the
--  same Add + Bulk Add + inline edit experience as Warehouse Locations.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.stock_room_locations
  ADD COLUMN IF NOT EXISTS column_num int,
  ADD COLUMN IF NOT EXISTS row_letter text,
  ADD COLUMN IF NOT EXISTS slot_num   int,
  ADD COLUMN IF NOT EXISTS section    text,
  ADD COLUMN IF NOT EXISTS aisle      text;
