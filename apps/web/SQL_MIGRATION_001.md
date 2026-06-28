# Migration 001 — Add region and producer to lots

Run in Supabase SQL Editor:

```sql
alter table lots add column if not exists region text;
alter table lots add column if not exists producer text;
```

## Migration 002 — Add withholding_tax_rate to clients

```sql
alter table clients add column if not exists withholding_tax_rate numeric(5,2) not null default 0;
```

## Migration 003 — Locations and Transfers

```sql
-- Locations table
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'warehouse',
  is_active boolean not null default true,
  address text,
  notes text,
  created_at timestamp with time zone default now() not null
);

-- Seed default warehouses
insert into locations (name, type) values
  ('Paco Warehouse', 'warehouse'),
  ('Bagtikan', 'warehouse')
on conflict do nothing;

-- Add location_id FK to batches
alter table batches add column if not exists location_id uuid references locations(id);

-- Transfers table
create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) not null,
  from_location_id uuid references locations(id) not null,
  to_location_id uuid references locations(id) not null,
  weight_kg numeric(10,2) not null,
  sacks integer,
  notes text,
  transferred_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

-- RLS for locations
alter table locations enable row level security;
create policy "Authenticated users can read locations"
  on locations for select to authenticated using (true);
create policy "Authenticated users can insert locations"
  on locations for insert to authenticated with check (true);
create policy "Authenticated users can update locations"
  on locations for update to authenticated using (true);

-- RLS for transfers
alter table transfers enable row level security;
create policy "Authenticated users can read transfers"
  on transfers for select to authenticated using (true);
create policy "Authenticated users can insert transfers"
  on transfers for insert to authenticated with check (true);
```
