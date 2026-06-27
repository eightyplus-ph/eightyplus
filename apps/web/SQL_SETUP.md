# Supabase Database Setup

Run this in **Supabase Dashboard → SQL Editor** to create all tables.
Run the CREATE TABLE statements first, then the RLS statements.

```sql
-- ============================================================
-- STEP 1: Create tables
-- ============================================================

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  origin text not null,
  varietal text,
  process text,
  grade text,
  cupping_score numeric(4,1),
  taste_notes text,
  farm_name text,
  created_at timestamptz not null default now()
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  lot_id uuid not null references lots(id),
  weight_kg numeric(10,2) not null,
  sacks integer,
  status text not null default 'qc_pending',
  location text,
  moisture_arrival numeric(5,2),
  water_activity_arrival numeric(5,3),
  source_reference text,
  notes text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id),
  type text not null,
  weight_change_kg numeric(10,2) not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  tin text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  payment_terms text default 'Net 30',
  credit_limit numeric(15,2) default 0,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  os_number text not null unique,
  client_id uuid not null references clients(id),
  status text not null default 'draft',
  order_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  lot_id uuid not null references lots(id),
  weight_ordered_kg numeric(10,2) not null,
  price_per_kg numeric(10,2) not null
);

-- ============================================================
-- STEP 2: Enable Row Level Security
-- ============================================================

alter table lots enable row level security;
alter table batches enable row level security;
alter table inventory_transactions enable row level security;
alter table clients enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- ============================================================
-- STEP 3: Create access policies (authenticated users only)
-- ============================================================

create policy "authenticated_all" on lots
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on batches
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on inventory_transactions
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on clients
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on orders
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on order_items
  for all to authenticated using (true) with check (true);
```
