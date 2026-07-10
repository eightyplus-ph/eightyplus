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

function computeKg(sacks: string, sackWeightKg: string): number {
  const s = parseFloat(sacks)
  const w = parseFloat(sackWeightKg)
  return s > 0 && w > 0 ? s * w : 0
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

// ─── Batch row override state ─────────────────────────────────────────────────

interface RowOverride { included?: boolean; sacks?: string; sackWeightKg?: string; extraBags?: string }
type Overrides = Record<string, RowOverride>

function getRow(batch: CountBatch, overrides: Overrides) {
  const o = overrides[batch.id] ?? {}
  const fixed = isFixedWeightSku(batch.sku_type)
  return {
    included:     o.included     ?? true,
    sacks:        o.sacks        ?? (batch.sacks != null ? String(batch.sacks) : ''),
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

// ─── History ──────────────────────────────────────────────────────────────────

function CountHistory({ counts, onStart }: { counts: PhysicalCount[]; onStart: () => void }) {
  const completed = counts.filter(c => c.status === 'approved' || c.status === 'rejected')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">No active count session.</p>
        <Button onClick={onStart}>Start Physical Count</Button>
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

  const { data: batches = [], isLoading } = useQuery<CountBatch[]>({
    queryKey: ['batches-for-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lots(name), locations(name)')
        .gt('weight_kg', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as CountBatch[]
    },
  })

  const setOverride = (batchId: string, field: keyof RowOverride, value: string | boolean) =>
    setOverrides(prev => ({ ...prev, [batchId]: { ...(prev[batchId] ?? {}), [field]: value } }))

  const grouped = groupByLocProduct(
    batches,
    b => b.locations?.name ?? 'Untagged',
    b => b.lots?.name ?? 'Unknown product',
  )

  const includedBatches = batches.filter(b => getRow(b, overrides).included)

  const netVariance = includedBatches.reduce((sum, b) => {
    const row = getRow(b, overrides)
    return sum + computeTotalKg(row.sacks, row.sackWeightKg, row.extraBags) - parseFloat(b.weight_kg)
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
        counted_kg: computeTotalKg(row.sacks, row.sackWeightKg, row.extraBags).toFixed(2),
        counted_sacks: parseInt(row.sacks) || null,
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
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 mt-1">Cancel</button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-8 px-3 py-2.5" />
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch · SKU</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">System</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sacks</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">kg / unit</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">+ 1kg bags</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">= Counted kg</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading batches…</td></tr>
              )}
              {grouped.map(([locName, products]) => (
                <Fragment key={locName}>
                  {/* Location header */}
                  <tr>
                    <td colSpan={7} className="px-3 pt-5 pb-1.5">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">{locName}</span>
                      <div className="mt-1 h-px bg-gray-300" />
                    </td>
                  </tr>
                  {products.map(([productName, batches]) => (
                    <Fragment key={productName}>
                      {/* Product name row */}
                      <tr>
                        <td colSpan={7} className="px-3 pt-3 pb-1 pl-5">
                          <span className="text-sm font-semibold text-gray-800">{productName}</span>
                          {batches.length > 1 && (
                            <span className="ml-2 text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full">
                              {batches.length} batches
                            </span>
                          )}
                        </td>
                      </tr>
                      {/* Batch rows under this product */}
                      {batches.map(batch => {
                        const row = getRow(batch, overrides)
                        const fixed = isFixedWeightSku(batch.sku_type)
                        const unit = skuUnit(batch.sku_type)
                        const totalKg = computeTotalKg(row.sacks, row.sackWeightKg, row.extraBags)
                        const systemKg = parseFloat(batch.weight_kg)
                        const variance = totalKg > 0 ? totalKg - systemKg : 0
                        const hasVariance = totalKg > 0 && Math.abs(variance) >= 0.01
                        return (
                          <tr
                            key={batch.id}
                            className={`border-b border-gray-100 ${!row.included ? 'opacity-35' : hasVariance ? 'bg-amber-50/50' : ''}`}
                          >
                            <td className="px-3 py-2 text-center pl-5">
                              <input
                                type="checkbox"
                                checked={row.included}
                                onChange={() => setOverride(batch.id, 'included', !row.included)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="px-3 py-2 pl-6">
                              <span className="font-mono text-xs text-gray-400">{batch.batch_number}</span>
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${fixed ? 'text-purple-600 bg-purple-50' : 'text-gray-500 bg-gray-100'}`}>
                                {skuLabel(batch.sku_type)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500 tabular-nums text-xs">
                              {batch.sacks != null ? <>{batch.sacks} {unit} · </> : ''}{systemKg.toFixed(0)} kg
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number" min="0" step="1"
                                value={row.sacks}
                                onChange={e => setOverride(batch.id, 'sacks', e.target.value)}
                                disabled={!row.included}
                                placeholder="—"
                                className={inputCls}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {fixed ? (
                                <span className="text-xs text-gray-400 tabular-nums">1.000</span>
                              ) : (
                                <input
                                  type="number" min="0" step="0.001"
                                  value={row.sackWeightKg}
                                  onChange={e => setOverride(batch.id, 'sackWeightKg', e.target.value)}
                                  disabled={!row.included}
                                  placeholder="—"
                                  className={inputCls}
                                />
                              )}
                            </td>
                            {/* Extra 1kg bags — only for commercial batches */}
                            <td className="px-3 py-2 text-right">
                              {fixed ? (
                                <span className="text-gray-200 text-xs">—</span>
                              ) : (
                                <input
                                  type="number" min="0" step="1"
                                  value={row.extraBags}
                                  onChange={e => setOverride(batch.id, 'extraBags', e.target.value)}
                                  disabled={!row.included}
                                  placeholder="0"
                                  className={inputCls}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">
                              {row.included && totalKg > 0
                                ? `${totalKg.toFixed(2)} kg`
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.included && totalKg > 0
                                ? <GapBadge gap={variance} />
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {includedBatches.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-3 py-3 text-sm font-semibold text-gray-700 text-right">
                    Net variance · {includedBatches.length} batch{includedBatches.length !== 1 ? 'es' : ''}
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
  const edit = getItemEdit(item, edits)
  const total = computeTotalKg(edit.sacks, edit.sackWeightKg, edit.extraBags)
  if (total > 0) return total
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
        .select('id, batch_id, system_kg, counted_kg, counted_sacks, counted_sack_weight_kg, approved_at, approved_by, batches(batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lots(name), locations(name))')
        .eq('physical_count_id', count.id)
      if (error) throw error
      return data as unknown as PhysicalCountItem[]
    },
    refetchInterval: 30_000,
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
      const editedKg = computeTotalKg(edit.sacks, edit.sackWeightKg, edit.extraBags)
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

      const currentKg = parseFloat(item.batches?.weight_kg ?? item.system_kg)
      const delta = finalCountedKg - currentKg

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
        weight_kg: finalCountedKg,
        ...(finalSacks != null    && { sacks: finalSacks }),
        ...(finalSackWeight != null && { sack_weight_kg: finalSackWeight }),
      }).eq('id', item.batch_id)

      await supabase.from('physical_count_items').update({
        approved_at: now,
        approved_by: reviewedBy.trim(),
      }).eq('id', item.id)
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
          <td colSpan={10} className="px-4 pt-4 pb-1.5">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">{locName}</span>
            <div className="mt-1 h-px bg-gray-300" />
          </td>
        </tr>
        {products.map(([productName, prodItems]) => (
          <Fragment key={productName}>
            <tr>
              <td colSpan={10} className="px-4 pt-3 pb-1 pl-6">
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
              const liveGap = countedKg - currentKg
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
