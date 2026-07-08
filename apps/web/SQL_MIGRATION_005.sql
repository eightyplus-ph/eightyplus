-- Migration 005: Repacking

-- A repack consumes coffee from a source batch and produces a new batch in a
-- different SKU (e.g. a commercial sack repacked into 1 kg retail bags).
-- Lineage: the output batch records which batch it came from, so a repacked
-- unit is always traceable back to its origin lot/receipt.
ALTER TABLE batches ADD COLUMN IF NOT EXISTS source_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

-- Audit trail of repack operations (mirrors transfers/dispatches).
CREATE TABLE IF NOT EXISTS repacks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_batch_id    UUID NOT NULL REFERENCES batches(id),
  output_batch_id    UUID NOT NULL REFERENCES batches(id),
  weight_consumed_kg NUMERIC(10,2) NOT NULL,
  weight_produced_kg NUMERIC(10,2) NOT NULL,
  variance_kg        NUMERIC(10,2) NOT NULL DEFAULT 0,  -- consumed - produced (spillage/tare loss)
  performed_by       TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE repacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON repacks;
CREATE POLICY "authenticated_all" ON repacks FOR ALL TO authenticated USING (true) WITH CHECK (true);
