import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
  sku_type: string
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

interface RowOverride { included?: boolean; sacks?: string; sackWeightKg?: string }
type Overrides = Record<string, RowOverride>

function getRow(batch: CountBatch, overrides: Overrides) {
  const o = overrides[batch.id] ?? {}
  const isRetail = batch.sku_type === 'retail_1kg'
  return {
    included:     o.included     ?? true,
    sacks:        o.sacks        ?? (batch.sacks != null ? String(batch.sacks) : ''),
    sackWeightKg: isRetail ? '1' : (o.sackWeightKg ?? (batch.sack_weight_kg ?? '')),
  }
}

function computeKg(sacks: string, sackWeightKg: string): number {
  const s = parseFloat(sacks)
  const w = parseFloat(sackWeightKg)
  return s > 0 && w > 0 ? s * w : 0
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

  const setRow = (batchId: string, field: keyof RowOverride, value: string | boolean) =>
    setOverrides(prev => ({ ...prev, [batchId]: { ...(prev[batchId] ?? {}), [field]: value } }))

  const grouped = batches.reduce<Record<string, CountBatch[]>>((acc, b) => {
    const loc = b.locations?.name ?? 'Untagged'
    ;(acc[loc] ??= []).push(b)
    return acc
  }, {})

  const includedBatches = batches.filter(b => getRow(b, overrides).included)

  const netVariance = includedBatches.reduce((sum, b) => {
    const row = getRow(b, overrides)
    return sum + computeKg(row.sacks, row.sackWeightKg) - parseFloat(b.weight_kg)
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
      const isRetail = b.sku_type === 'retail_1kg'
      return {
        physical_count_id: countId,
        batch_id: b.id,
        system_kg: parseFloat(b.weight_kg).toFixed(2),
        counted_kg: computeKg(row.sacks, row.sackWeightKg).toFixed(2),
        counted_sacks: parseInt(row.sacks) || null,
        counted_sack_weight_kg: isRetail ? 1 : (parseFloat(row.sackWeightKg) || null),
      }
    })

    const { error: itemsErr } = await supabase.from('physical_count_items').insert(items)
    if (itemsErr) { setError(itemsErr.message); setSubmitting(false); return }

    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    setSubmitting(false)
  }

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
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">System</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Counted sacks</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">kg / sack</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">= Counted kg</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading batches…</td></tr>}
              {Object.entries(grouped).map(([locName, locBatches]) => (
                <Fragment key={locName}>
                  <tr>
                    <td colSpan={8} className="px-3 pt-4 pb-1.5">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">{locName}</span>
                      <div className="mt-1 h-px bg-gray-200" />
                    </td>
                  </tr>
                  {locBatches.map(batch => {
                    const row = getRow(batch, overrides)
                    const isRetail = batch.sku_type === 'retail_1kg'
                    const countedKg = computeKg(row.sacks, row.sackWeightKg)
                    const systemKg = parseFloat(batch.weight_kg)
                    const variance = countedKg > 0 ? countedKg - systemKg : 0
                    const hasVariance = countedKg > 0 && Math.abs(variance) >= 0.01
                    return (
                      <tr
                        key={batch.id}
                        className={`border-b border-gray-100 ${!row.included ? 'opacity-35' : hasVariance ? 'bg-amber-50/50' : ''}`}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={() => setRow(batch.id, 'included', !row.included)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-400">{batch.batch_number}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">
                          {batch.lots?.name ?? '—'}
                          {isRetail && <span className="ml-1.5 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">1 kg bags</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums text-xs">
                          {batch.sacks != null ? <>{batch.sacks} sk · </> : ''}{systemKg.toFixed(0)} kg
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number" min="0" step="1"
                            value={row.sacks}
                            onChange={e => setRow(batch.id, 'sacks', e.target.value)}
                            disabled={!row.included}
                            placeholder="—"
                            className="w-20 text-right rounded-md border border-gray-200 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {isRetail ? (
                            <span className="text-xs text-gray-400 tabular-nums">1.000</span>
                          ) : (
                            <input
                              type="number" min="0" step="0.001"
                              value={row.sackWeightKg}
                              onChange={e => setRow(batch.id, 'sackWeightKg', e.target.value)}
                              disabled={!row.included}
                              placeholder="—"
                              className="w-20 text-right rounded-md border border-gray-200 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-300"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-900 tabular-nums">
                          {row.included && countedKg > 0
                            ? `${countedKg.toFixed(2)} kg`
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {row.included && countedKg > 0
                            ? <GapBadge gap={variance} />
                            : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
            {includedBatches.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-3 py-3 text-sm font-semibold text-gray-700 text-right">
                    Net variance · {includedBatches.length} product{includedBatches.length !== 1 ? 's' : ''}
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
        {submitting ? 'Submitting…' : `Submit ${includedBatches.length} product${includedBatches.length !== 1 ? 's' : ''} for Approval`}
      </Button>
    </div>
  )
}

// ─── Approval View ────────────────────────────────────────────────────────────

function ApprovalView({ count, onDone }: { count: PhysicalCount; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [reviewedBy, setReviewedBy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')

  const { data: items = [], isLoading, refetch } = useQuery<PhysicalCountItem[]>({
    queryKey: ['physical-count-items', count.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physical_count_items')
        .select('id, batch_id, system_kg, counted_kg, counted_sacks, counted_sack_weight_kg, approved_at, approved_by, batches(batch_number, weight_kg, sacks, sack_weight_kg, lots(name), locations(name))')
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

  const handleApproveSelected = async () => {
    if (!reviewedBy.trim()) { setError('Reviewed by is required.'); return }
    if (selected.size === 0) { setError('Select at least one item.'); return }
    setError(''); setSubmitting(true)

    const toApprove = pendingItems.filter(i => selected.has(i.id))
    const now = new Date().toISOString()
    const txNote = `Physical count ${count.count_date} by ${count.performed_by}, approved by ${reviewedBy.trim()}`

    for (const item of toApprove) {
      const currentKg = parseFloat(item.batches?.weight_kg ?? item.system_kg)
      const countedKg = parseFloat(item.counted_kg)
      const delta     = countedKg - currentKg

      if (Math.abs(delta) >= 0.01) {
        await supabase.from('inventory_transactions').insert([{
          batch_id:          item.batch_id,
          type:              'adjustment',
          weight_change_kg:  delta.toFixed(2),
          physical_count_id: count.id,
          notes:             txNote,
        }])
      }

      // Always write the counted weight + any new sack data
      await supabase.from('batches').update({
        weight_kg: countedKg,
        ...(item.counted_sacks != null && { sacks: item.counted_sacks }),
        ...(item.counted_sack_weight_kg != null && { sack_weight_kg: parseFloat(item.counted_sack_weight_kg) }),
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

  const renderItems = (rows: PhysicalCountItem[], isPending: boolean) => {
    const grouped = rows.reduce<Record<string, PhysicalCountItem[]>>((acc, i) => {
      const loc = i.batches?.locations?.name ?? 'Untagged'
      ;(acc[loc] ??= []).push(i)
      return acc
    }, {})

    return Object.entries(grouped).map(([locName, locItems]) => (
      <Fragment key={`${locName}-${isPending}`}>
        <tr>
          <td colSpan={8} className="px-4 pt-4 pb-1.5">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">{locName}</span>
            <div className="mt-1 h-px bg-gray-200" />
          </td>
        </tr>
        {locItems.map(item => {
          const currentKg = parseFloat(item.batches?.weight_kg ?? item.system_kg)
          const countedKg = parseFloat(item.counted_kg)
          const liveGap   = countedKg - currentKg
          const isSelected = selected.has(item.id)
          return (
            <tr
              key={item.id}
              className={`border-b border-gray-100 ${isPending && isSelected ? 'bg-blue-50/40' : ''} ${!isPending ? 'opacity-55' : ''}`}
            >
              <td className="px-4 py-2.5 text-center">
                {isPending
                  ? <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} className="rounded border-gray-300" />
                  : <span className="text-green-500 text-xs">✓</span>}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{item.batches?.batch_number ?? '—'}</td>
              <td className="px-4 py-2.5 font-medium text-gray-900">{item.batches?.lots?.name ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs text-gray-700">
                {item.counted_sacks != null ? <>{item.counted_sacks} sk · </> : ''}{countedKg.toFixed(2)} kg
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs text-gray-400">{parseFloat(item.system_kg).toFixed(2)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium text-gray-700">{currentKg.toFixed(2)}</td>
              <td className="px-4 py-2.5 text-right"><GapBadge gap={liveGap} /></td>
              <td className="px-4 py-2.5 text-xs text-gray-400">
                {!isPending && item.approved_by ? `by ${item.approved_by}` : ''}
              </td>
            </tr>
          )
        })}
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
        <p className="text-xs text-amber-500 mt-1">Gap = counted − current system weight. Refreshes every 30s as dispatches are encoded.</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-8 px-4 py-2.5" />
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Counted</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">At count</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Current</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Gap</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>}

              {pendingItems.length > 0 && (
                <>
                  <tr>
                    <td colSpan={8} className="px-4 pt-3 pb-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending</span>
                        <button onClick={() => setSelected(new Set(pendingItems.map(i => i.id)))} className="text-xs text-blue-600 hover:underline">Select all</button>
                        <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:underline">Clear</button>
                      </div>
                    </td>
                  </tr>
                  {renderItems(pendingItems, true)}
                </>
              )}

              {approvedItems.length > 0 && (
                <>
                  <tr>
                    <td colSpan={8} className="px-4 pt-5 pb-1">
                      <span className="text-xs font-semibold text-green-600 uppercase tracking-wide">Approved</span>
                    </td>
                  </tr>
                  {renderItems(approvedItems, false)}
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
          Approve applies adjustments for selected items. Close Count ends the session — unapproved items are left as-is with no inventory change.
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
