import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isFixedWeightSku, skuUnit } from '@/lib/sku'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhysicalCount {
  id: string
  count_date: string
  performed_by: string
  status: string
  notes: string | null
  total_variance_kg: string | null
  variance_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_notes: string | null
  created_at: string
}

interface CountBatch {
  id: string
  batch_number: string
  created_at: string
  weight_kg: string
  sacks: number | null
  sack_weight_kg: string | null
  sku_type: string | null
  lots: { name: string } | null
  locations: { name: string } | null
}

interface PhysicalCountItem {
  id: string
  batch_id: string
  system_kg: string
  counted_kg: string
  counted_sacks: number | null
  counted_sack_weight_kg: string | null
  approved_at: string | null
  approved_by: string | null
  batches: {
    batch_number: string
    weight_kg: string
    sacks: number | null
    sack_weight_kg: string | null
    sku_type: string | null
    lot_id: string | null
    location_id: string | null
    lots: { name: string } | null
    locations: { name: string } | null
  } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function GapBadge({ gap }: { gap: number }) {
  if (Math.abs(gap) < 0.01) return <span className="text-green-600 font-medium text-xs">matched</span>
  const cls = gap < 0 ? 'text-red-600 font-semibold' : 'text-amber-600 font-semibold'
  return <span className={cls}>{gap > 0 ? '+' : ''}{gap.toFixed(2)} kg</span>
}

function skuLabel(sku: string | null): string {
  if (sku === 'retail_1kg') return '1 kg bags'
  return 'Commercial'
}

// Group an array by two keys: location → product name → items[]
function groupByLocProduct<T>(
  items: T[],
  getLoc: (i: T) => string,
  getProduct: (i: T) => string,
): [string, [string, T[]][]][] {
  const locMap = new Map<string, Map<string, T[]>>()
  for (const item of items) {
    const loc = getLoc(item)
    const prod = getProduct(item)
    if (!locMap.has(loc)) locMap.set(loc, new Map())
    const prodMap = locMap.get(loc)!
    if (!prodMap.has(prod)) prodMap.set(prod, [])
    prodMap.get(prod)!.push(item)
  }
  return Array.from(locMap.entries()).map(([loc, pm]) => [loc, Array.from(pm.entries())])
}

// ─── Shape shared by the entry screen and the printed sheet ───────────────────
// One row per product × packaging, one column per warehouse, Bagtikan first.
// Both surfaces build from this, so a printed sheet and the screen it is keyed
// into can never be in a different order — the counter reads straight down.

const WAREHOUSES = ['Bagtikan', 'Paco Warehouse'] as const

const packOf = (b: CountBatch) =>
  isFixedWeightSku(b.sku_type) ? 1 : (b.sack_weight_kg ? parseFloat(b.sack_weight_kg) : 1)

interface CountCell { product: string; pack: number; byWh: Record<string, CountBatch[]> }

function buildCells(batches: CountBatch[]): CountCell[] {
  const map = new Map<string, CountCell>()
  for (const b of batches) {
    const product = b.lots?.name ?? 'Unknown product'
    const pack = packOf(b)
    const key = `${product}||${pack}`
    const e = map.get(key) ?? { product, pack, byWh: {} }
    const wh = b.locations?.name ?? 'Untagged'
    ;(e.byWh[wh] ??= []).push(b)
    map.set(key, e)
  }
  for (const e of map.values())
    for (const list of Object.values(e.byWh))
      list.sort((a, b) => parseFloat(b.weight_kg) - parseFloat(a.weight_kg))
  // Packaging descends within a product: a counter stands in front of one coffee
  // and reads sacks before bags, which is the order the bays are stacked in.
  return [...map.values()].sort((a, b) =>
    a.product.localeCompare(b.product) || b.pack - a.pack)
}

// EXPECTED, the figure a count is really tested against:
//     last approved count  +  every ledger row dated after it
// batches.weight_kg should equal this now that every write path records a
// movement; where it does not, something changed stock without saying so and
// that is surfaced rather than hidden.
interface Expectation {
  expected: Record<string, number>
  since: Record<string, { type: string; kg: number; note: string }[]>
  anchorDate: string | null
}

function useCountExpectation() {
  return useQuery<Expectation>({
    queryKey: ['count-expectation'],
    queryFn: async () => {
      const { data: counts } = await supabase
        .from('physical_counts').select('id, count_date')
        .eq('status', 'approved').order('count_date', { ascending: false }).limit(1)
      const last = counts?.[0]
      if (!last) return { expected: {}, since: {}, anchorDate: null }

      const { data: items } = await supabase
        .from('physical_count_items').select('batch_id, counted_kg')
        .eq('physical_count_id', last.id)
      // Exclude the rows the anchor count itself wrote when it was approved —
      // counted_kg already reflects them, so adding them again doubles the figure.
      const { data: txns } = await supabase
        .from('inventory_transactions')
        .select('batch_id, type, weight_change_kg, notes, created_at, physical_count_id')
        .gt('created_at', `${last.count_date}T23:59:59`)
        .or(`physical_count_id.is.null,physical_count_id.neq.${last.id}`)

      const expected: Record<string, number> = {}
      for (const i of items ?? []) expected[i.batch_id as string] = parseFloat(i.counted_kg ?? '0')
      const since: Record<string, { type: string; kg: number; note: string }[]> = {}
      for (const t of txns ?? []) {
        const id = t.batch_id as string
        const kg = parseFloat(t.weight_change_kg ?? '0')
        expected[id] = (expected[id] ?? 0) + kg
        ;(since[id] ??= []).push({ type: t.type as string, kg, note: (t.notes as string) ?? '' })
      }
      return { expected, since, anchorDate: last.count_date as string }
    },
  })
}

// ─── Batch row override state ─────────────────────────────────────────────────

interface RowOverride { included?: boolean; sacks?: string; sackWeightKg?: string; extraBags?: string }
type Overrides = Record<string, RowOverride>

function getRow(batch: CountBatch, overrides: Overrides) {
  const o = overrides[batch.id] ?? {}
  const fixed = isFixedWeightSku(batch.sku_type)
  return {
    included:     o.included     ?? true,
    // Deliberately blank: a prefilled number is indistinguishable from a counted
    // one, and an untouched prefill is how batches were silently zeroed.
    sacks:        o.sacks        ?? '',
    sackWeightKg: fixed ? '1' : (o.sackWeightKg ?? (batch.sack_weight_kg ?? '')),
    extraBags:    o.extraBags    ?? '',
  }
}

function computeTotalKg(sacks: string, sackWeightKg: string, extraBags: string): number {
  const s = parseFloat(sacks)
  const w = parseFloat(sackWeightKg)
  const sacksKg = s > 0 && w > 0 ? s * w : 0
  const bagsKg = Math.max(0, parseInt(extraBags) || 0)
  return sacksKg + bagsKg
}

// ─── Printed count sheet ──────────────────────────────────────────────────────
// Paper on purpose: the bays have no signal and gloves do not work on glass.
//
// The sheet is BLIND by default — it carries no expected figure. The costliest
// failure in this system has not been miscounting, it is a warehouse being
// carried forward instead of walked, and a printed expectation makes that both
// easier to do and impossible to detect afterwards: a copied figure and a real
// recount are byte-identical on paper. Paco read Robusta 315 / Lam Dong 342 /
// Cerrado 498 on four consecutive counts. Expected is revealed on screen the
// moment a row is keyed, so the counter still gets the feedback — just after
// committing to a number rather than before.
//
// "Print with expected" exists for spot-checks and for a second pass on a bay
// that already came back wrong. It stamps the sheet, so the two kinds of sheet
// can never be mistaken for each other later.

/**
 * Expected, written the way a person at a pallet reads it: whole sacks, plus the
 * loose kilos that cannot be expressed as one. "20,520 kg" is unusable in front of
 * a stack — "342 sk" is the number they are about to compare against.
 */
function expectedInSacks(kg: number, pack: number): string {
  if (pack <= 1) return `${Math.round(kg)} bag${Math.round(kg) === 1 ? '' : 's'}`
  const sacks = Math.floor(kg / pack)
  const loose = Math.round((kg - sacks * pack) * 100) / 100
  return loose > 0.005 ? `${sacks} sk + ${loose} kg` : `${sacks} sk`
}

const SHEET_PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #count-sheet, #count-sheet * { visibility: visible !important; }
  #count-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .sheet-noprint { display: none !important; }
  .sheet-page { break-after: page; }
  .sheet-page:last-child { break-after: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @page { size: A4 portrait; margin: 12mm; }
}`

function CountSheetDialog({ onClose }: { onClose: () => void }) {
  const [countDate, setCountDate] = useState(todayStr())
  const [picked, setPicked] = useState<string[]>([...WAREHOUSES])
  const [includeZero, setIncludeZero] = useState(false)
  const [showExpected, setShowExpected] = useState(false)

  // No weight filter here, unlike the entry screen: a batch the book says is
  // empty is exactly the case worth walking. Robusta 60kg at Bagtikan read 0 on
  // the book while three sacks sat on the floor.
  const { data: batches = [], isLoading } = useQuery<CountBatch[]>({
    queryKey: ['batches-for-sheet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, created_at, weight_kg, sacks, sack_weight_kg, sku_type, lots(name), locations(name)')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as CountBatch[]
    },
  })
  const { data: expectation } = useCountExpectation()

  const expectedFor = (bs: CountBatch[]) =>
    bs.reduce((t, b) => t + (expectation?.expected[b.id] ?? parseFloat(b.weight_kg)), 0)

  const allCells = buildCells(batches)
  const rowsFor = (wh: string) => allCells
    .map(c => ({ c, bs: c.byWh[wh] ?? [] }))
    .filter(({ bs }) => bs.length > 0)
    .filter(({ bs }) => includeZero || bs.some(b => parseFloat(b.weight_kg) > 0))

  const printedAt = new Date().toLocaleString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const dateLabel = new Date(countDate + 'T00:00:00')
    .toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
  const pages = picked.filter(wh => rowsFor(wh).length > 0)

  const toggleWh = (wh: string) =>
    setPicked(p => p.includes(wh) ? p.filter(x => x !== wh) : [...p, wh])

  const box = 'inline-block border border-gray-400 h-7 w-20 align-middle'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-auto print:bg-white print:p-0"
         onClick={onClose}>
      <style>{SHEET_PRINT_CSS}</style>
      <div className="bg-white w-full max-w-4xl my-4 rounded-lg shadow-lg" onClick={e => e.stopPropagation()}>

        <div className="sheet-noprint px-6 py-4 border-b border-gray-200 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Print count sheet</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => window.print()} disabled={pages.length === 0}>Print / Save PDF</Button>
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Count date</Label>
              <Input type="date" value={countDate} onChange={e => setCountDate(e.target.value)} className="w-44" />
            </div>
            <div className="space-y-1.5">
              <Label>Warehouses</Label>
              <div className="flex gap-3 h-9 items-center">
                {WAREHOUSES.map(wh => (
                  <label key={wh} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={picked.includes(wh)} onChange={() => toggleWh(wh)} />
                    {wh === 'Paco Warehouse' ? 'Paco WH' : wh}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 h-9">
              <input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} />
              Include products the book shows as empty
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
            <input type="checkbox" className="mt-0.5" checked={showExpected}
                   onChange={e => setShowExpected(e.target.checked)} />
            <span>
              <span className="font-medium">Print with expected figures</span> — spot-check only.
              <span className="block text-xs text-amber-800 mt-0.5">
                A printed expectation is what a tired counter writes down. Use this to re-check a bay
                that already came back wrong, not to take a count. The sheet is stamped either way.
              </span>
            </span>
          </label>
        </div>

        <div id="count-sheet" className="px-6 py-5 text-[13px] text-gray-900">
          {isLoading && <p className="text-gray-400">Loading products…</p>}
          {!isLoading && pages.length === 0 && (
            <p className="text-gray-400">Nothing to print — pick a warehouse with stock, or include empty products.</p>
          )}
          {pages.map((wh, i) => (
            <div key={wh} className="sheet-page">
              <div className="flex items-start justify-between border-b-2 border-gray-800 pb-2">
                <div>
                  <div className="text-base font-bold tracking-tight">EIGHTYPLUS — PHYSICAL COUNT SHEET</div>
                  <div className="mt-1 text-sm">
                    Warehouse: <span className="font-semibold">{wh === 'Paco Warehouse' ? 'PACO WH' : wh.toUpperCase()}</span>
                    <span className="mx-3 text-gray-300">|</span>
                    Count date: <span className="font-semibold">{dateLabel}</span>
                  </div>
                  <div className="mt-1 text-sm">Counted by: <span className="inline-block border-b border-gray-400 w-52 align-bottom" /></div>
                </div>
                <div className="text-right text-xs text-gray-500 shrink-0">
                  <div>Sheet {i + 1} of {pages.length}</div>
                  <div className="mt-0.5">Printed {printedAt}</div>
                  {showExpected && (
                    <div className="mt-1.5 inline-block border border-gray-800 px-1.5 py-0.5 font-bold tracking-wide">
                      SPOT CHECK — EXPECTED SHOWN
                    </div>
                  )}
                </div>
              </div>

              <table className="w-full mt-3 border-collapse">
                <thead>
                  <tr className="border-b border-gray-400 text-[11px] uppercase tracking-wide text-gray-600">
                    <th className="text-left py-1.5 pr-2 font-semibold">Product</th>
                    <th className="text-right py-1.5 px-2 font-semibold whitespace-nowrap">Packaging</th>
                    {showExpected && <th className="text-right py-1.5 px-2 font-semibold whitespace-nowrap">Expected</th>}
                    <th className="text-center py-1.5 px-2 font-semibold w-24">Sacks</th>
                    <th className="text-center py-1.5 pl-2 font-semibold w-24">Loose kg</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsFor(wh).map(({ c, bs }, idx, arr) => {
                    // A rule between products, not between packagings of the same
                    // product, so the eye groups the way the bays are stacked.
                    const lastOfProduct = idx === arr.length - 1 || arr[idx + 1].c.product !== c.product
                    return (
                      <tr key={`${c.product}-${c.pack}`}
                          className={lastOfProduct ? 'border-b border-gray-300' : ''}>
                        <td className="py-1.5 pr-2 align-middle">{c.product}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{c.pack} kg</td>
                        {showExpected && (
                          <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                            {expectedInSacks(expectedFor(bs), c.pack)}
                          </td>
                        )}
                        <td className="py-1.5 px-2 text-center"><span className={box} /></td>
                        {/* Loose kilos get their own box because a part-sack pick cannot be
                            written in whole sacks — forcing it into the sack box is what
                            produced variances that were never real. 1 kg bags have no
                            remainder to express, so the box is omitted there. */}
                        <td className="py-1.5 pl-2 text-center">
                          {c.pack === 1 ? <span className="text-gray-300">—</span> : <span className={box} />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="mt-4 pt-3 border-t border-gray-400 text-xs space-y-3">
                {/* Blank means NOT COUNTED and leaves stock untouched. That rule already
                    governs the entry screen; the paper has to say it too, or a bay nobody
                    walked comes back looking like a bay that was counted as empty. */}
                <p className="text-gray-600">
                  Leave a row <span className="font-semibold">blank</span> if you did not count it — blank leaves
                  the stock alone. Write <span className="font-semibold">0</span> only if the bay is genuinely empty.
                </p>
                <div>Bays not counted, and why: <span className="inline-block border-b border-gray-400 w-full max-w-xl align-bottom h-4" /></div>
                <div className="flex gap-10 pt-1">
                  <div className="flex-1">Signature: <span className="inline-block border-b border-gray-400 w-48 align-bottom h-4" /></div>
                  <div>Time finished: <span className="inline-block border-b border-gray-400 w-24 align-bottom h-4" /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── History ──────────────────────────────────────────────────────────────────

function CountHistory({ counts, onStart }: { counts: PhysicalCount[]; onStart: () => void }) {
  const completed = counts.filter(c => c.status === 'approved' || c.status === 'rejected')
  const [sheet, setSheet] = useState(false)
  return (
    <div className="space-y-4">
      {sheet && <CountSheetDialog onClose={() => setSheet(false)} />}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">No active count session.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSheet(true)}>Print count sheet</Button>
          <Button onClick={onStart}>Start Physical Count</Button>
        </div>
      </div>
      {completed.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Performed By</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Reviewed By</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Net Variance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Notes</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Result</th>
                </tr>
              </thead>
              <tbody>
                {completed.map(c => (
                  <tr key={c.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-600">{new Date(c.count_date + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-gray-600">{c.performed_by}</td>
                    <td className="px-4 py-3 text-gray-600">{c.reviewed_by ?? '—'}</td>
                    <td className="px-4 py-3 text-right"><GapBadge gap={parseFloat(c.total_variance_kg ?? '0')} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">{c.variance_notes ?? (c.rejection_notes ? `Rejected: ${c.rejection_notes}` : '—')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {c.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Count Form ───────────────────────────────────────────────────────────────

function CountForm({ existingCount, onCancel }: { existingCount?: PhysicalCount; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [countDate, setCountDate] = useState(existingCount?.count_date ?? todayStr())
  const [performedBy, setPerformedBy] = useState(existingCount?.performed_by ?? '')
  const [notes, setNotes] = useState(existingCount?.notes ?? '')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState(false)

  const { data: batches = [], isLoading } = useQuery<CountBatch[]>({
    queryKey: ['batches-for-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, created_at, weight_kg, sacks, sack_weight_kg, sku_type, lots(name), locations(name)')
        .gt('weight_kg', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as CountBatch[]
    },
  })

  const setOverride = (batchId: string, field: keyof RowOverride, value: string | boolean) =>
    setOverrides(prev => ({ ...prev, [batchId]: { ...(prev[batchId] ?? {}), [field]: value } }))

  const { data: expectation } = useCountExpectation()

  const expectedFor = (bs: CountBatch[]) =>
    bs.reduce((t, b) => t + (expectation?.expected[b.id] ?? parseFloat(b.weight_kg)), 0)
  const movementsFor = (bs: CountBatch[]) =>
    bs.flatMap(b => expectation?.since[b.id] ?? [])

  // A cell can cover several batches; the largest carries the counted figure and
  // its siblings go to zero, the same rule used when CK's sheet was applied.
  const cells = buildCells(batches)

  /** The batch a cell writes to, plus the siblings that must be zeroed with it. */
  const cellBatches = (c: { byWh: Record<string, CountBatch[]> }, wh: string) => {
    const list = c.byWh[wh] ?? []
    return { rep: list[0] ?? null, others: list.slice(1) }
  }

  const entered = (() => {
    const reps = new Set<string>(); const zeros = new Set<string>()
    for (const c of cells) for (const wh of WAREHOUSES) {
      const { rep, others } = cellBatches(c, wh)
      if (!rep) continue
      const row = getRow(rep, overrides)
      if (!row.included || row.sacks === '') continue
      reps.add(rep.id)
      // A batch created AFTER the count date cannot have been on the sheet, so
      // zeroing it deletes stock the counter never saw. On 18 Sept this wiped
      // the Lam Dong and Robusta batches transferred that morning.
      for (const o of others) {
        if (o.created_at && o.created_at.slice(0, 10) > countDate) continue
        zeros.add(o.id)
      }
    }
    return { reps, zeros }
  })()
  const includedBatches = batches.filter(b => entered.reps.has(b.id) || entered.zeros.has(b.id))
  const countedSacksFor = (b: CountBatch) =>
    entered.zeros.has(b.id) ? '0' : getRow(b, overrides).sacks

  const netVariance = includedBatches.reduce((sum, b) => {
    const row = getRow(b, overrides)
    return sum + computeTotalKg(countedSacksFor(b), row.sackWeightKg, row.extraBags) - parseFloat(b.weight_kg)
  }, 0)

  const handleSubmit = async () => {
    if (!performedBy.trim()) { setError('Performed by is required.'); return }
    if (includedBatches.length === 0) { setError('Include at least one product.'); return }
    setError(''); setSubmitting(true)

    const { data: countData, error: countErr } = await supabase
      .from('physical_counts')
      .insert([{
        count_date: countDate,
        performed_by: performedBy.trim(),
        status: 'pending_approval',
        notes: notes.trim() || null,
        total_variance_kg: netVariance.toFixed(2),
      }])
      .select()
    if (countErr) { setError(countErr.message); setSubmitting(false); return }

    const countId = countData[0].id
    const items = includedBatches.map(b => {
      const row = getRow(b, overrides)
      const fixed = isFixedWeightSku(b.sku_type)
      return {
        physical_count_id: countId,
        batch_id: b.id,
        system_kg: parseFloat(b.weight_kg).toFixed(2),
        counted_kg: computeTotalKg(countedSacksFor(b), row.sackWeightKg, row.extraBags).toFixed(2),
        counted_sacks: parseInt(countedSacksFor(b)) || 0,
        counted_sack_weight_kg: fixed ? 1 : (parseFloat(row.sackWeightKg) || null),
      }
    })

    const { error: itemsErr } = await supabase.from('physical_count_items').insert(items)
    if (itemsErr) { setError(itemsErr.message); setSubmitting(false); return }

    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    setSubmitting(false)
  }

  const inputCls = "w-20 text-right rounded-md border border-gray-200 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-300"

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <div className="space-y-1.5">
            <Label>Count Date *</Label>
            <Input type="date" value={countDate} onChange={e => setCountDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Performed By *</Label>
            <Input value={performedBy} onChange={e => setPerformedBy(e.target.value)} placeholder="Name" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this count…" />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <Button size="sm" variant="outline" onClick={() => setSheet(true)}>Print count sheet</Button>
          <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      </div>
      {sheet && <CountSheetDialog onClose={() => setSheet(false)} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Packaging</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Bagtikan</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Paco WH</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Counted kg</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Expected kg</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Since last count</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading products…</td></tr>
              )}
              {cells.map(c => {
                const perWh = WAREHOUSES.map(wh => {
                  const { rep } = cellBatches(c, wh)
                  const row = rep ? getRow(rep, overrides) : null
                  const sacks = row ? parseFloat(row.sacks) || 0 : 0
                  const systemKg = (c.byWh[wh] ?? []).reduce((t, b) => t + parseFloat(b.weight_kg), 0)
                  return { wh, rep, row, sacks, countedKg: sacks * c.pack, systemKg }
                })
                const anyEntered = perWh.some(w => w.row?.included && w.row.sacks !== '')
                const countedKg = perWh.reduce((t, w) => t + (w.row?.included ? w.countedKg : 0), 0)
                const systemKg  = perWh.reduce((t, w) => t + w.systemKg, 0)
                const cellBs    = WAREHOUSES.flatMap(wh => c.byWh[wh] ?? [])
                const expectedKg = expectation ? expectedFor(cellBs) : systemKg
                const moves     = movementsFor(cellBs)
                // book vs expected diverging means stock moved without a ledger row
                const bookDrift = Math.abs(systemKg - expectedKg) >= 0.01
                const variance  = countedKg - expectedKg
                const hasVariance = anyEntered && Math.abs(variance) >= 0.01
                return (
                  <tr key={`${c.product}-${c.pack}`}
                      className={`border-b border-gray-100 ${hasVariance ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-3 py-2 text-gray-900">{c.product}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{c.pack}kg</td>
                    {perWh.map(w => (
                      <td key={w.wh} className="px-3 py-2 text-right">
                        {w.rep ? (
                          <input
                            type="number" min="0" step="1"
                            value={w.row?.sacks ?? ''}
                            onChange={e => {
                              setOverride(w.rep!.id, 'sacks', e.target.value)
                              setOverride(w.rep!.id, 'sackWeightKg', String(c.pack))
                              setOverride(w.rep!.id, 'included', true)
                            }}
                            placeholder="—"
                            title={`${w.rep.batch_number} · system ${w.systemKg.toFixed(0)} kg`}
                            className={inputCls}
                          />
                        ) : (
                          <span className="text-gray-200 text-xs">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">
                      {anyEntered ? `${countedKg.toFixed(2)} kg` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums text-xs">
                      {expectedKg.toFixed(0)} kg
                      {bookDrift && (
                        <span className="block text-[10px] text-red-500"
                              title={`The book says ${systemKg.toFixed(0)} kg. Stock moved without a recorded movement.`}>
                          book {systemKg.toFixed(0)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {moves.length === 0
                        ? <span className="text-gray-300">no movement</span>
                        : (() => {
                            const by: Record<string, number> = {}
                            for (const m of moves) by[m.type] = (by[m.type] ?? 0) + m.kg
                            return (
                              <span title={moves.map(m => `${m.type} ${m.kg > 0 ? '+' : ''}${m.kg} — ${m.note}`).join('\n')}>
                                {Object.entries(by).map(([t, kg]) =>
                                  `${t} ${kg > 0 ? '+' : ''}${kg.toFixed(0)}`).join(' · ')}
                              </span>
                            )
                          })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {anyEntered ? <GapBadge gap={variance} /> : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {includedBatches.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-3 py-3 text-sm font-semibold text-gray-700 text-right">
                    Net variance · {includedBatches.length} line{includedBatches.length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-3 py-3 text-right"><GapBadge gap={netVariance} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleSubmit} disabled={submitting || isLoading || includedBatches.length === 0}>
        {submitting ? 'Submitting…' : `Submit ${includedBatches.length} batch${includedBatches.length !== 1 ? 'es' : ''} for Approval`}
      </Button>
    </div>
  )
}

// ─── Approval View ────────────────────────────────────────────────────────────

interface ItemEdit { sacks: string; sackWeightKg: string; extraBags: string }
type ItemEdits = Record<string, ItemEdit>

function getItemEdit(item: PhysicalCountItem, edits: ItemEdits): ItemEdit {
  if (edits[item.id]) return edits[item.id]
  const fixed = isFixedWeightSku(item.batches?.sku_type)
  return {
    sacks:        item.counted_sacks != null ? String(item.counted_sacks) : '',
    sackWeightKg: fixed ? '1' : (item.counted_sack_weight_kg ?? ''),
    extraBags:    '',
  }
}

function getItemCountedKg(item: PhysicalCountItem, edits: ItemEdits): number {
  if (edits[item.id]) {
    const edit = edits[item.id]
    // Extra bags go to a separate retail_1kg batch, so show only commercial sacks weight
    const sacksKg = computeTotalKg(edit.sacks, edit.sackWeightKg, '')
    if (sacksKg > 0) return sacksKg
  }
  return parseFloat(item.counted_kg)
}

function ApprovalView({ count, onDone }: { count: PhysicalCount; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [reviewedBy, setReviewedBy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<ItemEdits>({})
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')

  const { data: items = [], isLoading, refetch } = useQuery<PhysicalCountItem[]>({
    queryKey: ['physical-count-items', count.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physical_count_items')
        .select('id, batch_id, system_kg, counted_kg, counted_sacks, counted_sack_weight_kg, approved_at, approved_by, batches(batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lot_id, location_id, lots(name), locations(name))')
        .eq('physical_count_id', count.id)
      if (error) throw error
      return data as unknown as PhysicalCountItem[]
    },
    refetchInterval: 30_000,
  })

  // A count is a snapshot of the day it was taken. Anything dispatched after
  // that has already left the shelf, so approving must SUBTRACT it rather than
  // silently putting it back — which is what a plain "set to counted" does.
  const { data: shippedSince = {} } = useQuery<Record<string, { kg: number; refs: string[] }>>({
    queryKey: ['shipped-since-count', count.id, count.count_date],
    queryFn: async () => {
      const { data: disp, error: dErr } = await supabase
        .from('dispatches')
        .select('id, dr_number, dispatched_date, orders(os_number, clients(company_name))')
        .gt('dispatched_date', count.count_date)
      if (dErr) throw dErr
      const ids = (disp ?? []).map(d => d.id as string)
      if (ids.length === 0) return {}
      const meta = new Map((disp ?? []).map(d => {
        const o = d.orders as unknown as { os_number: string; clients: { company_name: string } | null } | null
        return [d.id as string, `DR ${d.dr_number} · ${o?.os_number ?? '—'} · ${o?.clients?.company_name ?? ''}`]
      }))
      const { data: lines, error: lErr } = await supabase
        .from('dispatch_items')
        .select('weight_dispatched_kg, dispatch_id, order_items(batch_id)')
        .in('dispatch_id', ids)
      if (lErr) throw lErr
      const map: Record<string, { kg: number; refs: string[] }> = {}
      for (const l of lines ?? []) {
        const batchId = (l.order_items as unknown as { batch_id: string | null } | null)?.batch_id
        if (!batchId) continue
        const e = map[batchId] ?? { kg: 0, refs: [] }
        const kg = parseFloat(l.weight_dispatched_kg ?? '0')
        e.kg += kg
        const ref = meta.get(l.dispatch_id as string)
        if (ref) e.refs.push(`${ref} — ${kg} kg`)
        map[batchId] = e
      }
      return map
    },
  })

  const pendingItems  = items.filter(i => !i.approved_at)
  const approvedItems = items.filter(i =>  i.approved_at)

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const setEdit = (id: string, field: keyof ItemEdit, value: string) =>
    setEdits(prev => ({
      ...prev,
      [id]: { ...getItemEdit(items.find(i => i.id === id)!, prev), [field]: value },
    }))

  const handleApproveSelected = async () => {
    if (!reviewedBy.trim()) { setError('Reviewed by is required.'); return }
    if (selected.size === 0) { setError('Select at least one item.'); return }
    setError(''); setSubmitting(true)

    const toApprove = pendingItems.filter(i => selected.has(i.id))
    const now = new Date().toISOString()
    const txNote = `Physical count ${count.count_date} by ${count.performed_by}, approved by ${reviewedBy.trim()}`

    for (const item of toApprove) {
      const edit = getItemEdit(item, edits)
      const fixed = isFixedWeightSku(item.batches?.sku_type)
      const extraBagsCount = parseInt(edit.extraBags) || 0

      // Commercial batch: sacks × weight only; extra bags go to retail_1kg batch
      const editedKg = computeTotalKg(edit.sacks, edit.sackWeightKg, '')
      const finalCountedKg = editedKg > 0 ? editedKg : parseFloat(item.counted_kg)
      const finalSacks = parseInt(edit.sacks) || item.counted_sacks
      const finalSackWeight = fixed ? 1 : (parseFloat(edit.sackWeightKg) || (item.counted_sack_weight_kg ? parseFloat(item.counted_sack_weight_kg) : null))

      // Persist edits back to the item row
      if (edits[item.id]) {
        await supabase.from('physical_count_items').update({
          counted_kg:            finalCountedKg.toFixed(2),
          counted_sacks:         finalSacks,
          counted_sack_weight_kg: finalSackWeight,
        }).eq('id', item.id)
      }

      // Stack, don't overwrite: counted on the day, less whatever shipped since.
      const shipped = shippedSince[item.batch_id]?.kg ?? 0
      const targetKg = Math.max(0, finalCountedKg - shipped)
      const currentKg = parseFloat(item.batches?.weight_kg ?? item.system_kg)
      const delta = targetKg - currentKg

      if (Math.abs(delta) >= 0.01) {
        await supabase.from('inventory_transactions').insert([{
          batch_id:          item.batch_id,
          type:              'adjustment',
          weight_change_kg:  delta.toFixed(2),
          physical_count_id: count.id,
          notes:             txNote,
        }])
      }

      await supabase.from('batches').update({
        weight_kg: targetKg,
        ...(finalSacks != null    && { sacks: finalSacks }),
        ...(finalSackWeight != null && { sack_weight_kg: finalSackWeight }),
      }).eq('id', item.batch_id)

      await supabase.from('physical_count_items').update({
        approved_at: now,
        approved_by: reviewedBy.trim(),
      }).eq('id', item.id)

      // Extra bags → find or create a retail_1kg batch for same product + location
      if (extraBagsCount > 0) {
        const lotId      = item.batches?.lot_id
        const locationId = item.batches?.location_id
        if (lotId) {
          const { data: existing } = await supabase
            .from('batches')
            .select('id, weight_kg, sacks')
            .eq('lot_id', lotId)
            .eq('sku_type', 'retail_1kg')
            .eq('location_id', locationId)
            .limit(1)

          if (existing && existing.length > 0) {
            const retail    = existing[0]
            const newWeight = parseFloat(retail.weight_kg) + extraBagsCount
            const newSacks  = (retail.sacks ?? 0) + extraBagsCount
            await supabase.from('batches').update({ weight_kg: newWeight, sacks: newSacks }).eq('id', retail.id)
            await supabase.from('inventory_transactions').insert([{
              batch_id:          retail.id,
              type:              'adjustment',
              weight_change_kg:  extraBagsCount.toFixed(2),
              physical_count_id: count.id,
              notes:             `${txNote} — +${extraBagsCount} x 1kg bags`,
            }])
          } else {
            const today = new Date().toISOString().slice(0, 10)
            const { data: newBatch } = await supabase.from('batches').insert([{
              lot_id:        lotId,
              sku_type:      'retail_1kg',
              weight_kg:     extraBagsCount,
              sacks:         extraBagsCount,
              sack_weight_kg: 1,
              location_id:   locationId,
              received_at:   today,
            }]).select('id')
            if (newBatch && newBatch.length > 0) {
              await supabase.from('inventory_transactions').insert([{
                batch_id:          newBatch[0].id,
                type:              'adjustment',
                weight_change_kg:  extraBagsCount.toFixed(2),
                physical_count_id: count.id,
                notes:             `${txNote} — created ${extraBagsCount} x 1kg bags`,
              }])
            }
          }
        }
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    await refetch()
    setSelected(new Set())
    setEdits({})
    setSubmitting(false)
  }

  const handleCloseCount = async () => {
    if (!reviewedBy.trim()) { setError('Reviewed by is required.'); return }
    setError(''); setClosing(true)
    await supabase.from('physical_counts').update({
      status:      'approved',
      reviewed_by: reviewedBy.trim(),
      reviewed_at: new Date().toISOString(),
    }).eq('id', count.id)
    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    setClosing(false)
    onDone()
  }

  const inputCls = "w-20 text-right rounded-md border border-gray-200 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"

  const renderSection = (rows: PhysicalCountItem[], isPending: boolean) => {
    const grouped = groupByLocProduct(
      rows,
      i => i.batches?.locations?.name ?? 'Untagged',
      i => i.batches?.lots?.name ?? 'Unknown product',
    )

    return grouped.map(([locName, products]) => (
      <Fragment key={`${locName}-${isPending}`}>
        <tr>
          <td colSpan={11} className="px-4 pt-4 pb-1.5">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">{locName}</span>
            <div className="mt-1 h-px bg-gray-300" />
          </td>
        </tr>
        {products.map(([productName, prodItems]) => (
          <Fragment key={productName}>
            <tr>
              <td colSpan={11} className="px-4 pt-3 pb-1 pl-6">
                <span className="text-sm font-semibold text-gray-800">{productName}</span>
                {prodItems.length > 1 && (
                  <span className="ml-2 text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full">
                    {prodItems.length} batches
                  </span>
                )}
              </td>
            </tr>
            {prodItems.map(item => {
              const fixed = isFixedWeightSku(item.batches?.sku_type)
              const unit = skuUnit(item.batches?.sku_type)
              const edit = getItemEdit(item, edits)
              const countedKg = getItemCountedKg(item, edits)
              const currentKg = parseFloat(item.batches?.weight_kg ?? item.system_kg)
              const liveGap = isPending
                ? countedKg - currentKg
                : parseFloat(item.counted_kg) - parseFloat(item.system_kg)
              const isSelected = selected.has(item.id)
              const isDirty = !!edits[item.id]

              return (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 ${isPending && isSelected ? 'bg-blue-50/40' : ''} ${!isPending ? 'opacity-55' : ''}`}
                >
                  <td className="px-4 py-2 text-center pl-6">
                    {isPending
                      ? <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} className="rounded border-gray-300" />
                      : <span className="text-green-500 text-xs">✓</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-gray-400">{item.batches?.batch_number ?? '—'}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${fixed ? 'text-purple-600 bg-purple-50' : 'text-gray-500 bg-gray-100'}`}>
                      {skuLabel(item.batches?.sku_type ?? null)}
                    </span>
                    {isDirty && isPending && (
                      <span className="ml-1 text-xs text-amber-600 font-medium">edited</span>
                    )}
                  </td>

                  {/* Counted — editable for pending items */}
                  {isPending ? (
                    <>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" min="0" step="1"
                          value={edit.sacks}
                          onChange={e => setEdit(item.id, 'sacks', e.target.value)}
                          placeholder={item.counted_sacks != null ? String(item.counted_sacks) : '—'}
                          className={inputCls}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fixed
                          ? <span className="text-xs text-gray-400 tabular-nums">1.000</span>
                          : <input
                              type="number" min="0" step="0.001"
                              value={edit.sackWeightKg}
                              onChange={e => setEdit(item.id, 'sackWeightKg', e.target.value)}
                              placeholder={item.counted_sack_weight_kg ?? '—'}
                              className={inputCls}
                            />
                        }
                      </td>
                      {/* Extra 1kg bags — only for commercial batches */}
                      <td className="px-3 py-2 text-right">
                        {fixed ? (
                          <span className="text-gray-200 text-xs">—</span>
                        ) : (
                          <input
                            type="number" min="0" step="1"
                            value={edit.extraBags}
                            onChange={e => setEdit(item.id, 'extraBags', e.target.value)}
                            placeholder="0"
                            className={inputCls}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">
                        {countedKg > 0 ? `${countedKg.toFixed(2)} kg` : <span className="text-gray-300">—</span>}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-2 text-right tabular-nums text-xs text-gray-600">
                      {item.counted_sacks != null ? <>{item.counted_sacks} {unit} · </> : ''}{parseFloat(item.counted_kg).toFixed(2)} kg
                    </td>
                  )}

                  <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-400">{parseFloat(item.system_kg).toFixed(2)}</td>
                  {/* What left the shelf after the count was taken — subtracted on approval */}
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {(() => {
                      const sent = shippedSince[item.batch_id]
                      if (!sent || sent.kg <= 0) return <span className="text-gray-200">—</span>
                      return (
                        <span className="text-amber-700 cursor-help" title={sent.refs.join('\n')}>
                          −{sent.kg.toFixed(2)}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs font-medium text-gray-700">{currentKg.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right"><GapBadge gap={liveGap} /></td>
                  <td className="px-3 py-2 text-xs text-gray-400">
                    {!isPending && item.approved_by ? `by ${item.approved_by}` : ''}
                  </td>
                </tr>
              )
            })}
          </Fragment>
        ))}
      </Fragment>
    ))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Pending Approval</p>
        <p className="text-xs text-amber-600 mt-0.5">
          Count by <strong>{count.performed_by}</strong> · {new Date(count.count_date + 'T00:00:00').toLocaleDateString()}
          {' · '}<strong>{pendingItems.length}</strong> pending · <strong>{approvedItems.length}</strong> approved
        </p>
        {count.notes && <p className="text-xs text-amber-600 mt-0.5">Notes: {count.notes}</p>}
        <p className="text-xs text-amber-500 mt-1">Gap = counted − current system weight. Refreshes every 30s. You can edit sacks/kg before approving.</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-8 px-4 py-2.5" />
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch · SKU</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sacks</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">kg / unit</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">+ 1kg bags</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">= kg</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">At count</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Shipped since</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Current</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Gap</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>}

              {pendingItems.length > 0 && (
                <>
                  <tr>
                    <td colSpan={10} className="px-4 pt-3 pb-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending</span>
                        <button onClick={() => setSelected(new Set(pendingItems.map(i => i.id)))} className="text-xs text-blue-600 hover:underline">Select all</button>
                        <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:underline">Clear</button>
                      </div>
                    </td>
                  </tr>
                  {renderSection(pendingItems, true)}
                </>
              )}

              {approvedItems.length > 0 && (
                <>
                  <tr>
                    <td colSpan={10} className="px-4 pt-5 pb-1">
                      <span className="text-xs font-semibold text-green-600 uppercase tracking-wide">Approved</span>
                    </td>
                  </tr>
                  {renderSection(approvedItems, false)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-3 max-w-md">
        <div className="space-y-1.5">
          <Label>Reviewed By *</Label>
          <Input value={reviewedBy} onChange={e => setReviewedBy(e.target.value)} placeholder="Name" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 flex-wrap">
          <Button onClick={handleApproveSelected} disabled={submitting || selected.size === 0}>
            {submitting ? 'Applying…' : `Approve ${selected.size > 0 ? `${selected.size} selected` : 'selected'}`}
          </Button>
          <Button variant="outline" onClick={handleCloseCount} disabled={closing}>
            {closing ? 'Closing…' : 'Close Count'}
          </Button>
        </div>
        <p className="text-xs text-gray-400">
          Edit sack counts inline before approving — changes are saved when you approve. Close Count ends the session without touching unapproved items.
        </p>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function PhysicalCountTab() {
  const [startingNew, setStartingNew] = useState(false)

  const { data: counts = [], isLoading } = useQuery<PhysicalCount[]>({
    queryKey: ['physical-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physical_counts')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PhysicalCount[]
    },
  })

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>

  const activeCount = counts.find(c => c.status === 'in_progress' || c.status === 'pending_approval')

  if (activeCount?.status === 'pending_approval') {
    return <ApprovalView count={activeCount} onDone={() => setStartingNew(false)} />
  }

  if (startingNew || activeCount?.status === 'in_progress') {
    return <CountForm existingCount={activeCount} onCancel={() => setStartingNew(false)} />
  }

  return <CountHistory counts={counts} onStart={() => setStartingNew(true)} />
}
