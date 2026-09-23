#!/usr/bin/env bun
/**
 * inventory-doctor — read-only integrity probe for Eightyplus stock data.
 *
 *   bun scripts/inventory-doctor.ts            # human report
 *   bun scripts/inventory-doctor.ts --json     # machine output
 *   bun scripts/inventory-doctor.ts --full     # don't truncate evidence rows
 *
 * Exits non-zero while any CRITICAL finding is present, so it can gate CI or a cron.
 *
 * This tool NEVER writes. Every request is a GET. If you find yourself adding a POST,
 * PATCH or DELETE here, put it in a separate script — the value of this one is that it
 * is safe to run against production without thinking about it.
 *
 * Credentials are read at run time from apps/web/.env and are never printed.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(HERE, '../apps/web/.env')

const FULL = process.argv.includes('--full')
const JSON_OUT = process.argv.includes('--json')
const MAX_ROWS = FULL ? Number.MAX_SAFE_INTEGER : 12

function loadEnv(path: string): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    console.error(`inventory-doctor: cannot read ${path}\nRun this from the repo, with apps/web/.env present.`)
    process.exit(2)
  }
  return Object.fromEntries(
    raw.split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#')).map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
  )
}

const env = loadEnv(ENV_PATH)
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('inventory-doctor: VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_KEY missing from apps/web/.env')
  process.exit(2)
}
const AUTH = { apikey: KEY, Authorization: `Bearer ${KEY}` }

/** Paged GET. Read-only by construction — this is the only request helper in the file. */
async function fetchAll(table: string, select: string): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${select}`, {
      headers: { ...AUTH, Range: `${from}-${from + 999}` },
    })
    if (!res.ok) {
      // Never echo the response body — PostgREST errors can quote the request headers.
      console.error(`inventory-doctor: GET ${table} failed with HTTP ${res.status}`)
      process.exit(2)
    }
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const num = (v: any) => (v === null || v === undefined ? 0 : Number(v))
const kg = (v: number) => Math.round(v * 100) / 100
const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
interface Finding { id: string; severity: Severity; title: string; note?: string; rows: string[] }

const findings: Finding[] = []
const report = (id: string, severity: Severity, title: string, rows: string[], note?: string) =>
  findings.push({ id, severity, title, rows, note })

/* ------------------------------------------------------------------ load */

const [batches, txns, counts, countItems, dispatchItems, orderItems, transfers, lots, locations] =
  await Promise.all([
    fetchAll('batches', 'id,batch_number,lot_id,weight_kg,sacks,sack_weight_kg,sku_type,status,location_id,location,received_at'),
    fetchAll('inventory_transactions', 'id,batch_id,type,weight_change_kg,physical_count_id,notes,created_at'),
    fetchAll('physical_counts', 'id,count_date,status,performed_by,reviewed_by,reviewed_at,total_variance_kg'),
    fetchAll('physical_count_items', 'id,physical_count_id,batch_id,system_kg,counted_kg,approved_at'),
    fetchAll('dispatch_items', 'id,dispatch_id,order_item_id,weight_dispatched_kg'),
    fetchAll('order_items', 'id,order_id,lot_id,batch_id,location_id,weight_ordered_kg'),
    fetchAll('transfers', 'id,batch_id,from_location_id,to_location_id,weight_kg,transferred_at'),
    fetchAll('lots', 'id,name'),
    fetchAll('locations', 'id,name'),
  ])

const lotName = new Map(lots.map(l => [l.id, l.name as string]))
const locName = new Map(locations.map(l => [l.id, l.name as string]))
const batchById = new Map(batches.map(b => [b.id, b]))
const txnsByBatch = new Map<string, any[]>()
for (const t of txns) {
  if (!txnsByBatch.has(t.batch_id)) txnsByBatch.set(t.batch_id, [])
  txnsByBatch.get(t.batch_id)!.push(t)
}
const itemsByCount = new Map<string, any[]>()
for (const i of countItems) {
  if (!itemsByCount.has(i.physical_count_id)) itemsByCount.set(i.physical_count_id, [])
  itemsByCount.get(i.physical_count_id)!.push(i)
}

const describe = (b: any) =>
  `${b.batch_number} [${(lotName.get(b.lot_id) ?? '?').slice(0, 34)}] @${locName.get(b.location_id) ?? 'NO-LOCATION'}`

/* ------------------------------------------------------- F1  approvals */
/* The one that matters most: a count marked approved that applied nothing. */
{
  const rows: string[] = []
  for (const c of counts) {
    if (c.status !== 'approved') continue
    const items = itemsByCount.get(c.id) ?? []
    const applied = items.filter(i => i.approved_at).length
    if (applied === items.length) continue
    const gapKg = kg(items.reduce((a, i) => a + (num(i.counted_kg) - num(i.system_kg)), 0))
    rows.push(
      `count ${c.count_date} reviewed by ${c.reviewed_by ?? '—'}: marked APPROVED but only ${applied}/${items.length} items applied — ${signed(gapKg)} kg of counted variance never written`
    )
  }
  report('F1', 'CRITICAL', 'Physical count marked approved without applying its items', rows,
    'handleCloseCount() sets status=approved without touching physical_count_items. The count looks done; nothing moved.')
}

/* ------------------------------------------- F2  gap never hit the ledger */
{
  const rows: string[] = []
  for (const c of counts) {
    if (c.status !== 'approved') continue
    for (const it of itemsByCount.get(c.id) ?? []) {
      const gap = kg(num(it.counted_kg) - num(it.system_kg))
      if (Math.abs(gap) <= 0.01) continue
      const adj = txns.filter(t => t.batch_id === it.batch_id && t.physical_count_id === c.id)
      const b = batchById.get(it.batch_id)
      const label = b ? describe(b) : `MISSING-BATCH ${it.batch_id}`
      if (adj.length === 0) {
        rows.push(`${c.count_date} ${label}: gap ${signed(gap)} kg — no adjustment transaction`)
      } else {
        const applied = kg(adj.reduce((a, t) => a + num(t.weight_change_kg), 0))
        if (Math.abs(applied - gap) > 0.01)
          rows.push(`${c.count_date} ${label}: gap ${signed(gap)} kg but ledger recorded ${signed(applied)} kg`)
      }
    }
  }
  report('F2', 'CRITICAL', 'Approved count gap missing from the ledger, or written with the wrong amount', rows)
}

/* ---------------------------------------------- F3  variance carried forward */
/* The recurrence signature: batch gapped in three or more separate counts. */
{
  const seen = new Map<string, string[]>()
  for (const it of countItems) {
    const gap = kg(num(it.counted_kg) - num(it.system_kg))
    if (Math.abs(gap) <= 0.01) continue
    const c = counts.find(x => x.id === it.physical_count_id)
    if (!c) continue
    const list = seen.get(it.batch_id) ?? []
    list.push(`${c.count_date}[${c.status.slice(0, 4)}] ${kg(num(it.system_kg))}→${kg(num(it.counted_kg))} (${signed(gap)})`)
    seen.set(it.batch_id, list)
  }
  const rows = [...seen]
    .filter(([, l]) => l.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, l]) => `${batchById.get(id)?.batch_number ?? id} gapped ${l.length}x: ${l.join('  |  ')}`)
  report('F3', 'CRITICAL', 'Same batch shows a gap in three or more separate counts', rows,
    'A variance that survives its own correction is not shrinkage — it is a write that never landed.')
}

/* ------------------------------------------------------- F4  ledger drift */
{
  const rows: string[] = []
  let noOpening = 0
  for (const b of batches) {
    const ts = txnsByBatch.get(b.id) ?? []
    if (!ts.some(t => t.type === 'receive')) { noOpening++; continue }
    const ledger = kg(ts.reduce((a, t) => a + num(t.weight_change_kg), 0))
    const drift = kg(num(b.weight_kg) - ledger)
    if (Math.abs(drift) > 0.01)
      rows.push(`${describe(b)}: weight_kg=${kg(num(b.weight_kg))} but transactions sum to ${ledger} (drift ${signed(drift)})`)
  }
  report('F4', 'CRITICAL', 'Batch weight disagrees with its own transaction history', rows,
    `${noOpening}/${batches.length} batches have no opening 'receive' transaction and were excluded — the ledger cannot reconstruct them at all.`)
}

/* --------------------------------------------------- F5  dispatch tracing */
{
  const oi = new Map(orderItems.map(o => [o.id, o]))
  const rows: string[] = []
  let untraceable = 0, untraceableKg = 0
  for (const di of dispatchItems) {
    const o = oi.get(di.order_item_id)
    if (!o) { rows.push(`dispatch_item ${di.id} points at a missing order_item`); continue }
    if (!o.batch_id) { untraceable++; untraceableKg += num(di.weight_dispatched_kg) }
  }
  if (untraceable)
    rows.unshift(`${untraceable} dispatch_items totalling ${kg(untraceableKg)} kg sit on order_items with no batch_id — this stock left the warehouse untraceable to a batch`)
  report('F5', 'CRITICAL', 'Dispatched stock cannot be traced to a batch', rows)
}

/* ------------------------------------------------------ F6  sack mismatch */
{
  const rows = batches
    .filter(b => b.sacks !== null && b.sack_weight_kg !== null)
    .map(b => ({ b, diff: kg(num(b.weight_kg) - num(b.sacks) * num(b.sack_weight_kg)) }))
    .filter(x => Math.abs(x.diff) > 0.01)
    .map(({ b, diff }) =>
      `${describe(b)}: weight_kg=${kg(num(b.weight_kg))} but ${b.sacks} x ${num(b.sack_weight_kg)}kg = ${kg(num(b.sacks) * num(b.sack_weight_kg))} (${signed(diff)})`)
  report('F6', 'HIGH', 'weight_kg disagrees with sacks x sack_weight_kg', rows,
    'The counter counts sacks. If these two disagree, the count is graded against the wrong number.')
}

/* ------------------------------------------------------- F7  ghost stock */
{
  const ghost = batches.filter(b => num(b.weight_kg) === 0 && num(b.sacks) > 0)
  const rows = ghost.map(b => `${describe(b)}: weight_kg=0 but ${b.sacks} sacks x ${num(b.sack_weight_kg)}kg still on the row`)
  report('F7', 'HIGH', 'Batch reads empty by weight but still holds sacks', rows,
    ghost.length ? `${ghost.reduce((a, b) => a + num(b.sacks), 0)} phantom sacks — a counter will find these bags on the floor and report a positive variance forever.` : undefined)
}

/* -------------------------------------------------- F8  uncountable stock */
{
  const rows = batches
    .filter(b => num(b.weight_kg) > 0 && (b.sacks === null || num(b.sacks) === 0))
    .map(b => `${describe(b)}: ${kg(num(b.weight_kg))} kg on hand but sacks=${b.sacks} — no unit for the counter to count`)
  report('F8', 'HIGH', 'Stock on hand with no sack count', rows)
}

/* ------------------------------------------------------ F9  location drift */
{
  const rows: string[] = []
  for (const b of batches) {
    const ts = transfers
      .filter(t => t.batch_id === b.id)
      .sort((a, x) => +new Date(a.transferred_at) - +new Date(x.transferred_at))
    if (!ts.length) continue
    const last = ts[ts.length - 1]
    if (last.to_location_id !== b.location_id)
      rows.push(`${b.batch_number}: last transfer went to ${locName.get(last.to_location_id) ?? '?'} but batch sits at ${locName.get(b.location_id) ?? 'NULL'}`)
  }
  report('F9', 'HIGH', 'Batch location disagrees with its most recent transfer', rows,
    'A location-scoped count will look for this stock in the wrong warehouse.')
}

/* ----------------------------------------------------------- F10 orphans */
{
  const ids = new Set(batches.map(b => b.id))
  const rows: string[] = []
  for (const t of txns) if (!ids.has(t.batch_id)) rows.push(`inventory_transaction ${t.id} (${t.type}, ${num(t.weight_change_kg)} kg) points at a deleted batch`)
  for (const i of countItems) if (!ids.has(i.batch_id)) rows.push(`physical_count_item ${i.id} points at a deleted batch`)
  for (const t of transfers) if (!ids.has(t.batch_id)) rows.push(`transfer ${t.id} points at a deleted batch`)
  for (const o of orderItems) if (o.batch_id && !ids.has(o.batch_id)) rows.push(`order_item ${o.id} points at a deleted batch`)
  report('F10', 'HIGH', 'Rows pointing at a batch that no longer exists', rows,
    'These FKs are unenforced in the schema.')
}

/* ---------------------------------------------- F11 stored variance total */
{
  const rows: string[] = []
  for (const c of counts) {
    const items = itemsByCount.get(c.id) ?? []
    if (!items.length) continue
    const computed = kg(items.reduce((a, i) => a + (num(i.counted_kg) - num(i.system_kg)), 0))
    const stored = c.total_variance_kg === null ? null : kg(num(c.total_variance_kg))
    if (stored === null || Math.abs(stored - computed) > 0.01)
      rows.push(`count ${c.count_date}: stored total_variance_kg=${stored} but items sum to ${computed}`)
  }
  report('F11', 'MEDIUM', 'physical_counts.total_variance_kg disagrees with its items', rows)
}

/* ------------------------------------------------------- F12 open counts */
{
  const rows = counts
    .filter(c => c.status !== 'approved' && c.status !== 'rejected')
    .map(c => {
      const items = itemsByCount.get(c.id) ?? []
      const gap = kg(items.reduce((a, i) => a + (num(i.counted_kg) - num(i.system_kg)), 0))
      return `count ${c.count_date} [${c.status}] by ${c.performed_by}: ${items.length} items, ${signed(gap)} kg unresolved`
    })
  report('F12', 'MEDIUM', 'Physical count still open', rows)
}

/* -------------------------------------------------- F13 uncounted stock */
{
  const counted = new Set(countItems.map(i => i.batch_id))
  const rows = batches
    .filter(b => num(b.weight_kg) > 0 && !counted.has(b.id))
    .map(b => `${describe(b)}: ${kg(num(b.weight_kg))} kg never included in any physical count`)
  report('F13', 'MEDIUM', 'Live stock never counted', rows)
}

/* -------------------------------------------- F14 unexplained adjustments */
{
  const rows = txns
    .filter(t => t.type === 'adjustment' && !t.physical_count_id)
    .map(t => `${t.created_at.slice(0, 10)} ${signed(kg(num(t.weight_change_kg)))} kg on ${batchById.get(t.batch_id)?.batch_number ?? t.batch_id} — notes: ${t.notes ?? '(none)'}`)
  report('F14', 'LOW', 'Adjustment not tied to a physical count', rows,
    'Manual corrections outside the count workflow. Not wrong, but unreviewed.')
}

/* ---------------------------------------------------------------- output */

const RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const sorted = findings.sort((a, b) => RANK[a.severity] - RANK[b.severity])
const active = sorted.filter(f => f.rows.length > 0)
const criticals = active.filter(f => f.severity === 'CRITICAL')

const liveBatches = batches.filter(b => num(b.weight_kg) > 0)
const liveKg = kg(liveBatches.reduce((a, b) => a + num(b.weight_kg), 0))

if (JSON_OUT) {
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    live_kg: liveKg,
    live_batches: liveBatches.length,
    findings: sorted.map(f => ({ id: f.id, severity: f.severity, title: f.title, affected: f.rows.length, note: f.note, rows: f.rows })),
  }, null, 2))
} else {
  console.log(`\ninventory-doctor — ${liveKg} kg live across ${liveBatches.length} batches, ${counts.length} counts on record\n`)
  if (!active.length) console.log('  No findings. Stock data is internally consistent.\n')
  for (const f of active) {
    console.log(`[${f.severity}] ${f.id} — ${f.title}  (${f.rows.length})`)
    if (f.note) console.log(`   ${f.note}`)
    for (const r of f.rows.slice(0, MAX_ROWS)) console.log(`   · ${r}`)
    if (f.rows.length > MAX_ROWS) console.log(`   … ${f.rows.length - MAX_ROWS} more (--full to see all)`)
    console.log()
  }
  const clean = sorted.filter(f => f.rows.length === 0).map(f => f.id)
  if (clean.length) console.log(`Clean: ${clean.join(', ')}\n`)
}

process.exit(criticals.length > 0 ? 1 : 0)
