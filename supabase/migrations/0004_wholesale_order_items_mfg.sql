-- ══════════════════════════════════════════════════════════════════════
--  wholesale_order_items — add mfg_name snapshot column
--
--  The invoice PDF needs the manufacturer for each line. We snapshot it
--  at save time (same pattern as item_name / item_size / case_size etc.)
--  so historical invoices stay stable if the vendor name changes later.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.wholesale_order_items
  ADD COLUMN IF NOT EXISTS mfg_name text;
