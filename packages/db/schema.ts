import { pgTable, uuid, text, numeric, integer, timestamp, date, boolean } from 'drizzle-orm/pg-core'

export const lots = pgTable('lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),       // auto-generated: "{origin} {region} {producer} {grade}"
  origin: text('origin').notNull(),
  region: text('region'),
  producer: text('producer'),         // farm or producer name
  grade: text('grade'),
  varietal: text('varietal'),
  process: text('process'),
  cupping_score: numeric('cupping_score', { precision: 4, scale: 1 }),
  taste_notes: text('taste_notes'),
  other_info: text('other_info'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull().default('warehouse'), // 'warehouse' | 'event'
  is_active: boolean('is_active').notNull().default(true),
  address: text('address'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_number: text('batch_number').notNull().unique(),
  lot_id: uuid('lot_id').references(() => lots.id).notNull(),
  weight_kg: numeric('weight_kg', { precision: 10, scale: 2 }).notNull(),
  sacks: integer('sacks'),
  status: text('status').notNull().default('qc_pending'),
  location: text('location'),           // legacy text — kept for existing rows
  location_id: uuid('location_id').references(() => locations.id),
  moisture_arrival: numeric('moisture_arrival', { precision: 5, scale: 2 }),
  water_activity_arrival: numeric('water_activity_arrival', { precision: 5, scale: 3 }),
  source_reference: text('source_reference'),
  notes: text('notes'),
  received_at: timestamp('received_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id').references(() => batches.id).notNull(),
  from_location_id: uuid('from_location_id').references(() => locations.id).notNull(),
  to_location_id: uuid('to_location_id').references(() => locations.id).notNull(),
  weight_kg: numeric('weight_kg', { precision: 10, scale: 2 }).notNull(),
  sacks: integer('sacks'),
  notes: text('notes'),
  transferred_at: timestamp('transferred_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const inventoryTransactions = pgTable('inventory_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id').references(() => batches.id).notNull(),
  type: text('type').notNull(),
  weight_change_kg: numeric('weight_change_kg', { precision: 10, scale: 2 }).notNull(),
  physical_count_id: uuid('physical_count_id'),  // FK set after physical_counts created
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const physicalCounts = pgTable('physical_counts', {
  id: uuid('id').primaryKey().defaultRandom(),
  count_date: date('count_date').notNull(),
  performed_by: text('performed_by').notNull(),
  status: text('status').notNull().default('in_progress'),
  notes: text('notes'),
  total_variance_kg: numeric('total_variance_kg', { precision: 10, scale: 2 }),
  reviewed_by: text('reviewed_by'),
  reviewed_at: timestamp('reviewed_at'),
  rejection_notes: text('rejection_notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const physicalCountItems = pgTable('physical_count_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  physical_count_id: uuid('physical_count_id').references(() => physicalCounts.id).notNull(),
  batch_id: uuid('batch_id').references(() => batches.id).notNull(),
  system_kg: numeric('system_kg', { precision: 10, scale: 2 }).notNull(),
  counted_kg: numeric('counted_kg', { precision: 10, scale: 2 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_name: text('company_name').notNull(),
  brand_name: text('brand_name'),
  tin: text('tin'),
  contact_name: text('contact_name'),
  contact_email: text('contact_email'),
  contact_phone: text('contact_phone'),
  address: text('address'),
  payment_terms: text('payment_terms').default('Net 30'),
  credit_limit: numeric('credit_limit', { precision: 15, scale: 2 }).default('0'),
  withholding_tax_rate: numeric('withholding_tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  os_number: text('os_number').notNull().unique(),
  client_id: uuid('client_id').references(() => clients.id).notNull(),
  status: text('status').notNull().default('draft'),
  order_date: date('order_date').notNull(),
  notes: text('notes'),
  scheduled_dispatch_date: date('scheduled_dispatch_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').references(() => orders.id).notNull(),
  lot_id: uuid('lot_id').references(() => lots.id).notNull(),
  weight_ordered_kg: numeric('weight_ordered_kg', { precision: 10, scale: 2 }).notNull(),
  price_per_kg: numeric('price_per_kg', { precision: 10, scale: 2 }).notNull(),
})

export const dispatches = pgTable('dispatches', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').references(() => orders.id).notNull(),
  dr_number: text('dr_number').notNull(),
  dispatched_date: date('dispatched_date').notNull(),
  receiver_name: text('receiver_name'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const dispatchItems = pgTable('dispatch_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  dispatch_id: uuid('dispatch_id').references(() => dispatches.id).notNull(),
  order_item_id: uuid('order_item_id').references(() => orderItems.id).notNull(),
  weight_dispatched_kg: numeric('weight_dispatched_kg', { precision: 10, scale: 2 }).notNull(),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  full_name: text('full_name').notNull().default(''),
  role: text('role').notNull().default('ops'),
  can_create_dispatches: boolean('can_create_dispatches').notNull().default(false),
  can_manage_contracts: boolean('can_manage_contracts').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const contracts = pgTable('contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  contract_number: text('contract_number').notNull().unique(),
  client_id: uuid('client_id').references(() => clients.id).notNull(),
  lot_id: uuid('lot_id').references(() => lots.id).notNull(),
  weight_contracted_kg: numeric('weight_contracted_kg', { precision: 10, scale: 2 }).notNull(),
  price_per_kg: numeric('price_per_kg', { precision: 10, scale: 2 }).notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date'),
  status: text('status').notNull().default('draft'),
  assigned_to: uuid('assigned_to'),
  created_by: uuid('created_by'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
