-- ══════════════════════════════════════════════════════════════════════
--  wholesale_order_items — add is_custom flag
--
--  Custom lines are user-typed rows (description + case price + qty) with
--  no backing inventory item. item_id was already nullable (so item
--  deletion wouldn't break history), so we need an explicit flag to tell
--  the two cases apart when loading an order back for editing.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.wholesale_order_items
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;
