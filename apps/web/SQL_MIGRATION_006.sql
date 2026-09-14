-- MIGRATION 006 — audit trail for edited orders
--
-- Context: reserved orders become editable by any authenticated user. `orders`
-- records who CREATED a row (created_by) but nothing about who changed it, so a
-- weight can move from 5,610 to 5,010 kg with no trace. These two columns are
-- what makes "everyone can edit" answerable after the fact.
--
-- Run this in the Supabase SQL editor BEFORE deploying the Edit button.
-- Dev and prod share one database, so the column must exist before the app
-- tries to stamp it.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.updated_at IS
  'Last time an order was edited through the app. NULL means never edited since migration 006.';
COMMENT ON COLUMN orders.updated_by IS
  'Profile that last edited this order. Distinct from created_by, which never changes.';

-- Existing rows stay NULL rather than being backfilled with a fake editor:
-- "never edited" and "edited by someone we did not record" must not look alike.

CREATE INDEX IF NOT EXISTS orders_updated_at_idx ON orders (updated_at DESC NULLS LAST);

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('updated_at','updated_by');
--   -- expect 2 rows
