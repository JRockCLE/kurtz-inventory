-- ══════════════════════════════════════════════════════════════════════
--  Wholesale Orders feature — Phase 1 schema
--
--  Run this once in the Supabase SQL editor (or via `supabase db push`)
--  before deploying the Wholesale Orders tab.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Per-item wholesale pricing
-- ---------------------------------------------------------------------
-- We store all three so we preserve whichever value the user typed as
-- their source of truth. The UI recomputes the other two on the fly.
ALTER TABLE public.local_items
  ADD COLUMN IF NOT EXISTS wholesale_markup_pct numeric(6, 2),
  ADD COLUMN IF NOT EXISTS wholesale_case_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS wholesale_unit_price numeric(10, 4);


-- 2. Invoice header settings (single-row table)
-- ---------------------------------------------------------------------
-- One row per install. UI reads/writes id=1.
CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id            int         PRIMARY KEY DEFAULT 1,
  business_name text,
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  postal_code   text,
  phone         text,
  email         text,
  website       text,
  logo_url      text,
  footer_note   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_settings_singleton CHECK (id = 1)
);

-- Seed the singleton row if it doesn't exist yet
INSERT INTO public.invoice_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- 3. Wholesale orders
-- ---------------------------------------------------------------------
-- Serial id → invoice number (#1, #2, #3, ...).
-- Orders are editable at any time; status just tracks lifecycle.
CREATE TABLE IF NOT EXISTS public.wholesale_orders (
  id             serial       PRIMARY KEY,
  status         text         NOT NULL DEFAULT 'draft',   -- draft | saved | invoiced
  customer_name  text,                                    -- optional "Sold to"
  notes          text,                                    -- order-level notes
  total_amount   numeric(10, 2),                          -- snapshot at save; recomputed on save
  created_by     text,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  invoiced_at    timestamptz
);

CREATE INDEX IF NOT EXISTS wholesale_orders_created_at_idx
  ON public.wholesale_orders (created_at DESC);


-- 4. Wholesale order line items
-- ---------------------------------------------------------------------
-- All descriptive fields are snapshotted at save time so historical
-- invoices don't change when items are edited or deleted later.
CREATE TABLE IF NOT EXISTS public.wholesale_order_items (
  id                   serial          PRIMARY KEY,
  order_id             int             NOT NULL REFERENCES public.wholesale_orders (id) ON DELETE CASCADE,
  item_id              int,                                    -- FK-ish, nullable so item deletion doesn't break history
  item_name            text            NOT NULL,
  item_size            text,
  case_size            int,
  warehouse_location   text,
  cases_ordered        int             NOT NULL DEFAULT 0,
  unit_price           numeric(10, 4),                         -- snapshot of wholesale_unit_price
  case_price           numeric(10, 2),                         -- snapshot of wholesale_case_price
  line_total           numeric(10, 2),                         -- cases_ordered * case_price
  notes                text,
  created_at           timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wholesale_order_items_order_idx
  ON public.wholesale_order_items (order_id);
