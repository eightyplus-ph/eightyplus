import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispatchItemRecord { weight_dispatched_kg: string }
interface OrderItem {
  id: string
  lot_id: string
  batch_id: string | null
  location_id: string | null
  weight_ordered_kg: string
  lots: { name: string } | null
  locations: { name: string } | null
  dispatch_items: DispatchItemRecord[]
}
interface PendingDispatchRecord { dr_number: string; dispatched_date: string }
interface PendingOrder {
  id: string
  os_number: string
  order_date: string
  status: string
  scheduled_dispatch_date: string | null
  clients: { company_name: string; pay_after_dispatch: boolean } | null
  order_items: OrderItem[]
  dispatches: PendingDispatchRecord[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dispatchedKg(item: OrderItem) {
  return item.dispatch_items.reduce((s, d) => s + parseFloat(d.weight_dispatched_kg ?? '0'), 0)
}
function remainingKg(item: OrderItem) {
  return Math.max(0, parseFloat(item.weight_ordered_kg) - dispatchedKg(item))
}
function orderRemainingKg(order: PendingOrder) {
  return order.order_items.reduce((s, i) => s + remainingKg(i), 0)
}
function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ─── Dispatch form ────────────────────────────────────────────────────────────

/**
 * Move `kg` of a lot from one warehouse to another and record it.
 *
 * Called when a dispatch was picked somewhere other than where the order sourced
 * it. Mirrors the Transfers page exactly — a whole batch changes address, a part
 * batch splits into a `-Tnn` child — so a transfer generated here is
 * indistinguishable from one a human entered, and the ledger balances either way.
 */
async function transferBetween(
  lotId: string, fromId: string, toId: string, kg: number,
  dispatchId: string, note: string,
): Promise<boolean> {
  const { data: pool } = await supabase
    .from('batches').select('id, batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lot_id')
    .eq('lot_id', lotId).eq('location_id', fromId).gt('weight_kg', 0)
    .order('received_at', { ascending: true })

  let remaining = kg
  for (const b of pool ?? []) {
    if (remaining <= 0.0001) break
    const onHand = parseFloat(b.weight_kg)
    const move = Math.min(remaining, onHand)
    const pk = b.sack_weight_kg ? parseFloat(b.sack_weight_kg) : 1
    const moveSacks = Math.round(move / (pk || 1))

    if (move >= onHand - 0.005) {
      const { error } = await supabase.from('batches').update({ location_id: toId }).eq('id', b.id)
      if (error) return false
      // A whole batch changing address moves no quantity, so it needs no ledger
      // row — but it does need to be attributable, which the dispatch_id gives it.
      await supabase.from('inventory_transactions').insert([
        { batch_id: b.id, type: 'transfer_out', weight_change_kg: -move, dispatch_id: dispatchId, notes: note },
        { batch_id: b.id, type: 'transfer_in', weight_change_kg: move, dispatch_id: dispatchId, notes: note },
      ])
    } else {
      const { count } = await supabase.from('batches')
        .select('id', { count: 'exact', head: true }).eq('source_batch_id', b.id)
      const childNumber = `${b.batch_number}-T${String((count ?? 0) + 1).padStart(2, '0')}`
      const { data: child, error: cErr } = await supabase.from('batches').insert([{
        batch_number: childNumber,
        lot_id: b.lot_id,
        weight_kg: move.toFixed(2),
        sacks: moveSacks,
        sku_type: b.sku_type ?? 'commercial',
        sack_weight_kg: b.sack_weight_kg ? parseFloat(b.sack_weight_kg) : null,
        location_id: toId,
        source_batch_id: b.id,
        notes: note,
      }]).select()
      if (cErr || !child?.length) return false

      const { error: uErr } = await supabase.from('batches').update({
        weight_kg: (onHand - move).toFixed(2),
        sacks: Math.round((onHand - move) / (pk || 1)),
      }).eq('id', b.id)
      if (uErr) return false

      await supabase.from('inventory_transactions').insert([
        { batch_id: b.id, type: 'transfer_out', weight_change_kg: -move, dispatch_id: dispatchId,
          notes: `${note} → ${childNumber}` },
        { batch_id: child[0].id, type: 'transfer_in', weight_change_kg: move, dispatch_id: dispatchId,
          notes: `${note} ← ${b.batch_number}` },
      ])
    }
    remaining -= move
  }
  return remaining <= 0.0001
}


function DispatchForm({ order, onDone }: { order: PendingOrder; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [drNumber, setDrNumber] = useState('')
  const [dispatchDate, setDispatchDate] = useState(todayStr())   // always default to today
  const [receiverName, setReceiverName] = useState('')
  const [notes, setNotes] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  // Where the sacks were PHYSICALLY picked. The order line names where the order
  // is SOURCED from, which is a different fact: when Bagtikan is short an order is
  // tagged Paco and the coffee is transferred over. Nothing recorded the second
  // fact, so dispatch debited the sourcing warehouse whatever actually happened.
  const [pickedAll, setPickedAll] = useState<string>('')          // header, sets every line
  const [pickedBy, setPickedBy] = useState<Record<string, string>>({})  // per-line override
  const [showPerLine, setShowPerLine] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: locations = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('id, name').order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })

  const itemsToDispatch = order.order_items.filter(i => remainingKg(i) > 0)

  useEffect(() => {
    const initial: Record<string, string> = {}
    const picked: Record<string, string> = {}
    for (const item of itemsToDispatch) {
      initial[item.id] = String(Math.round(remainingKg(item)))
      picked[item.id] = item.location_id ?? ''
    }
    setQuantities(initial)
    setPickedBy(picked)
    // One warehouse in the header when every line agrees, which is the normal case.
    const distinct = [...new Set(Object.values(picked).filter(Boolean))]
    setPickedAll(distinct.length === 1 ? distinct[0] : '')
    setShowPerLine(distinct.length > 1)
  }, [order.id])

  const pickedFor = (item: { id: string; location_id: string | null }) =>
    pickedBy[item.id] || item.location_id || ''
  const setPickedForAll = (locId: string) => {
    setPickedAll(locId)
    setPickedBy(prev => Object.fromEntries(Object.keys(prev).map(k => [k, locId])))
  }
  const locName = (id: string) => locations.find(l => l.id === id)?.name ?? 'that warehouse'

  const handleSubmit = async () => {
    setError('')
    if (!drNumber.trim()) { setError('DR# is required.'); return }

    const lines = itemsToDispatch
      .map(item => ({ item, qty: parseFloat(quantities[item.id] || '0') }))
      .filter(l => l.qty > 0)

    if (lines.length === 0) { setError('Enter at least one quantity.'); return }
    for (const { item, qty } of lines) {
      if (qty > remainingKg(item)) {
        setError(`${item.lots?.name ?? 'Item'}: cannot exceed remaining (${Math.round(remainingKg(item))} kg).`)
        return
      }
    }

    for (const { item } of lines) {
      if (!pickedFor(item)) {
        setError(`${item.lots?.name ?? 'Item'}: say which warehouse it was picked from.`)
        return
      }
    }

    // Pre-flight against the warehouse it was PICKED from. A line sourced from Paco
    // and picked at Bagtikan has to be checked against Bagtikan, because that is
    // where the stock is about to be taken from.
    for (const { item, qty } of lines) {
      const pickedId = pickedFor(item)
      const { data: availBatches } = await supabase.from('batches')
        .select('weight_kg').eq('lot_id', item.lot_id).gt('weight_kg', 0).eq('location_id', pickedId)
      const availKg = (availBatches ?? []).reduce((s, b) => s + parseFloat(b.weight_kg), 0)
      if (qty > availKg + 0.01) {
        setError(`${item.lots?.name ?? 'Item'}: only ${Math.round(availKg)} kg at ${locName(pickedId)}, need ${Math.round(qty)} kg. Transfer it there first, or change where it was picked from.`)
        return
      }
    }

    setSubmitting(true)

    // Create dispatch record with the actual dispatch date
    const { data: dispatchData, error: dErr } = await supabase.from('dispatches').insert([{
      order_id: order.id,
      dr_number: drNumber.trim(),
      dispatched_date: dispatchDate,
      receiver_name: receiverName.trim() || null,
      notes: notes.trim() || null,
    }]).select()
    if (dErr) { setError(dErr.message); setSubmitting(false); return }

    const dispatchId = dispatchData[0].id

    for (const { item, qty } of lines) {
      const pickedId = pickedFor(item)
      const sourcedId = item.location_id ?? pickedId
      // The packaging the order was written against, taken from its chosen batch.
      const { data: obRows } = item.batch_id
        ? await supabase.from('batches').select('sku_type').eq('id', item.batch_id).limit(1)
        : { data: null }
      const orderSku = obRows?.[0]?.sku_type ?? null

      const { error: diErr } = await supabase.from('dispatch_items').insert([{
        dispatch_id: dispatchId,
        order_item_id: item.id,
        weight_dispatched_kg: qty,
        picked_location_id: pickedId,
      }])
      if (diErr) { setError(diErr.message); setSubmitting(false); return }

      // Sourced somewhere, picked somewhere else: the coffee moved, so write the
      // move. Recording the transfer has been a separate chore and it was skipped
      // 11 times out of 13 — here it is a consequence of an answer the loader
      // already gave, and it carries the DR that caused it.
      if (pickedId !== sourcedId) {
        const ok = await transferBetween(item.lot_id, sourcedId, pickedId, qty, dispatchId,
          `Transfer for DR ${drNumber.trim()} · ${order.os_number} — sourced ${locName(sourcedId)}, picked ${locName(pickedId)}`)
        if (!ok) { setError(`Could not move ${Math.round(qty)} kg from ${locName(sourcedId)} to ${locName(pickedId)}.`); setSubmitting(false); return }
      }

      // Then debit the warehouse it was actually picked from.
      let remaining = qty
      const { data: locBatches } = await supabase
        .from('batches').select('id, weight_kg, sack_weight_kg, sku_type')
        .eq('lot_id', item.lot_id).gt('weight_kg', 0).eq('location_id', pickedId)
        .order('received_at', { ascending: true })

      // Draw from stock of the same packaging first, and only break a sack when
      // there is no loose stock left. Plain FIFO ignores packaging: DR 1887 took
      // 6 kg of Amore's 10 from a retail batch, then opened a 30 kg sack for the
      // remaining 4 while 14 kg of 1 kg bags sat beside it, because the sack was
      // received earlier. That turns a whole sack into a part sack for nothing and
      // puts a remainder on the count sheet that nobody can explain.
      const sameSku = (b: { sku_type?: string | null }) =>
        (b.sku_type ?? 'commercial') === (orderSku ?? 'commercial')
      const batches = (locBatches ?? []).sort((a, b) =>
        Number(b.id === item.batch_id) - Number(a.id === item.batch_id) ||
        Number(sameSku(b)) - Number(sameSku(a))
      )

      for (const batch of batches) {
        if (remaining <= 0) break
        const batchKg = parseFloat(batch.weight_kg)
        const deduct = Math.min(remaining, batchKg)
        // Move sacks with the weight. Leaving it stale is what let a batch that had
        // shipped still look like it was holding sacks, and a later count refilled it.
        const pk = batch.sack_weight_kg ? parseFloat(batch.sack_weight_kg) : 1
        await supabase.from('batches').update({
          weight_kg: batchKg - deduct,
          sacks: Math.round((batchKg - deduct) / (pk || 1)),
        }).eq('id', batch.id)
        await supabase.from('inventory_transactions').insert([{
          batch_id: batch.id,
          type: 'dispatch',
          weight_change_kg: (-deduct).toFixed(2),
          dispatch_id: dispatchId,
          notes: `DR ${drNumber.trim()} · ${order.os_number}`,
        }])
        remaining -= deduct
      }
    }

    // Compute fully-dispatched from in-memory data (avoids timing issues with nested join)
    const fullyDispatched = order.order_items.every(item => {
      const dispatched = parseFloat(quantities[item.id] || '0')
      return remainingKg(item) - dispatched <= 0
    })

    // Always update scheduled_dispatch_date to actual dispatch date; close if fully done
    await supabase.from('orders').update({
      scheduled_dispatch_date: dispatchDate,
      ...(fullyDispatched ? { status: 'dispatched' } : {}),
    }).eq('id', order.id)

    await queryClient.invalidateQueries({ queryKey: ['dispatches'] })
    await queryClient.invalidateQueries({ queryKey: ['orders'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    onDone()
  }

  return (
    <div className="px-5 py-4 bg-blue-50 border-t border-blue-100 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">DR# *</Label>
          <Input value={drNumber} onChange={e => setDrNumber(e.target.value)} placeholder="DR-001" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Dispatch Date</Label>
          <Input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Received By <span className="text-gray-400 font-normal">optional</span></Label>
          <Input value={receiverName} onChange={e => setReceiverName(e.target.value)} placeholder="Receiver name" className="h-8 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-blue-200 bg-white px-3 py-2">
        <div className="space-y-1">
          <Label className="text-xs">Picked from *</Label>
          <select
            value={showPerLine ? '' : pickedAll}
            onChange={e => { setShowPerLine(false); setPickedForAll(e.target.value) }}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            {showPerLine && <option value="">Per line…</option>}
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-gray-500 flex-1 min-w-[16rem] pb-1.5">
          Where the sacks actually came off. Defaults to where the order was sourced.
          {' '}Change it and the transfer is recorded for you.
        </p>
        {locations.length > 1 && (
          <button type="button" onClick={() => setShowPerLine(v => !v)}
                  className="text-xs text-blue-600 hover:underline pb-1.5">
            {showPerLine ? 'Same for all lines' : 'Different per line'}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {itemsToDispatch.map(item => {
          const picked = pickedFor(item)
          const sourced = item.location_id ?? picked
          const moved = picked && picked !== sourced
          return (
            <div key={item.id} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.lots?.name ?? '—'}</p>
                <p className="text-xs text-gray-400">
                  {Math.round(remainingKg(item))} kg remaining
                  <span className="text-gray-300"> · sourced {item.locations?.name ?? '—'}</span>
                  {moved && (
                    <span className="text-amber-600 font-medium"> · will transfer to {locName(picked)}</span>
                  )}
                </p>
              </div>
              {showPerLine && (
                <select
                  value={picked}
                  onChange={e => setPickedBy(prev => ({ ...prev, [item.id]: e.target.value }))}
                  className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs"
                >
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              <Input
                type="number" min="0" max={remainingKg(item)}
                value={quantities[item.id] ?? ''}
                onChange={e => setQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="w-24 text-right h-8 text-sm"
              />
              <span className="text-xs text-gray-400 w-4 shrink-0">kg</span>
            </div>
          )
        })}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Notes <span className="text-gray-400 font-normal">optional</span></Label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any dispatch notes…" className="h-8 text-sm" />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={submitting} size="sm">
          {submitting ? 'Processing…' : 'Confirm Dispatch'}
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Order card — always actionable ──────────────────────────────────────────

function OrderCard({
  order,
  tag,
  activeForm,
  onToggleForm,
  onSetDate,
}: {
  order: PendingOrder
  tag?: 'overdue' | 'today' | 'upcoming'
  activeForm: string | null
  onToggleForm: (id: string) => void
  onSetDate: (id: string, date: string) => void
}) {
  const [scheduling, setScheduling] = useState(false)
  const remaining = orderRemainingKg(order)
  const orderedTotal = order.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg), 0)
  const dispatchedTotal = order.order_items.reduce((s, i) => s + dispatchedKg(i), 0)
  const lastDr = order.dispatches.length
    ? [...order.dispatches].sort((a, b) => b.dispatched_date.localeCompare(a.dispatched_date))[0]
    : null
  const isOpen = activeForm === order.id

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-400">{order.os_number}</span>
            <span className="text-sm font-semibold text-gray-900">{order.clients?.company_name ?? '—'}</span>
            {order.status === 'reserved' && (
              <span
                className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
                title="This client settles after delivery. Nothing has been paid on this order yet."
              >
                unpaid
              </span>
            )}
            {tag === 'overdue' && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                Overdue · {order.scheduled_dispatch_date ? formatDate(order.scheduled_dispatch_date) : ''}
              </span>
            )}
            {tag === 'upcoming' && order.scheduled_dispatch_date && (
              <span className="text-xs text-gray-400">Planned {formatDate(order.scheduled_dispatch_date)}</span>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {order.order_items.filter(i => remainingKg(i) > 0).map(item => (
              <p key={item.id} className="text-xs text-gray-500">
                {item.lots?.name ?? '—'} · <span className="font-medium text-gray-700">{Math.round(remainingKg(item))} kg</span>
                {item.locations?.name && <span className="ml-1 text-gray-400">· {item.locations.name}</span>}
              </p>
            ))}
          </div>
          {dispatchedTotal > 0 && (
            <p className="mt-1.5 text-xs font-medium text-amber-600">
              {Math.round(dispatchedTotal)} of {Math.round(orderedTotal)} kg shipped
              {lastDr && <span className="text-gray-400 font-normal"> · last {lastDr.dr_number}</span>}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900">{Math.round(remaining)} kg</p>
            {(() => {
              const locs = [...new Set(order.order_items.map(i => i.locations?.name).filter(Boolean))]
              return locs.length > 0 ? <p className="text-sm font-medium text-blue-600">{locs.join(' · ')}</p> : <p className="text-sm text-amber-500">Untagged</p>
            })()}
          </div>

          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              variant={isOpen ? 'outline' : 'default'}
              onClick={() => { onToggleForm(order.id); setScheduling(false) }}
            >
              {isOpen ? 'Cancel' : 'Dispatch'}
            </Button>

            {/* Schedule control — only when form not open */}
            {!isOpen && (
              scheduling ? (
                <input
                  autoFocus
                  type="date"
                  defaultValue={order.scheduled_dispatch_date ?? ''}
                  onBlur={e => { onSetDate(order.id, e.target.value); setScheduling(false) }}
                  onChange={e => { if (e.target.value) { onSetDate(order.id, e.target.value); setScheduling(false) } }}
                  className="h-6 w-28 rounded border border-blue-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              ) : (
                <button
                  onClick={() => setScheduling(true)}
                  className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
                >
                  {order.scheduled_dispatch_date ? `📅 ${formatDate(order.scheduled_dispatch_date).split(',')[0]}` : 'Schedule'}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {isOpen && <DispatchForm order={order} onDone={() => onToggleForm(order.id)} />}
    </Card>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ label, kg, count, variant = 'default', children }: {
  label: string; kg: number; count: number
  variant?: 'default' | 'urgent' | 'dim'
  children: React.ReactNode
}) {
  return (
    <div>
      <div className={`flex items-center justify-between border-b pb-2 mb-3 ${variant === 'urgent' ? 'border-red-200' : 'border-gray-200'}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${variant === 'urgent' ? 'text-red-600' : variant === 'dim' ? 'text-gray-400' : 'text-gray-500'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-400">{count} order{count !== 1 ? 's' : ''} · {Math.round(kg)} kg</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DispatchesPage() {
  const queryClient = useQueryClient()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const today = todayStr()

  const { data: orders = [], isLoading } = useQuery<PendingOrder[]>({
    queryKey: ['dispatches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, os_number, order_date, status, scheduled_dispatch_date, clients(company_name, pay_after_dispatch), order_items(id, lot_id, batch_id, location_id, weight_ordered_kg, lots(name), locations(name), dispatch_items(weight_dispatched_kg)), dispatches(dr_number, dispatched_date)')
        .in('status', ['confirmed', 'reserved'])
        .is('archived_at', null)
        .order('scheduled_dispatch_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      // A reserved order only reaches the warehouse if its client settles after
      // delivery. Everyone else still has to clear the payment gate first.
      return (data as unknown as PendingOrder[])
        .filter(o => o.status === 'confirmed' || o.clients?.pay_after_dispatch)
        .filter(o => orderRemainingKg(o) > 0)
    },
  })

  const toggleForm = (id: string) => setActiveForm(prev => prev === id ? null : id)

  const setScheduleDate = async (orderId: string, date: string) => {
    if (!date) return
    await supabase.from('orders').update({ scheduled_dispatch_date: date }).eq('id', orderId)
    await queryClient.invalidateQueries({ queryKey: ['dispatches'] })
    await queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  // Group by urgency
  const overdue  = orders.filter(o => o.scheduled_dispatch_date && o.scheduled_dispatch_date < today)
  const dueToday = orders.filter(o => o.scheduled_dispatch_date === today)
  const upcoming = orders.filter(o => o.scheduled_dispatch_date && o.scheduled_dispatch_date > today)
  const unscheduled = orders.filter(o => !o.scheduled_dispatch_date)

  // Upcoming grouped by date (packing list)
  const upcomingByDate = new Map<string, PendingOrder[]>()
  for (const o of upcoming) {
    const d = o.scheduled_dispatch_date!
    if (!upcomingByDate.has(d)) upcomingByDate.set(d, [])
    upcomingByDate.get(d)!.push(o)
  }

  const actionableKg = [...overdue, ...dueToday, ...unscheduled].reduce((s, o) => s + orderRemainingKg(o), 0)
  const scheduledKg  = upcoming.reduce((s, o) => s + orderRemainingKg(o), 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dispatches</h1>
        {orders.length > 0 && (
          <p className="text-sm text-gray-500 mt-0.5">
            {actionableKg > 0 && `${Math.round(actionableKg)} kg ready to dispatch`}
            {actionableKg > 0 && scheduledKg > 0 && ' · '}
            {scheduledKg > 0 && `${Math.round(scheduledKg)} kg scheduled`}
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && orders.length === 0 && (
        <Card className="p-12 text-center text-gray-400">
          <p className="text-sm">No confirmed orders pending dispatch.</p>
          <p className="text-xs mt-1">Orders appear here once confirmed by the sales team.</p>
        </Card>
      )}

      <div className="space-y-8">
        {overdue.length > 0 && (
          <Section label="Overdue" kg={overdue.reduce((s, o) => s + orderRemainingKg(o), 0)} count={overdue.length} variant="urgent">
            {overdue.map(o => <OrderCard key={o.id} order={o} tag="overdue" activeForm={activeForm} onToggleForm={toggleForm} onSetDate={setScheduleDate} />)}
          </Section>
        )}

        {dueToday.length > 0 && (
          <Section label="Today" kg={dueToday.reduce((s, o) => s + orderRemainingKg(o), 0)} count={dueToday.length}>
            {dueToday.map(o => <OrderCard key={o.id} order={o} tag="today" activeForm={activeForm} onToggleForm={toggleForm} onSetDate={setScheduleDate} />)}
          </Section>
        )}

        {unscheduled.length > 0 && (
          <Section label="Unscheduled" kg={unscheduled.reduce((s, o) => s + orderRemainingKg(o), 0)} count={unscheduled.length} variant="dim">
            {unscheduled.map(o => <OrderCard key={o.id} order={o} activeForm={activeForm} onToggleForm={toggleForm} onSetDate={setScheduleDate} />)}
          </Section>
        )}

        {upcomingByDate.size > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Packing List</p>
              <div className="flex-1 border-t border-gray-100" />
              <p className="text-xs text-gray-400">{Math.round(scheduledKg)} kg · {upcoming.length} order{upcoming.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="space-y-6">
              {[...upcomingByDate.entries()].map(([date, dateOrders]) => (
                <div key={date}>
                  <p className="text-sm font-semibold text-gray-600 mb-2">{formatDate(date)}</p>
                  <div className="space-y-3">
                    {dateOrders.map(o => <OrderCard key={o.id} order={o} tag="upcoming" activeForm={activeForm} onToggleForm={toggleForm} onSetDate={setScheduleDate} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
