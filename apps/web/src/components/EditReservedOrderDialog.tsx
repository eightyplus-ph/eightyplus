import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile } from '@/lib/profile'

/**
 * Edit the line items on a RESERVED order.
 *
 * Deliberately narrow: weights, prices, adding and removing lines, and notes.
 * OS number, client, contract and order date are locked — those change what the
 * order *is*, and re-pointing a contract silently redraws two schedules. Status
 * stays owned by the Confirm button.
 *
 * Only reserved orders reach this dialog. Once confirmed there is payment
 * attached, and once dispatched the stock has physically moved.
 */

export interface EditableOrder {
  id: string
  os_number: string
  status: string
  contract_id?: string | null
  notes: string | null
  clients: { company_name: string } | null
  order_items: {
    id: string
    lot_id: string
    batch_id: string | null
    location_id: string | null
    weight_ordered_kg: string
    price_per_kg: string
    lots: { name: string } | null
  }[]
}

interface Row {
  key: string
  id: string | null      // null = newly added, not yet in the database
  lotId: string
  batchId: string | null
  locationId: string | null
  kg: string
  price: string
  removed: boolean
}

interface BatchOption {
  batchId: string
  batchNumber: string
  lotId: string
  locationId: string | null
  availableKg: number
}

const uid = () => Math.random().toString(36).slice(2)
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const peso = (v: number) => '₱' + Math.round(v).toLocaleString('en-US')

export default function EditReservedOrderDialog({
  order, onClose,
}: { order: EditableOrder; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()

  const [rows, setRows] = useState<Row[]>(() =>
    order.order_items.map(i => ({
      key: i.id, id: i.id, lotId: i.lot_id, batchId: i.batch_id, locationId: i.location_id,
      kg: String(parseFloat(i.weight_ordered_kg ?? '0')),
      price: String(parseFloat(i.price_per_kg ?? '0')),
      removed: false,
    })))
  const [notes, setNotes] = useState(order.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: lots = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['lots-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lots').select('id, name').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Same filter the create form uses: contract-tagged batches are withheld from
  // ordering, and an empty batch cannot be drawn from.
  const { data: batches = [] } = useQuery<BatchOption[]>({
    queryKey: ['batches-by-lot-edit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, lot_id, location_id, weight_kg')
        .is('contract_item_id', null)
        .gt('weight_kg', 0)
      if (error) throw error
      return (data ?? []).map(b => ({
        batchId: b.id as string,
        batchNumber: b.batch_number as string,
        lotId: b.lot_id as string,
        locationId: (b.location_id as string) ?? null,
        availableKg: parseFloat(String(b.weight_kg ?? '0')),
      }))
    },
  })

  const lotName = useMemo(() => new Map(lots.map(l => [l.id, l.name])), [lots])
  const batchesFor = (lotId: string) => batches.filter(b => b.lotId === lotId)

  const live = rows.filter(r => !r.removed)
  const totalKg = live.reduce((s, r) => s + num(r.kg), 0)
  const totalValue = live.reduce((s, r) => s + num(r.kg) * num(r.price), 0)

  const originalKg = order.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg ?? '0'), 0)
  const deltaKg = totalKg - originalKg

  const patch = (key: string, next: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...next } : r)))

  const addRow = () =>
    setRows(rs => [...rs, { key: uid(), id: null, lotId: '', batchId: null, locationId: null, kg: '', price: '', removed: false }])

  const removeRow = (key: string) =>
    setRows(rs => rs.flatMap(r => (r.key !== key ? [r] : r.id ? [{ ...r, removed: true }] : [])))

  const problems = live.flatMap(r => {
    const p: string[] = []
    if (!r.lotId) p.push('a line has no product selected')
    if (num(r.kg) <= 0) p.push(`${lotName.get(r.lotId) ?? 'a line'} has no weight`)
    const b = batches.find(x => x.batchId === r.batchId)
    // Only warn on NEW draws; an existing line's batch was already debited
    // against at reservation time and re-checking it would flag every edit.
    if (b && !r.id && num(r.kg) > b.availableKg)
      p.push(`${lotName.get(r.lotId)} asks ${num(r.kg)} kg but batch ${b.batchNumber} holds ${b.availableKg} kg`)
    return p
  })

  const save = async () => {
    setSaving(true); setError(null)

    const toDelete = rows.filter(r => r.removed && r.id).map(r => r.id as string)
    const toUpdate = rows.filter(r => !r.removed && r.id)
    const toInsert = rows.filter(r => !r.removed && !r.id)

    try {
      if (toDelete.length) {
        const { error } = await supabase.from('order_items').delete().in('id', toDelete)
        if (error) throw error
      }

      for (const r of toUpdate) {
        const { error } = await supabase.from('order_items')
          .update({ weight_ordered_kg: num(r.kg), price_per_kg: num(r.price) })
          .eq('id', r.id as string)
        if (error) throw error
      }

      if (toInsert.length) {
        const { error } = await supabase.from('order_items').insert(
          toInsert.map(r => ({
            order_id: order.id,
            lot_id: r.lotId,
            batch_id: r.batchId,
            location_id: r.locationId ?? batches.find(b => b.batchId === r.batchId)?.locationId ?? null,
            weight_ordered_kg: num(r.kg),
            price_per_kg: num(r.price),
          })))
        if (error) throw error
      }

      // Audit stamp. Migration 006 adds updated_at/updated_by; if it has not been
      // run yet, Postgres answers 42703 and we still save the notes rather than
      // failing an edit the user already committed to.
      const stamp = { notes: notes.trim() || null, updated_at: new Date().toISOString(), updated_by: profile?.id ?? null }
      const { error: stampErr } = await supabase.from('orders').update(stamp).eq('id', order.id)
      let warned = false
      if (stampErr) {
        if (stampErr.code === '42703') {
          const { error: fallbackErr } = await supabase.from('orders')
            .update({ notes: notes.trim() || null }).eq('id', order.id)
          if (fallbackErr) throw fallbackErr
          setError('Saved, but this edit was not recorded against your name — migration 006 has not been run yet.')
          warned = true
        } else throw stampErr
      }

      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['batches-by-lot'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // `error` state is stale inside this closure, so the local flag decides —
      // otherwise the migration warning would flash and the dialog close anyway.
      if (!warned) onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the changes.')
    } finally {
      setSaving(false)
    }
  }

  if (order.status !== 'reserved') return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Edit {order.os_number}</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {order.clients?.company_name} — reserved. Products and prices only; client, contract and date are fixed.
              </p>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">✕</button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Product</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Batch</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-28">kg</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-28">₱/kg</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Value</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {live.map(r => (
                  <tr key={r.key} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      {r.id ? (
                        <span className="text-gray-900">{lotName.get(r.lotId) ?? '—'}</span>
                      ) : (
                        <select
                          value={r.lotId}
                          onChange={e => patch(r.key, { lotId: e.target.value, batchId: null, locationId: null })}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                        >
                          <option value="">Choose a product…</option>
                          {lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {r.id ? (
                        batches.find(b => b.batchId === r.batchId)?.batchNumber ?? '—'
                      ) : (
                        <select
                          value={r.batchId ?? ''}
                          onChange={e => {
                            const b = batches.find(x => x.batchId === e.target.value)
                            patch(r.key, { batchId: e.target.value || null, locationId: b?.locationId ?? null })
                          }}
                          disabled={!r.lotId}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full disabled:bg-gray-50"
                        >
                          <option value="">Choose a batch…</option>
                          {batchesFor(r.lotId).map(b => (
                            <option key={b.batchId} value={b.batchId}>
                              {b.batchNumber} — {b.availableKg.toLocaleString()} kg
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={r.kg}
                        onChange={e => patch(r.key, { kg: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={r.price}
                        onChange={e => patch(r.key, { price: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full text-right" />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                      {peso(num(r.kg) * num(r.price))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeRow(r.key)}
                        className="text-xs text-red-500 hover:text-red-700">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-300">
                  <td colSpan={2} className="px-3 py-2 font-medium text-gray-700">Total</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">
                    {totalKg.toLocaleString()} kg
                    {deltaKg !== 0 && (
                      <span className={`block text-xs font-normal ${deltaKg > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                        {deltaKg > 0 ? '+' : ''}{deltaKg.toLocaleString()} kg
                      </span>
                    )}
                  </td>
                  <td></td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{peso(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button onClick={addRow} className="mt-3 text-xs text-blue-600 hover:underline">+ Add a product</button>

          <div className="mt-5">
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="edit-notes">Notes</label>
            <textarea id="edit-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full" />
          </div>

          {problems.length > 0 && (
            <ul className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}

          {error && (
            <p className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
            <button
              onClick={save}
              disabled={saving || live.length === 0 || problems.some(p => p.includes('no weight') || p.includes('no product'))}
              className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
