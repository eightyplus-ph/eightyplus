-- MIGRATION 008 — payments as their own record, allocated across orders
--
-- Context: payment lives on the order today — `orders.payment_date` and
-- `orders.payment_proof_url`. One payment covering several orders has nowhere
-- to go, so it gets smeared by hand: on 2026-08-10 a single Yardstick payment
-- (PO#P10946, PHP 917,275) was uploaded as THREE separate proof files across
-- orders 1737-1, 1737-2 and 1925.
--
-- A payment is now its own row with its own amount, and allocations say which
-- orders it covers. Two things fall out of that:
--   * bulk payments stop being three lies that happen to add up
--   * amount received minus amount allocated IS the client's credit balance —
--     the thing that currently exists only in conversation (~PHP 2.4M owed to
--     The Whole One Yard as of 2026-09-17)
--
-- The old columns on `orders` are KEPT and still written. 232 dispatched orders
-- rely on them, as do the Confirm modal, the Orders list and the Statement of
-- Account. This migration adds a truth; it does not remove one.
--
-- FK note: `payments.created_by` and `payment_allocations` both reference other
-- tables, but neither adds a SECOND relationship between `orders` and
-- `profiles`. Migration 006 broke the app that way; this one cannot.
--
-- Run in the Supabase SQL editor BEFORE deploying. Dev and prod share one DB.

CREATE TABLE IF NOT EXISTS payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  payment_date  date NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  reference     text,
  proof_url     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES orders(id)   ON DELETE RESTRICT,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, order_id)
);

-- ON DELETE RESTRICT on order_id is deliberate. Deleting an order that a real
-- payment was allocated against is how the Yardstick PHP 2,025,000 vanished
-- from the system on 2026-09-08. Now it fails loudly instead.

CREATE INDEX IF NOT EXISTS payments_client_date_idx      ON payments (client_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS payment_allocations_order_idx ON payment_allocations (order_id);

ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON payments;
CREATE POLICY "authenticated_all" ON payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all" ON payment_allocations;
CREATE POLICY "authenticated_all" ON payment_allocations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE payments IS
  'Money actually received from a client. One row per payment, however many orders it covers.';
COMMENT ON TABLE payment_allocations IS
  'Which orders a payment was applied to, and how much of it. Sum of allocations may be less than payments.amount — the difference is the client''s credit.';

-- Verify:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('payments','payment_allocations');
--   -- expect 2 rows
--
--   SELECT count(*) FROM payments;  -- expect 0
