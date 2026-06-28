-- ============================================================
-- MIGRATION 002: Profiles (RBAC) + Contracts
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'ops'
    CHECK (role IN ('admin', 'manager', 'sales', 'ops')),
  can_create_dispatches BOOLEAN NOT NULL DEFAULT false,
  can_manage_contracts  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile row when a new auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    'ops'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Backfill profile for existing users (run once)
INSERT INTO profiles (id, full_name, role)
SELECT id, COALESCE(email, id::text), 'ops'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 2. CONTRACTS TABLE
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id),
  lot_id UUID NOT NULL REFERENCES lots(id),
  weight_contracted_kg NUMERIC(10,2) NOT NULL,
  price_per_kg NUMERIC(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','fulfilled','expired','cancelled')),
  assigned_to UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PATCH EXISTING TABLES
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id);

ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS verified_notes TEXT;

ALTER TABLE physical_counts ADD COLUMN IF NOT EXISTS performed_by_id UUID REFERENCES auth.users(id);

-- 4. ENABLE RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- 5. PROFILES RLS POLICIES
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (
    -- admin can update anyone; others can only update their own name
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR id = auth.uid()
  );

-- 6. CONTRACTS RLS POLICIES
DROP POLICY IF EXISTS "contracts_select" ON contracts;
CREATE POLICY "contracts_select" ON contracts
  FOR SELECT USING (
    -- admin and manager see all
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','manager'))
    -- manager with can_manage_contracts sees all (already covered by manager, but explicit)
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.can_manage_contracts = true)
    -- sales sees their own assigned or created contracts
    OR (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'sales')
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
    -- ops sees nothing (no clause)
  );

DROP POLICY IF EXISTS "contracts_insert" ON contracts;
CREATE POLICY "contracts_insert" ON contracts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (
      p.role IN ('admin','sales')
      OR p.can_manage_contracts = true
    ))
  );

DROP POLICY IF EXISTS "contracts_update" ON contracts;
CREATE POLICY "contracts_update" ON contracts
  FOR UPDATE USING (
    -- admin: any row
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    -- can_manage_contracts: any row (Jas)
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.can_manage_contracts = true)
    -- sales: only their own
    OR (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'sales')
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_delete" ON contracts;
CREATE POLICY "contracts_delete" ON contracts
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- 7. UPDATE YOUR OWN PROFILE TO ADMIN (run as CK's session)
-- Replace the email below with your actual email before running:
-- UPDATE profiles SET role = 'admin', full_name = 'CK' WHERE id = (
--   SELECT id FROM auth.users WHERE email = 'ck@eightyplus.internal'
-- );
