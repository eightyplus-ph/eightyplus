-- MIGRATION 011 — record which warehouse a dispatch was actually picked from
--
-- The order line names the warehouse the order is COMMITTED against — a sourcing
-- decision, and the right one: when Bagtikan is short, the order is tagged Paco.
-- Nothing has ever recorded where the sacks were PICKED, so dispatch debits the
-- batch the order line points at, which is the sourcing warehouse regardless of
-- where the coffee physically came from.
--
-- The result is one repeating signature, from two opposite causes:
--
--   transfer recorded (2 of 13 since 17 Sept) — the transfer moves stock to
--   Bagtikan, then the dispatch debits Paco anyway. Paco loses it twice.
--
--   transfer not recorded (11 of 13) — the coffee moves, the book does not.
--   Bagtikan stays high, Paco drops for a pick it never made.
--
-- Both end with Paco's book below its count and Bagtikan's above. Doing the
-- paperwork correctly currently produces the WORSE outcome, which is why the
-- transfer has to be generated from the picking answer rather than remembered
-- as a separate step.

ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS picked_location_id uuid REFERENCES locations(id);

COMMENT ON COLUMN dispatch_items.picked_location_id IS
  'Warehouse the sacks were physically picked from. Defaults to the order line''s location; when it differs, the dispatch writes a transfer pair and debits this warehouse instead (migration 011).';

-- Backfill from the ledger: where a dispatch debited a batch, that batch's
-- warehouse IS where it was picked, whatever the order line said. This makes the
-- column true for history without asserting anything new.
UPDATE dispatch_items di
SET picked_location_id = b.location_id
FROM inventory_transactions t
JOIN batches b ON b.id = t.batch_id
JOIN dispatches d ON d.id = di.dispatch_id
JOIN order_items oi ON oi.id = di.order_item_id
WHERE di.picked_location_id IS NULL
  AND t.type = 'dispatch'
  AND b.lot_id = oi.lot_id
  AND t.notes LIKE 'DR ' || d.dr_number || ' %';

-- Link a transfer to the dispatch that caused it. Until now a transfer carried
-- only its counterpart batch ("Transferred to PC260701-031-T03") and could not be
-- attributed to the order it served — 0 of 17 are traceable.
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS dispatch_id uuid REFERENCES dispatches(id) ON DELETE SET NULL;

COMMENT ON COLUMN inventory_transactions.dispatch_id IS
  'The dispatch that caused this movement, for transfers generated when the picked warehouse differs from the order line''s (migration 011).';

CREATE INDEX IF NOT EXISTS inventory_transactions_dispatch_idx
  ON inventory_transactions(dispatch_id) WHERE dispatch_id IS NOT NULL;

-- Verify:
--   SELECT count(*) FILTER (WHERE picked_location_id IS NULL) AS unbackfilled,
--          count(*) AS total FROM dispatch_items;
