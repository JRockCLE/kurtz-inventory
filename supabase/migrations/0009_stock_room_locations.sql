-- ══════════════════════════════════════════════════════════════════════
--  stock_room_locations — in-store location catalog
--
--  Mirrors the role of `warehouse_locations` but for spots inside the
--  store itself. Items already carry a `store_location` text field; this
--  table is what the autocomplete on that field pulls from.
--
--  `scope` leaves room for future "retail" locations (shelf, endcap,
--  display) alongside today's "backroom" (stock room, back shelves).
--  Add new scopes as we need them.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_room_locations (
  id          serial       PRIMARY KEY,
  label       text         NOT NULL,
  scope       text         NOT NULL DEFAULT 'backroom',    -- backroom | retail (future)
  notes       text,
  sort_order  int,
  active_yn   char(1)      NOT NULL DEFAULT 'Y',
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- One active label per scope; soft-deleted (active_yn='N') rows are exempt
-- so a label can be recreated after being retired.
CREATE UNIQUE INDEX IF NOT EXISTS stock_room_locations_label_scope_active_uq
  ON public.stock_room_locations (label, scope)
  WHERE active_yn = 'Y';

CREATE INDEX IF NOT EXISTS stock_room_locations_scope_idx
  ON public.stock_room_locations (scope)
  WHERE active_yn = 'Y';
