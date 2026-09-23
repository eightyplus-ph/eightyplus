-- MIGRATION 010 — let anyone who writes an order see the contracts
--
-- `contracts` is the only table in the schema with a role-based SELECT policy.
-- Migration 002 gave clauses to admin, manager, can_manage_contracts holders,
-- and sales (own contracts only). It gave **no clause to ops**, so an ops user
-- reads zero contracts.
--
-- The order form renders its Contract dropdown only when the client has at
-- least one visible contract. So for Kiki (ops) the field never appears, and
-- orders she writes cannot be attached to a contract at all. Two live orders
-- show the consequence — 2184 (Alon ng Kape) and 2186 (The Whole One Yard) are
-- both priced at exactly the contracted rates (700 / 640 / 725) and both carry
-- contract_id NULL, because she knew the price and had no way to record the link.
--
-- Enan (sales) has the same problem in a narrower form: he sees only contracts
-- assigned to or created by him, and neither active contract is.
--
-- The restriction also protects nothing. `contract_items` — which holds the
-- product lines AND the prices — is already `FOR ALL TO authenticated USING
-- (true)` from migration 003. Hiding the parent row while the commercial terms
-- sit open in the child table costs functionality and buys no confidentiality.
--
-- SELECT is therefore opened to any authenticated user, matching every other
-- table. INSERT, UPDATE and DELETE policies are untouched: creating and editing
-- contracts stays restricted exactly as before.

DROP POLICY IF EXISTS "contracts_select" ON contracts;
CREATE POLICY "contracts_select" ON contracts
  FOR SELECT USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE contracts IS
  'Supply agreements. SELECT open to any authenticated user (migration 010) so order writers can attach an order to its contract; write access remains role-restricted.';

-- Verify, signed in as an ops user:
--   SELECT contract_number, status FROM contracts;
--   -- expect both active contracts, not zero rows
