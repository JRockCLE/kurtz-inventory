-- ══════════════════════════════════════════════════════════════════════
--  invoice_settings — add show_logo_on_invoice flag
--
--  Lets the owner toggle whether the company logo appears in the PDF
--  invoice header, independent of whether a logo is uploaded (the logo
--  still shows in the app's top nav either way).
--
--  Idempotent: safe to re-run. Defaults to false so existing installs
--  keep their current (logo-less) invoice output until they opt in.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS show_logo_on_invoice boolean NOT NULL DEFAULT false;
