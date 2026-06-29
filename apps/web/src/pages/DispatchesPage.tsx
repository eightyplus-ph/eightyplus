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
  weight_ordered_kg: string
  lots: { name: string } | null
  dispatch_items: DispatchItemRecord[]
}
interface PendingOrder {
  id: string
  os_number: string
  order_date: string
  scheduled_dispatch_date: string | null
  clients: { company_name: string } | null
  order_items: OrderItem[]
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

function DispatchForm({ order, onDone }: { order: PendingOrder; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [drNumber, setDrNumber] = useState('')
  const [dispatchDate, setDispatchDate] = useState(todayStr())   // always default to today
  const [receiverName, setReceiverName] = useState('')
  const [notes, setNotes] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const itemsToDispatch = order.order_items.filter(i => remainingKg(i) > 0)

  useEffect(() => {
    const initial: Record<string, string> = {}
    for (const item of itemsToDispatch) {
      initial[item.id] = String(Math.round(remainingKg(item)))
    }
    setQuantities(initial)
  }, [order.id])

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
      const { error: diErr } = await supabase.from('dispatch_items').insert([{
        dispatch_id: dispatchId,
        order_item_id: item.id,
        weight_dispatched_kg: qty,
      }])
      if (diErr) { setError(diErr.message); setSubmitting(false); return }

      // FIFO batch deduction
      let remaining = qty
      const { data: batches } = await supabase
        .from('batches').select('id, weight_kg')
        .eq('lot_id', item.lot_id).gt('weight_kg', 0)
        .order('received_at', { ascending: true })

      for (const batch of batches ?? []) {
        if (remaining <= 0) break
        const batchKg = parseFloat(batch.weight_kg)
        const deduct = Math.min(remaining, batchKg)
        await supabase.from('batches').update({ weight_kg: batchKg - deduct }).eq('id', batch.id)
        await supabase.from('inventory_transactions').insert([{
          batch_id: batch.id,
          type: 'dispatch',
          weight_change_kg: (-deduct).toFixed(2),
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

      <div className="space-y-2">
        {itemsToDispatch.map(item => (
          <div key={item.id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{item.lots?.name ?? '—'}</p>
              <p className="text-xs text-gray-400">{Math.round(remainingKg(item))} kg remaining</p>
            </div>
            <Input
              type="number" min="0" max={remainingKg(item)}
              value={quantities[item.id] ?? ''}
              onChange={e => setQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
              className="w-24 text-right h-8 text-sm"
            />
            <span className="text-xs text-gray-400 w-4 shrink-0">kg</span>
          </div>
        ))}
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
  const isOpen = activeForm === order.id

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-400">{order.os_number}</span>
            <span className="text-sm font-semibold text-gray-900">{order.clients?.company_name ?? '—'}</span>
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
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <p className="text-lg font-bold text-gray-900">{Math.round(remaining)} kg</p>

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
        .select('id, os_number, order_date, scheduled_dispatch_date, clients(company_name), order_items(id, lot_id, weight_ordered_kg, lots(name), dispatch_items(weight_dispatched_kg))')
        .eq('status', 'confirmed')
        .order('scheduled_dispatch_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data as unknown as PendingOrder[]).filter(o => orderRemainingKg(o) > 0)
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
