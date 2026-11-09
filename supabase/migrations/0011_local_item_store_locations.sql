-- ══════════════════════════════════════════════════════════════════════
--  local_item_store_locations — per-item store-location list
--
--  Mirror of `local_item_locations` (which holds the per-item warehouse
--  spots) but for store/backroom spots. Enables the same chip-list +
--  Primary + reorder + add/remove UX in the Item modal. The item's
--  `store_location` text column stays as the cached primary label so
--  the Items table / Receiving / printouts don't need a join.
--
--  Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.local_item_store_locations (
  id            serial       PRIMARY KEY,
  local_item_id int          NOT NULL REFERENCES public.local_items(id) ON DELETE CASCADE,
  location      text         NOT NULL,
  is_primary    boolean      NOT NULL DEFAULT false,
  sort_order    int          NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_item_store_locations_item_idx
  ON public.local_item_store_locations (local_item_id);

-- No duplicate location per item.
CREATE UNIQUE INDEX IF NOT EXISTS local_item_store_locations_item_loc_uq
  ON public.local_item_store_locations (local_item_id, location);
