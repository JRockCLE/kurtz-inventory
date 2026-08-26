-- ══════════════════════════════════════════════════════════════════════
--  Wholesale Customers — Phase 4 schema
--
--  Adds a customers table + FK on wholesale_orders, plus denormalized
--  address/phone/email columns on the order itself so historical invoices
--  stay stable even if the customer's contact info changes later.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wholesale_customers (
  id             serial       PRIMARY KEY,
  business_name  text         NOT NULL,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  phone          text,
  email          text,
  notes          text,
  active_yn      char(1)      NOT NULL DEFAULT 'Y',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wholesale_customers_active_idx
  ON public.wholesale_customers (active_yn, business_name);


-- Order → customer FK plus denormalized snapshot columns.
-- The existing `customer_name` column (from the initial wholesale.sql)
-- becomes the snapshot of the customer's business name at save time.
ALTER TABLE public.wholesale_orders
  ADD COLUMN IF NOT EXISTS customer_id       int REFERENCES public.wholesale_customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_address  text,
  ADD COLUMN IF NOT EXISTS customer_phone    text,
  ADD COLUMN IF NOT EXISTS customer_email    text;
