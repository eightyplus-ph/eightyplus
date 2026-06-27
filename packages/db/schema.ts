import { pgTable, uuid, text, numeric, integer, timestamp, date } from 'drizzle-orm/pg-core'

export const lots = pgTable('lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  origin: text('origin').notNull(),
  varietal: text('varietal'),
  process: text('process'),
  grade: text('grade'),
  cupping_score: numeric('cupping_score', { precision: 4, scale: 1 }),
  taste_notes: text('taste_notes'),
  farm_name: text('farm_name'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_number: text('batch_number').notNull().unique(),
  lot_id: uuid('lot_id').references(() => lots.id).notNull(),
  weight_kg: numeric('weight_kg', { precision: 10, scale: 2 }).notNull(),
  sacks: integer('sacks'),
  status: text('status').notNull().default('qc_pending'),
  location: text('location'),
  moisture_arrival: numeric('moisture_arrival', { precision: 5, scale: 2 }),
  water_activity_arrival: numeric('water_activity_arrival', { precision: 5, scale: 3 }),
  source_reference: text('source_reference'),
  notes: text('notes'),
  received_at: timestamp('received_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const inventoryTransactions = pgTable('inventory_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id').references(() => batches.id).notNull(),
  type: text('type').notNull(),
  weight_change_kg: numeric('weight_change_kg', { precision: 10, scale: 2 }).notNull(),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_name: text('company_name').notNull(),
  tin: text('tin'),
  contact_name: text('contact_name'),
  contact_email: text('contact_email'),
  contact_phone: text('contact_phone'),
  address: text('address'),
  payment_terms: text('payment_terms').default('Net 30'),
  credit_limit: numeric('credit_limit', { precision: 15, scale: 2 }).default('0'),
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
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').references(() => orders.id).notNull(),
  lot_id: uuid('lot_id').references(() => lots.id).notNull(),
  weight_ordered_kg: numeric('weight_ordered_kg', { precision: 10, scale: 2 }).notNull(),
  price_per_kg: numeric('price_per_kg', { precision: 10, scale: 2 }).notNull(),
})
