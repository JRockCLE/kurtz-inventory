-- ══════════════════════════════════════════════════════════════════════
--  Backfill warehouse_locations.section based on numeric label prefix
--
--  Physical layout (per store):
--    1–149   → Section A
--    150–221 → Section B
--    222–468 → Section C
--
--  Only touches rows where `section` is NULL AND the label starts with a
--  digit AND the label is not C- or F- prefixed (those are Cooler/Freezer
--  and don't belong to a WH section). Safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

UPDATE public.warehouse_locations
SET section = CASE
  WHEN (substring(label FROM '^\d+'))::int BETWEEN 1   AND 149 THEN 'A'
  WHEN (substring(label FROM '^\d+'))::int BETWEEN 150 AND 221 THEN 'B'
  WHEN (substring(label FROM '^\d+'))::int BETWEEN 222 AND 468 THEN 'C'
END
WHERE section IS NULL
  AND label ~ '^\d+'
  AND label !~ '^(C|F)[- ]';


-- Sanity check: preview the section distribution after running
SELECT section, count(*) AS n
FROM public.warehouse_locations
WHERE active_yn = 'Y'
GROUP BY section
ORDER BY section NULLS LAST;
