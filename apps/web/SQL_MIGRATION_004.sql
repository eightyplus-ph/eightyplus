-- Migration 004: Per-user view permissions on profiles

-- The web app reads these columns (useProfile → canViewOrders / canViewClients),
-- but no earlier migration ever added them, so useProfile's SELECT returned a 400
-- and every user fell back to a null profile (rep dashboard + broken role gates).
-- Applied to prod via ad-hoc ALTER on 2026-07-07; captured here so a DB rebuild
-- cannot regress it.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_view_orders  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_view_clients BOOLEAN NOT NULL DEFAULT false;
