import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile } from '@/lib/profile'

/**
 * Record one payment and allocate it across however many orders it covers.
 *
 * The thing this replaces: on 2026-08-10 a single Yardstick payment was
 * uploaded as three separate proof files across orders 1737-1, 1737-2 and 1925,
 * because payment only ever lived on the order. A payment is now its own row
 * with its own amount, and what is left unallocated is the client's credit.
 *
 * Allocating to a `reserved` order also confirms it — otherwise the order would
 * be paid but still invisible to Dispatches, which lists confirmed orders only.
 */

interface UnpaidOrder {
  id: string
  os_number: string
  order_date: string
  status: string
  payment_date: string | null
  order_items: { weight_ordered_kg: string; price_per_kg: string }[]
}

const peso = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const orderValue = (o: UnpaidOrder) =>
  o.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg ?? '0') * parseFloat(i.price_per_kg ?? '0'), 0)

export default function RecordPaymentDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()
  const fileRef = useRef<HTMLInputElement>(null)

  const [clientId, setClientId] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: clients = [] } = useQuery<{ id: string; company_name: string }[]>({
    queryKey: ['clients-for-payment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients').select('id, company_name').eq('status', 'active').order('company_name')
      if (error) throw error
      return data ?? []
    },
  })

  // Orders worth allocating against: still open, not archived. Already-paid
  // orders stay in the list because a bulk payment often settles a partly-paid
  // one, and hiding them would make that impossible to record.
  const { data: orders = [], isLoading } = useQuery<UnpaidOrder[]>({
    queryKey: ['payable-orders', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, os_number, order_date, status, payment_date, order_items(weight_ordered_kg, price_per_kg)')
        .eq('client_id', clientId)
        .is('archived_at', null)
        .order('order_date')
      if (error) throw error
      return (data ?? []) as unknown as UnpaidOrder[]
    },
  })

  const received = num(amount)
  const allocated = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + num(v), 0),
    [alloc])
  const unallocated = received - allocated
  const chosen = Object.entries(alloc).filter(([, v]) => num(v) > 0)

  const toggle = (o: UnpaidOrder) =>
    setAlloc(prev => {
      const next = { ...prev }
      if (next[o.id]) delete next[o.id]
      else next[o.id] = String(orderValue(o).toFixed(2))
      return next
    })

  /** Fill the remaining amount down the unpaid orders, oldest first. */
  const autoAllocate = () => {
    let left = received
    const next: Record<string, string> = {}
    for (const o of orders) {
      if (left <= 0) break
      if (o.payment_date) continue
      const take = Math.min(left, orderValue(o))
      if (take <= 0) continue
      next[o.id] = take.toFixed(2)
      left -= take
    }
    setAlloc(next)
  }

  const problems: string[] = []
  if (!clientId) problems.push('choose a client')
  if (received <= 0) problems.push('enter the amount received')
  if (chosen.length === 0) problems.push('allocate the payment to at least one order')
  if (allocated > received + 0.005) problems.push(`allocated ${peso(allocated)} exceeds the ${peso(received)} received`)

  const save = async () => {
    setSaving(true); setError(null)
    try {
      let proofPath: string | null = null
      if (file) {
        proofPath = `payments/${clientId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
        const { error: upErr } = await supabase.storage.from('payment-proofs').upload(proofPath, file, { upsert: true })
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
      }

      const { data: pay, error: payErr } = await supabase.from('payments').insert([{
        client_id: clientId,
        payment_date: paymentDate,
        amount: received,
        reference: reference.trim() || null,
        proof_url: proofPath,
        notes: notes.trim() || null,
        created_by: profile?.id ?? null,
      }]).select()
      if (payErr) throw payErr

      const { error: allocErr } = await supabase.from('payment_allocations').insert(
        chosen.map(([orderId, v]) => ({ payment_id: pay[0].id, order_id: orderId, amount: num(v) })))
      if (allocErr) throw allocErr

      // Keep the order-level fields in step. They still drive the Orders list,
      // the Statement of Account, and the confirmed-only Dispatches gate.
      for (const [orderId] of chosen) {
        const o = orders.find(x => x.id === orderId)
        await supabase.from('orders').update({
          payment_date: paymentDate,
          ...(proofPath && { payment_proof_url: proofPath }),
          ...(o?.status === 'reserved' && { status: 'confirmed' }),
        }).eq('id', orderId)
      }

      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not record the payment.'
      setError(/relation .*payments.* does not exist|42P01/.test(msg)
        ? 'Recording payments needs SQL_MIGRATION_008 — it has not been run on this database yet.'
        : msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Record a payment</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                One payment, however many orders it covers. Anything left unallocated stays as the client's credit.
              </p>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">✕</button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="pay-client">Client</label>
              <select id="pay-client" value={clientId}
                onChange={e => { setClientId(e.target.value); setAlloc({}) }}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full">
                <option value="">Choose a client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="pay-date">Payment date</label>
              <input id="pay-date" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="pay-amount">Amount received</label>
              <input id="pay-amount" type="number" min="0" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full text-right" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="pay-ref">Reference</label>
              <input id="pay-ref" value={reference} onChange={e => setReference(e.target.value)}
                placeholder="PO#P10946"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full" />
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-500 mb-1">Proof (one file for the whole payment)</label>
            <div className="border-2 border-dashed border-gray-200 rounded-lg px-4 py-3 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm"
              onClick={() => fileRef.current?.click()}>
              {file ? <span className="text-gray-700">{file.name}</span> : <span className="text-gray-400">Click to attach</span>}
            </div>
            <input ref={fileRef} type="file" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>

          {clientId && (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">Allocate to orders</h3>
                <button onClick={autoAllocate} disabled={received <= 0}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline">
                  Fill oldest unpaid first
                </button>
              </div>

              {isLoading && <p className="text-gray-400 py-6 text-center text-sm">Loading orders…</p>}
              {!isLoading && orders.length === 0 && (
                <p className="text-gray-400 py-6 text-center text-sm">This client has no open orders.</p>
              )}

              {!isLoading && orders.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">OS#</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500">Order value</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 w-36">Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const on = alloc[o.id] !== undefined
                        return (
                          <tr key={o.id} className={`border-b border-gray-100 ${on ? 'bg-blue-50' : ''}`}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={on} onChange={() => toggle(o)}
                                aria-label={`Allocate to ${o.os_number}`} className="rounded border-gray-300" />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700">{o.os_number}</td>
                            <td className="px-3 py-2 text-gray-600">{o.order_date}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">
                              {o.status}
                              {o.payment_date && <span className="text-gray-400"> · paid {o.payment_date}</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{peso(orderValue(o))}</td>
                            <td className="px-3 py-2">
                              <input type="number" min="0" step="0.01" disabled={!on}
                                value={alloc[o.id] ?? ''}
                                onChange={e => setAlloc(prev => ({ ...prev, [o.id]: e.target.value }))}
                                className="border border-gray-300 rounded px-2 py-1 text-sm w-full text-right disabled:bg-gray-50" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4 border-t border-gray-200 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Received</span><span className="tabular-nums">{peso(received)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Allocated to {chosen.length} order{chosen.length === 1 ? '' : 's'}</span>
                  <span className="tabular-nums">{peso(allocated)}</span>
                </div>
                <div className={`flex justify-between font-semibold pt-1 border-t border-gray-200 ${
                  unallocated > 0.005 ? 'text-amber-700' : unallocated < -0.005 ? 'text-red-600' : 'text-gray-900'}`}>
                  <span>{unallocated > 0.005 ? 'Unallocated — becomes credit' : unallocated < -0.005 ? 'Over-allocated' : 'Fully allocated'}</span>
                  <span className="tabular-nums">{peso(unallocated)}</span>
                </div>
              </div>
            </>
          )}

          <div className="mt-5">
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="pay-notes">Notes</label>
            <textarea id="pay-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full" />
          </div>

          {error && <p className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          {problems.length > 0 && !error && (
            <ul className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
            <button onClick={save} disabled={saving || problems.length > 0}
              className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
