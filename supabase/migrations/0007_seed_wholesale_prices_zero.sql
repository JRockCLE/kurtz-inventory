-- ══════════════════════════════════════════════════════════════════════
--  Seed: default every unset wholesale case price to $0
--
--  Baseline the wholesale pricing columns so items with no explicit price
--  can still be added to orders without triggering the "needs a case price"
--  validation. The owner can override individual items later.
--
--  Only touches rows that don't already have a case price set — safe to
--  re-run, won't clobber any hand-entered pricing.
-- ══════════════════════════════════════════════════════════════════════

UPDATE public.local_items
SET wholesale_case_price = 0,
    wholesale_unit_price = 0,
    updated_at = now()
WHERE wholesale_case_price IS NULL;

-- Sanity check: how many rows now have a wholesale case price
SELECT
  count(*) FILTER (WHERE wholesale_case_price IS NOT NULL) AS with_price,
  count(*) FILTER (WHERE wholesale_case_price IS NULL)     AS still_null,
  count(*)                                                 AS total
FROM public.local_items
WHERE active_yn = 'Y';
