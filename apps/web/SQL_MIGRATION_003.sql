-- Migration 003: Contract items + batch-contract assignment

-- Add title field to contracts
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS title TEXT;

-- Contract line items (one per product per contract)
CREATE TABLE IF NOT EXISTS contract_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE NOT NULL,
  product_name TEXT NOT NULL,
  price_per_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
  monthly_schedule JSONB DEFAULT '{}',  -- {"YYYY-MM": kg_number, ...}
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE contract_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_items_all" ON contract_items
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Soft link from batch to which contract item it fulfills
ALTER TABLE batches ADD COLUMN IF NOT EXISTS contract_item_id UUID REFERENCES contract_items(id) ON DELETE SET NULL;
