import { useState } from 'react'
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
  lots: { name: string } | null
  locations: { name: string } | null
}

interface PhysicalCountItem {
  id: string
  batch_id: string
  system_kg: string
  counted_kg: string
  batches: {
    batch_number: string
    lots: { name: string } | null
    locations: { name: string } | null
  } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function VarianceBadge({ variance }: { variance: number }) {
  if (Math.abs(variance) < 0.01) return <span className="text-gray-400">—</span>
  const cls = variance < 0
    ? 'text-red-600 font-semibold'
    : 'text-green-600 font-semibold'
  return <span className={cls}>{variance > 0 ? '+' : ''}{variance.toFixed(2)} kg</span>
}

// ─── History view ─────────────────────────────────────────────────────────────

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
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total Variance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Explanation</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Result</th>
                </tr>
              </thead>
              <tbody>
                {completed.map(c => {
                  const variance = parseFloat(c.total_variance_kg ?? '0')
                  return (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(c.count_date + 'T00:00:00').toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.performed_by}</td>
                      <td className="px-4 py-3 text-gray-600">{c.reviewed_by ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <VarianceBadge variance={variance} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                        {c.variance_notes ?? (c.rejection_notes ? `Rejected: ${c.rejection_notes}` : '—')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {c.status === 'approved' ? 'Approved' : 'Rejected'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Count form ───────────────────────────────────────────────────────────────

function CountForm({ existingCount, onCancel }: { existingCount?: PhysicalCount; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [countDate, setCountDate] = useState(existingCount?.count_date ?? todayStr())
  const [performedBy, setPerformedBy] = useState(existingCount?.performed_by ?? '')
  const [notes, setNotes] = useState(existingCount?.notes ?? '')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: batches = [], isLoading } = useQuery<CountBatch[]>({
    queryKey: ['batches-for-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, lots(name), locations(name)')
        .gt('weight_kg', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as CountBatch[]
    },
  })

  const getQty = (batch: CountBatch) =>
    quantities[batch.id] !== undefined ? quantities[batch.id] : parseFloat(batch.weight_kg).toFixed(2)

  const netVariance = batches.reduce((sum, b) => {
    const counted = parseFloat(getQty(b) || '0')
    const system = parseFloat(b.weight_kg)
    return sum + (counted - system)
  }, 0)

  const handleSubmit = async () => {
    if (!performedBy.trim()) { setError('Performed by is required.'); return }
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
    const items = batches.map(b => ({
      physical_count_id: countId,
      batch_id: b.id,
      system_kg: parseFloat(b.weight_kg).toFixed(2),
      counted_kg: parseFloat(getQty(b) || b.weight_kg).toFixed(2),
    }))

    const { error: itemsErr } = await supabase.from('physical_count_items').insert(items)
    if (itemsErr) { setError(itemsErr.message); setSubmitting(false); return }

    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    setSubmitting(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="grid grid-cols-2 gap-4 max-w-md">
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
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Batch #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Product</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Location</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">System kg</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Counted kg</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading batches…</td></tr>}
              {batches.map(batch => {
                const counted = parseFloat(getQty(batch) || '0')
                const system = parseFloat(batch.weight_kg)
                const variance = counted - system
                return (
                  <tr key={batch.id} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{batch.batch_number}</td>
                    <td className="px-4 py-2 text-gray-900">{batch.lots?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{batch.locations?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{system.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={getQty(batch)}
                        onChange={e => setQuantities(prev => ({ ...prev, [batch.id]: e.target.value }))}
                        className="w-24 text-right rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <VarianceBadge variance={variance} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {batches.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td colSpan={5} className="px-4 py-2 text-sm font-medium text-gray-500 text-right">Net variance</td>
                  <td className="px-4 py-2 text-right">
                    <VarianceBadge variance={netVariance} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={submitting || isLoading}>
          {submitting ? 'Submitting…' : 'Submit for Approval'}
        </Button>
      </div>
    </div>
  )
}

// ─── Approval view ────────────────────────────────────────────────────────────

function ApprovalView({ count, onDone }: { count: PhysicalCount; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [reviewedBy, setReviewedBy] = useState('')
  const [varianceNotes, setVarianceNotes] = useState('')
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: items = [], isLoading } = useQuery<PhysicalCountItem[]>({
    queryKey: ['physical-count-items', count.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physical_count_items')
        .select('id, batch_id, system_kg, counted_kg, batches(batch_number, lots(name), locations(name))')
        .eq('physical_count_id', count.id)
      if (error) throw error
      return data as unknown as PhysicalCountItem[]
    },
  })

  const variantItems = items.filter(i => Math.abs(parseFloat(i.counted_kg) - parseFloat(i.system_kg)) >= 0.01)

  const handleApprove = async () => {
    if (!reviewedBy.trim()) { setError('Reviewed by is required.'); return }
    if (variantItems.length > 0 && !varianceNotes.trim()) { setError('Variance explanation is required when adjustments exist.'); return }
    setError(''); setSubmitting(true)

    const txNotes = `Physical count by ${count.performed_by}, approved by ${reviewedBy.trim()}. ${varianceNotes.trim()}`

    // Close the count first — if this fails we stop before touching inventory
    const { error: closeErr } = await supabase.from('physical_counts').update({
      status: 'approved',
      reviewed_by: reviewedBy.trim(),
      reviewed_at: new Date().toISOString(),
      variance_notes: varianceNotes.trim() || null,
    }).eq('id', count.id)
    if (closeErr) { setError(closeErr.message); setSubmitting(false); return }

    for (const item of variantItems) {
      const delta = parseFloat(item.counted_kg) - parseFloat(item.system_kg)
      await supabase.from('inventory_transactions').insert([{
        batch_id: item.batch_id,
        type: 'adjustment',
        weight_change_kg: delta.toFixed(2),
        physical_count_id: count.id,
        notes: txNotes,
      }])
      await supabase.from('batches').update({ weight_kg: parseFloat(item.counted_kg) }).eq('id', item.batch_id)
    }

    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    setSubmitting(false)
    onDone()
  }

  const handleReject = async () => {
    if (!reviewedBy.trim()) { setError('Reviewed by is required.'); return }
    setError(''); setSubmitting(true)

    await supabase.from('physical_counts').update({
      status: 'rejected',
      reviewed_by: reviewedBy.trim(),
      reviewed_at: new Date().toISOString(),
      rejection_notes: rejectionNotes.trim() || null,
    }).eq('id', count.id)

    await queryClient.invalidateQueries({ queryKey: ['physical-counts'] })
    setSubmitting(false)
    onDone()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Pending Approval</p>
        <p className="text-xs text-amber-600 mt-0.5">
          Count submitted by <strong>{count.performed_by}</strong> for{' '}
          {new Date(count.count_date + 'T00:00:00').toLocaleDateString()} ·{' '}
          Total variance: <strong>{parseFloat(count.total_variance_kg ?? '0').toFixed(2)} kg</strong>
        </p>
        {count.notes && <p className="text-xs text-amber-600 mt-0.5">Notes: {count.notes}</p>}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Batch #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Product</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Location</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">System kg</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Counted kg</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>}
              {items.map(item => {
                const system = parseFloat(item.system_kg)
                const counted = parseFloat(item.counted_kg)
                const variance = counted - system
                const hasVariance = Math.abs(variance) >= 0.01
                return (
                  <tr key={item.id} className={`border-b border-gray-100 ${hasVariance ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">
                      {item.batches?.batch_number ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-900">{item.batches?.lots?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{item.batches?.locations?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{system.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-gray-900 font-medium">{counted.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">
                      <VarianceBadge variance={variance} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-3 max-w-md">
        {variantItems.length > 0 && (
          <div className="space-y-1.5">
            <Label>Variance Explanation *</Label>
            <textarea
              value={varianceNotes}
              onChange={e => setVarianceNotes(e.target.value)}
              rows={2}
              placeholder="What caused the discrepancy? e.g. moisture loss, spillage during rebagging, counting error…"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Reviewed By *</Label>
          <Input value={reviewedBy} onChange={e => setReviewedBy(e.target.value)} placeholder="Name" />
        </div>

        {showReject && (
          <div className="space-y-1.5">
            <Label>Reason for Rejection</Label>
            <Input value={rejectionNotes} onChange={e => setRejectionNotes(e.target.value)} placeholder="What needs to be recounted?" />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button onClick={handleApprove} disabled={submitting}>
            {submitting ? 'Applying…' : `Approve & Apply${variantItems.length > 0 ? ` (${variantItems.length} adjustment${variantItems.length !== 1 ? 's' : ''})` : ''}`}
          </Button>
          {!showReject ? (
            <Button variant="outline" onClick={() => setShowReject(true)} disabled={submitting}>Reject</Button>
          ) : (
            <Button variant="outline" onClick={handleReject} disabled={submitting} className="text-red-600 border-red-300 hover:bg-red-50">
              {submitting ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          )}
        </div>
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
