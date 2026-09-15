-- MIGRATION 007 — archive a reserved order without deleting it
--
-- Context: `orders.status` only ever holds reserved / confirmed / dispatched.
-- There is no cancelled or void state, so until now the only way to retire an
-- order was DELETE — which destroys the row, its lines, and any payment record
-- attached to it. Archiving is the non-destructive alternative.
--
-- Deliberately NOT a fourth status value. Status is read by label maps, colour
-- maps and several `.in('status', [...])` filters; adding a value would make
-- every one of those places silently wrong. A nullable timestamp is orthogonal:
-- existing status logic keeps working untouched, and archived-ness is a filter.
--
-- NOTE ON THE FOREIGN KEY: this adds a THIRD orders -> profiles relationship
-- (created_by, updated_by, archived_by). Migration 006 broke the app by making
-- the PostgREST embed `profiles(full_name)` ambiguous. Both embeds are now
-- pinned to `profiles!orders_created_by_fkey`, and a codebase grep confirms no
-- unpinned `profiles(` embed remains, so this FK is safe to add.
--
-- Run in the Supabase SQL editor BEFORE deploying. Dev and prod share one DB.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.archived_at IS
  'Set when an order is retired without being deleted. NULL = live. An archived order is excluded from the orders list, contract drawdown, dashboard sales and open-order counts.';
COMMENT ON COLUMN orders.archived_by IS
  'Profile that archived this order. Third FK to profiles — keep every PostgREST embed pinned to an explicit fkey name.';

-- Partial index: every list query filters `archived_at IS NULL`, and that is
-- the overwhelming majority of rows, so index the exception instead.
CREATE INDEX IF NOT EXISTS orders_archived_at_idx ON orders (archived_at) WHERE archived_at IS NOT NULL;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('archived_at','archived_by');
--   -- expect 2 rows
--
--   SELECT count(*) FROM orders WHERE archived_at IS NOT NULL;
--   -- expect 0 immediately after running this
