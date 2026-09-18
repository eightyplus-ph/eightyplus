-- MIGRATION 009 — clients who ship before they pay
--
-- Context: Dispatches lists `status = 'confirmed'` only, and the only door to
-- confirmed is the Confirm modal, which will not submit without a payment proof
-- file. Payment therefore precedes shipping by construction.
--
-- Two clients do not trade that way. The Whole One Yard and AM ESPRESSO MNL
-- CAFE receive goods and settle afterwards — measured on 2026-09-17, six of
-- their orders were paid AFTER the goods shipped, the longest gap 17 days. The
-- workaround has been to mark an order Confirmed to unlock Dispatches and
-- backfill the real payment later, which preserves the paperwork but destroys
-- the truth of the sequence.
--
-- A per-client flag rather than two names in code: the list will grow, and a
-- hardcoded list means a deploy every time it does.
--
-- DELIBERATELY NOT a fourth order status. `orders.status` is read by label
-- maps, colour maps and several `.in('status', [...])` filters; adding a value
-- would make every one of them silently wrong (the same reasoning as migration
-- 007's archived_at). "Shipped but unpaid" is already expressible today as
-- status = 'dispatched' AND payment_date IS NULL.
--
-- Run in the Supabase SQL editor BEFORE deploying. Dev and prod share one DB.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pay_after_dispatch boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN clients.pay_after_dispatch IS
  'When true, this client''s reserved orders may be dispatched without a payment proof; payment is recorded afterwards via the payments table. Receivable = orders dispatched with payment_date IS NULL.';

-- Turn it on for the two clients that already trade this way.
UPDATE clients SET pay_after_dispatch = true
WHERE company_name IN ('The Whole One Yard', 'AM ESPRESSO MNL CAFE');

CREATE INDEX IF NOT EXISTS clients_pay_after_dispatch_idx
  ON clients (pay_after_dispatch) WHERE pay_after_dispatch;

-- Verify:
--   SELECT company_name, pay_after_dispatch FROM clients WHERE pay_after_dispatch;
--   -- expect exactly 2 rows: The Whole One Yard, AM ESPRESSO MNL CAFE
