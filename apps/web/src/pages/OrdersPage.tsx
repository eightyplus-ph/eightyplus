import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; company_name: string; withholding_tax_rate: string }
interface Lot { id: string; name: string; price_per_kg: number | null }
interface BatchOption {
  batchId: string
  batchNumber: string
  locationId: string
  locationName: string
  availableKg: number
  sacks: number | null
  sackWeightKg: number | null
  skuType: string
}
interface LineItemState { uid: string; lotId: string; batchId: string; kg: string; pricePerKg: string }

interface DispatchItem { weight_dispatched_kg: string }
interface OrderItem {
  id: string
  lot_id: string
  location_id: string | null
  batch_id: string | null
  weight_ordered_kg: string
  price_per_kg: string
  lots: { name: string } | null
  locations: { name: string } | null
  batches: { batch_number: string; sku_type: string | null; sack_weight_kg: string | null } | null
  dispatch_items: DispatchItem[]
}
interface DispatchLineItem {
  weight_dispatched_kg: string
  order_items: { lots: { name: string } | null } | null
}
interface Dispatch {
  id: string
  dr_number: string
  dispatched_date: string
  receiver_name: string | null
  dispatch_items: DispatchLineItem[]
}
interface Order {
  id: string
  os_number: string
  client_id: string
  status: string
  order_date: string
  payment_date: string | null
  scheduled_dispatch_date: string | null
  notes: string | null
  created_at: string
  payment_proof_url: string | null
  created_by: string | null
  discount_percent: string | null
  clients: { company_name: string; withholding_tax_rate: string; tin: string | null; address: string | null } | null
  profiles: { full_name: string } | null
  order_items: OrderItem[]
  dispatches: Dispatch[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = { reserved: 'Reserved', confirmed: 'Confirmed', dispatched: 'Dispatched' }
const STATUS_COLORS: Record<string, string> = {
  reserved: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-green-100 text-green-700',
}

function uid() { return Math.random().toString(36).slice(2) }
function totalKg(items: OrderItem[]) { return items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg ?? '0'), 0) }
function totalValue(items: OrderItem[]) { return items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg ?? '0') * parseFloat(i.price_per_kg ?? '0'), 0) }
function dispatchedKg(item: OrderItem) { return item.dispatch_items.reduce((s, d) => s + parseFloat(d.weight_dispatched_kg ?? '0'), 0) }
function remainingKg(item: OrderItem) { return Math.max(0, parseFloat(item.weight_ordered_kg) - dispatchedKg(item)) }
function discountAmount(gross: number, pct: number) { return gross * (pct / 100) }
function whtAmount(gross: number, rate: number) { return gross * (rate / 100) }
function netDue(gross: number, rate: number) { return gross - whtAmount(gross, rate) }
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [reference, setReference] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const kg = totalKg(order.order_items)
  const gross = totalValue(order.order_items)
  const whtRate = parseFloat(order.clients?.withholding_tax_rate ?? '0')
  const discPct = parseFloat(order.discount_percent ?? '0')

  const handleConfirm = async () => {
    if (!file) return
    setUploading(true); setError('')

    const path = `${order.id}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { error: uploadErr } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: true })
    if (uploadErr) { setError(`Upload failed: ${uploadErr.message}`); setUploading(false); return }

    const notes = reference.trim() ? `${order.notes ? order.notes + ' | ' : ''}Payment ref: ${reference.trim()}` : order.notes
    const today = new Date(); const pd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    const { error: updateErr } = await supabase.from('orders').update({ status: 'confirmed', payment_proof_url: path, notes, payment_date: pd }).eq('id', order.id)
    if (updateErr) { setError(updateErr.message); setUploading(false); return }

    await queryClient.invalidateQueries({ queryKey: ['orders'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">Confirm Order — {order.os_number}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm space-y-1">
            <p className="font-medium text-gray-900">{order.clients?.company_name}</p>
            <p className="text-gray-500">{Math.round(kg)} kg</p>
            <div className="pt-1 space-y-0.5">
              <div className="flex justify-between text-gray-500">
                <span>Gross Total</span>
                <span className="tabular-nums">{peso(gross)}</span>
              </div>
              {discPct > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span>Discount ({discPct}%)</span>
                  <span className="tabular-nums text-red-400">− {peso(discountAmount(gross, discPct))}</span>
                </div>
              )}
              {whtRate > 0 && (
                <div className="flex justify-between text-gray-400">
                  <span>WHT ({whtRate}%)</span>
                  <span className="tabular-nums text-red-400">− {peso(whtAmount(gross - discountAmount(gross, discPct), whtRate))}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200">
                <span>{(discPct > 0 || whtRate > 0) ? 'Net Amount Due' : 'Total'}</span>
                <span className="tabular-nums">{peso(netDue(gross - discountAmount(gross, discPct), whtRate))}</span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Confirmation *</Label>
            <div className="border-2 border-dashed border-gray-200 rounded-lg px-4 py-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors" onClick={() => fileRef.current?.click()}>
              {file ? (
                <div><p className="text-sm font-medium text-gray-900">{file.name}</p><p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB · click to change</p></div>
              ) : (
                <div><p className="text-sm text-gray-500">Click to upload proof of payment</p><p className="text-xs text-gray-400 mt-1">JPG, PNG, or PDF</p></div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Reference <span className="text-gray-400 font-normal text-xs">optional</span></Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank ref, transaction ID, check no." />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleConfirm} disabled={!file || uploading} className="flex-1">{uploading ? 'Uploading…' : 'Confirm Order'}</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Statement of Account ───────────────────────────────────────────────────────

// Eightyplus seller details
const SELLER = {
  name: 'Eightyplus PH',
}

function StatementOfAccount({ order, onClose }: { order: Order; onClose: () => void }) {
  const items = order.order_items
  const gross = totalValue(items)
  const kg = totalKg(items)
  const discPct = parseFloat(order.discount_percent ?? '0')
  const discAmt = discountAmount(gross, discPct)
  const afterDisc = gross - discAmt
  const whtRate = parseFloat(order.clients?.withholding_tax_rate ?? '0')
  const whtAmt = whtAmount(afterDisc, whtRate)
  const net = afterDisc - whtAmt
  const printDate = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
  const orderDate = new Date(order.order_date + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
  const paid = !!order.payment_date

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-auto print:bg-white print:p-0" onClick={onClose}>
      <style>{`@media print { body * { visibility: hidden !important; } #soa-print, #soa-print * { visibility: visible !important; } #soa-print { position: absolute; left: 0; top: 0; width: 100%; } .soa-noprint { display: none !important; } }`}</style>
      <div className="bg-white w-full max-w-2xl my-4 rounded-lg shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="soa-noprint flex justify-between items-center px-6 py-3 border-b border-gray-200">
          <span className="text-sm font-medium text-gray-700">Statement of Account — {order.os_number}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => window.print()}>Print / Save PDF</Button>
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div id="soa-print" className="px-8 py-8 text-sm text-gray-800">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-lg font-bold text-gray-900">{SELLER.name}</p>
            </div>
            <div className="text-right">
              <p className="text-base font-bold tracking-wide text-gray-900">STATEMENT OF ACCOUNT</p>
              <p className="text-xs text-gray-500">SOA No. SOA-{order.os_number}</p>
              <p className="text-xs text-gray-500">Order Date: {orderDate}</p>
              <p className="text-xs text-gray-500">Printed: {printDate}</p>
            </div>
          </div>

          {/* Bill to */}
          <div className="mb-6 rounded border border-gray-200 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Bill To</p>
            <p className="font-semibold text-gray-900">{order.clients?.company_name}</p>
            {order.clients?.tin && <p className="text-xs text-gray-500">TIN: {order.clients.tin}</p>}
            {order.clients?.address && <p className="text-xs text-gray-500">{order.clients.address}</p>}
          </div>

          {/* Line items */}
          <table className="w-full mb-4">
            <thead>
              <tr className="border-b border-gray-300 text-xs text-gray-500">
                <th className="text-left py-1.5 font-medium">Product</th>
                <th className="text-right py-1.5 font-medium">Qty (kg)</th>
                <th className="text-right py-1.5 font-medium">Price/kg</th>
                <th className="text-right py-1.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => {
                const w = parseFloat(i.weight_ordered_kg); const p = parseFloat(i.price_per_kg)
                return (
                  <tr key={i.id} className="border-b border-gray-100">
                    <td className="py-1.5">{i.lots?.name ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums">{w.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{peso(p)}</td>
                    <td className="py-1.5 text-right tabular-nums">{peso(w * p)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mb-6">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Gross Total ({Math.round(kg)} kg)</span>
                <span className="tabular-nums">{peso(gross)}</span>
              </div>
              {discPct > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Discount ({discPct}%)</span>
                  <span className="tabular-nums">− {peso(discAmt)}</span>
                </div>
              )}
              {whtRate > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Withholding Tax ({whtRate}%)</span>
                  <span className="tabular-nums">− {peso(whtAmt)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-1.5 border-t border-gray-300">
                <span>Net Amount Due</span>
                <span className="tabular-nums">{peso(net)}</span>
              </div>
            </div>
          </div>

          {/* Payment status */}
          <div className="mb-8">
            <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {paid ? `PAID — ${new Date(order.payment_date! + 'T00:00:00').toLocaleDateString('en-PH')}` : 'UNPAID'}
            </span>
            {order.notes && <p className="text-xs text-gray-500 mt-2">{order.notes}</p>}
          </div>

          <p className="text-xs text-gray-400 border-t border-gray-200 pt-3">This is a system-generated statement of account. Please settle the Net Amount Due per agreed terms.</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()

  const [showForm, setShowForm] = useState(false)
  const [clientId, setClientId] = useState('')
  const [contractId, setContractId] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [osNumber, setOsNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemState[]>([{ uid: uid(), lotId: '', batchId: '', kg: '', pricePerKg: '' }])
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirmingOrder, setConfirmingOrder] = useState<Order | null>(null)
  const [soaOrder, setSoaOrder] = useState<Order | null>(null)
  const [search, setSearch] = useState('')

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, company_name, withholding_tax_rate').eq('status', 'active').order('company_name')
      if (error) throw error
      return data as Client[]
    },
  })

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['lots-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lots').select('id, name, price_per_kg').order('name')
      if (error) throw error
      return data as Lot[]
    },
  })

  const { data: clientContracts = [] } = useQuery<{ id: string; contract_number: string }[]>({
    queryKey: ['contracts-for-client', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('id, contract_number').eq('client_id', clientId).eq('status', 'active').order('contract_number')
      if (error) throw error
      return data as { id: string; contract_number: string }[]
    },
  })

  const { data: batchesByLot = {} } = useQuery<Record<string, BatchOption[]>>({
    queryKey: ['batches-by-lot'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, lot_id, location_id, weight_kg, sacks, sack_weight_kg, sku_type, locations(name)')
        .is('contract_item_id', null)
        .gt('weight_kg', 0)
      if (error) throw error
      const map: Record<string, BatchOption[]> = {}
      for (const b of data ?? []) {
        const lotId = b.lot_id as string
        const locationName = (b.locations as unknown as { name: string } | null)?.name ?? 'Unknown'
        if (!map[lotId]) map[lotId] = []
        map[lotId].push({
          batchId: b.id as string,
          batchNumber: b.batch_number as string,
          locationId: b.location_id as string,
          locationName,
          availableKg: parseFloat(b.weight_kg ?? '0'),
          sacks: b.sacks ? parseInt(String(b.sacks)) : null,
          sackWeightKg: b.sack_weight_kg ? parseFloat(String(b.sack_weight_kg)) : null,
          skuType: (b.sku_type as string) ?? 'commercial',
        })
      }
      return map
    },
  })

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, clients(company_name, withholding_tax_rate, tin, address), profiles(full_name), order_items(id, lot_id, location_id, batch_id, weight_ordered_kg, price_per_kg, lots(name), locations(name), batches(batch_number, sku_type, sack_weight_kg), dispatch_items(weight_dispatched_kg)), dispatches(id, dr_number, dispatched_date, receiver_name, dispatch_items(weight_dispatched_kg, order_items(lots(name))))')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Order[]
    },
  })

  const q = search.toLowerCase()
  const visibleOrders = q
    ? orders.filter(o =>
        o.os_number.toLowerCase().includes(q) ||
        (o.clients?.company_name ?? '').toLowerCase().includes(q) ||
        o.status.includes(q)
      )
    : orders

  const addLine = () => setLineItems(prev => [...prev, { uid: uid(), lotId: '', batchId: '', kg: '', pricePerKg: '' }])
  const removeLine = (id: string) => setLineItems(prev => prev.filter(l => l.uid !== id))
  const updateLine = (id: string, field: keyof Omit<LineItemState, 'uid'>, value: string) =>
    setLineItems(prev => prev.map(l => l.uid === id ? { ...l, [field]: value } : l))
  const updateLot = (lineUid: string, lotId: string) => {
    const lot = lots.find(l => l.id === lotId)
    setLineItems(prev => prev.map(l => l.uid === lineUid
      ? { ...l, lotId, batchId: '', pricePerKg: lot?.price_per_kg != null ? String(lot.price_per_kg) : l.pricePerKg }
      : l
    ))
  }

  const resetForm = () => {
    setClientId(''); setContractId(''); setOrderDate(new Date().toISOString().slice(0, 10))
    setOsNumber(''); setNotes('')
    setLineItems([{ uid: uid(), lotId: '', batchId: '', kg: '', pricePerKg: '' }])
    setFormError(''); setShowForm(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!clientId) { setFormError('Select a client.'); return }
    const validItems = lineItems.filter(l => l.lotId && l.batchId && parseFloat(l.kg) > 0 && l.pricePerKg !== '' && parseFloat(l.pricePerKg) >= 0)
    const incompleteItems = lineItems.filter(l => l.lotId && !(l.batchId && parseFloat(l.kg) > 0 && l.pricePerKg !== '' && parseFloat(l.pricePerKg) >= 0))
    if (validItems.length === 0) { setFormError('Add at least one complete line item.'); return }
    if (incompleteItems.length > 0) {
      const names = incompleteItems.map(l => lots.find(lot => lot.id === l.lotId)?.name ?? 'Unknown').join(', ')
      setFormError(`Some items are incomplete and would be dropped: ${names}. Fix or remove them before saving.`)
      setSubmitting(false)
      return
    }
    setSubmitting(true)

    let finalOsNumber = osNumber.trim()
    if (!finalOsNumber) {
      const d = new Date()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const yyyy = d.getFullYear()
      const dateStr = `${mm}${dd}${yyyy}`
      const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).like('os_number', `OS-${dateStr}%`)
      finalOsNumber = `OS-${dateStr}-${String((count ?? 0) + 1).padStart(2, '0')}`
    }

    const { data: orderData, error: orderErr } = await supabase.from('orders')
      .insert([{ os_number: finalOsNumber, client_id: clientId, contract_id: contractId || null, status: 'reserved', order_date: orderDate, notes: notes.trim() || null, created_by: profile?.id ?? null }])
      .select()
    if (orderErr) { setFormError(orderErr.message); setSubmitting(false); return }

    const { error: itemsErr } = await supabase.from('order_items').insert(
      validItems.map(l => {
        const batch = (batchesByLot[l.lotId] ?? []).find(b => b.batchId === l.batchId)
        return {
          order_id: orderData[0].id,
          lot_id: l.lotId,
          location_id: batch?.locationId ?? null,
          batch_id: l.batchId,
          weight_ordered_kg: parseFloat(l.kg),
          price_per_kg: parseFloat(l.pricePerKg),
        }
      })
    )
    if (itemsErr) { setFormError(itemsErr.message); setSubmitting(false); return }

    await queryClient.invalidateQueries({ queryKey: ['orders'] })
    await queryClient.invalidateQueries({ queryKey: ['batches-by-lot'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    resetForm(); setSubmitting(false)
  }

  const viewProof = async (path: string) => {
    const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        {!showForm && <Button onClick={() => setShowForm(true)} size="sm">+ New Order</Button>}
      </div>

      {/* New order form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">New Order</CardTitle>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-sm">✕ Cancel</button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Client *</Label>
                  <select value={clientId} onChange={e => { setClientId(e.target.value); setContractId('') }} className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <option value="">Select client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Order Date *</Label>
                  <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>OS# <span className="text-gray-400 font-normal text-xs">optional — auto if blank</span></Label>
                  <Input value={osNumber} onChange={e => setOsNumber(e.target.value)} placeholder="OS-06282026-01" />
                </div>
              </div>

              {clientId && clientContracts.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Contract <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                  <select value={contractId} onChange={e => setContractId(e.target.value)} className="h-9 w-56 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <option value="">No contract</option>
                    {clientContracts.map(c => <option key={c.id} value={c.id}>{c.contract_number}</option>)}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Line Items *</Label>
                  <button type="button" onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add line</button>
                </div>
                <div className="space-y-2">
                  {lineItems.map((line, idx) => {
                    const lineTotal = parseFloat(line.kg || '0') * parseFloat(line.pricePerKg || '0')
                    const batchOptions = line.lotId ? (batchesByLot[line.lotId] ?? []) : []
                    return (
                      <div key={line.uid} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-4">
                          <select value={line.lotId} onChange={e => updateLot(line.uid, e.target.value)} className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                            <option value="">Product…</option>
                            {lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <select value={line.batchId} onChange={e => updateLine(line.uid, 'batchId', e.target.value)} disabled={!line.lotId} className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40">
                            <option value="">Batch…</option>
                            {batchOptions.map(b => {
                              const skuLabel = b.skuType === 'retail_1kg' ? '1 kg bag' : (b.sackWeightKg ? `${b.sackWeightKg} kg/sk` : 'sack')
                              return (
                                <option key={b.batchId} value={b.batchId}>
                                  {b.locationName} · {skuLabel} · {Math.round(b.availableKg)} kg
                                </option>
                              )
                            })}
                          </select>
                        </div>
                        <div className="col-span-2"><Input type="number" min="0" placeholder="kg" value={line.kg} onChange={e => updateLine(line.uid, 'kg', e.target.value)} /></div>
                        <div className="col-span-2"><Input type="number" min="0" step="0.01" placeholder="₱/kg" value={line.pricePerKg} onChange={e => updateLine(line.uid, 'pricePerKg', e.target.value)} /></div>
                        <div className="col-span-1 text-right text-xs text-gray-500 pr-1">
                          <div>{lineTotal > 0 ? `₱${Math.round(lineTotal).toLocaleString()}` : '—'}</div>
                          <div className="col-span-1 flex justify-end mt-0.5">
                            {idx > 0 && <button type="button" onClick={() => removeLine(line.uid)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="grid grid-cols-12 gap-2 mt-1 text-xs text-gray-400 px-0.5">
                  <div className="col-span-4">Product</div>
                  <div className="col-span-3">Batch / Stock</div>
                  <div className="col-span-2">Weight (kg)</div>
                  <div className="col-span-2">Price (₱/kg)</div>
                  <div className="col-span-1 text-right">Subtotal</div>
                </div>
              </div>

              {/* WHT Summary */}
              {(() => {
                const selectedClient = clients.find(c => c.id === clientId)
                const whtRate = parseFloat(selectedClient?.withholding_tax_rate ?? '0')
                const gross = lineItems.reduce((s, l) => s + parseFloat(l.kg || '0') * parseFloat(l.pricePerKg || '0'), 0)
                if (gross <= 0) return null
                return (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>Gross Total</span>
                      <span className="font-medium tabular-nums">{peso(gross)}</span>
                    </div>
                    {whtRate > 0 && (
                      <>
                        <div className="flex justify-between items-center text-gray-500 mt-1">
                          <span>WHT ({whtRate}%)</span>
                          <span className="tabular-nums text-red-500">− {peso(whtAmount(gross, whtRate))}</span>
                        </div>
                        <div className="flex justify-between items-center font-semibold text-gray-900 mt-2 pt-2 border-t border-gray-200">
                          <span>Net Amount Due</span>
                          <span className="tabular-nums">{peso(netDue(gross, whtRate))}</span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}

              <div className="space-y-1.5">
                <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" />
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex gap-3">
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Reserve'}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Orders list */}
      <Card>
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by OS#, client, or status…"
            className="w-full max-w-sm h-8 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 w-8"></th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">OS#</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Dates</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Total kg</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Total Value</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>}
              {!isLoading && visibleOrders.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">{search ? 'No orders match your search.' : 'No orders yet. Create your first order above.'}</td></tr>}
              {visibleOrders.map(order => {
                const isOpen = expanded.has(order.id)
                const kg = totalKg(order.order_items)
                const value = totalValue(order.order_items)
                const dispatched = order.order_items.reduce((s, i) => s + dispatchedKg(i), 0)
                const partiallyShipped = dispatched > 0 && dispatched < kg - 0.01
                return (
                  <>
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                      <td className="px-4 py-3 text-gray-400 text-xs select-none">{isOpen ? '▲' : '▼'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{order.os_number}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{order.clients?.company_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-600">{new Date(order.order_date + 'T00:00:00').toLocaleDateString()}</span>
                        {order.payment_date && (
                          <span className="block text-xs text-gray-400">paid {new Date(order.payment_date + 'T00:00:00').toLocaleDateString()}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[order.status] ?? order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {Math.round(kg)} kg
                        {partiallyShipped && (
                          <span className="block text-xs font-medium text-amber-600">{Math.round(dispatched)} of {Math.round(kg)} kg shipped</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const rate = parseFloat(order.clients?.withholding_tax_rate ?? '0')
                          return (
                            <>
                              <p className="text-gray-900 tabular-nums">{peso(value)}</p>
                              {rate > 0 && <p className="text-xs text-gray-400 tabular-nums">Net {peso(netDue(value, rate))}</p>}
                            </>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-2 items-center">
                          {order.status === 'reserved' && (
                            <button onClick={() => setConfirmingOrder(order)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Confirm</button>
                          )}
                          {order.status === 'confirmed' && (
                            <span className="flex items-center gap-1.5">
                              {order.scheduled_dispatch_date && (
                                <span className="text-xs text-gray-400">{new Date(order.scheduled_dispatch_date + 'T00:00:00').toLocaleDateString()}</span>
                              )}
                              <a href="/dispatches" className="text-xs text-green-600 hover:underline whitespace-nowrap">→ Dispatches</a>
                            </span>
                          )}
                          {order.payment_proof_url && (
                            <button onClick={() => viewProof(order.payment_proof_url!)} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">View proof</button>
                          )}
                          <button onClick={() => setSoaOrder(order)} className="text-xs text-gray-500 hover:text-blue-600 whitespace-nowrap">Statement</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${order.id}-detail`} className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={8} className="px-8 py-4">
                          {order.notes && <p className="text-xs text-gray-500 mb-3 italic">{order.notes}</p>}

                          {/* Line items with dispatch progress */}
                          <table className="w-full text-xs mb-4">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left pb-1 font-medium">Product</th>
                                <th className="text-left pb-1 font-medium">Batch / Location</th>
                                <th className="text-right pb-1 font-medium">Ordered</th>
                                <th className="text-right pb-1 font-medium">Dispatched</th>
                                <th className="text-right pb-1 font-medium">Remaining</th>
                                <th className="text-right pb-1 font-medium">Price/kg</th>
                                <th className="text-right pb-1 font-medium">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.order_items.map(item => {
                                const rem = remainingKg(item)
                                const dis = dispatchedKg(item)
                                const batchCell = item.batches
                                  ? (() => {
                                      const skuLabel = item.batches.sku_type === 'retail_1kg' ? '1 kg bag' : 'sack'
                                      return `${item.batches.batch_number} · ${skuLabel} · ${item.locations?.name ?? ''}`
                                    })()
                                  : (item.locations?.name ?? null)
                                return (
                                  <tr key={item.id} className="border-t border-gray-100">
                                    <td className="py-1.5 text-gray-700">{item.lots?.name ?? '—'}</td>
                                    <td className="py-1.5 text-xs text-gray-500">{batchCell ?? <span className="text-amber-500">Untagged</span>}</td>
                                    <td className="py-1.5 text-right text-gray-700">{Math.round(parseFloat(item.weight_ordered_kg))} kg</td>
                                    <td className="py-1.5 text-right text-gray-600">{Math.round(dis)} kg</td>
                                    <td className={`py-1.5 text-right font-medium ${rem > 0 ? 'text-amber-600' : 'text-green-600'}`}>{rem > 0 ? `${Math.round(rem)} kg` : '✓ Done'}</td>
                                    <td className="py-1.5 text-right text-gray-600">₱{parseFloat(item.price_per_kg).toLocaleString()}</td>
                                    <td className="py-1.5 text-right text-gray-900 font-medium">₱{(parseFloat(item.weight_ordered_kg) * parseFloat(item.price_per_kg)).toLocaleString()}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>

                          {/* Financial summary */}
                          {(() => {
                            const gross = totalValue(order.order_items)
                            const rate = parseFloat(order.clients?.withholding_tax_rate ?? '0')
                            const disc = parseFloat(order.discount_percent ?? '0')
                            const afterDisc = gross - discountAmount(gross, disc)
                            return (
                              <div className="flex justify-end mb-4">
                                <div className="text-xs space-y-1 min-w-48">
                                  <div className="flex justify-between gap-8 text-gray-500">
                                    <span>Gross Total</span>
                                    <span className="tabular-nums font-medium text-gray-700">{peso(gross)}</span>
                                  </div>
                                  {disc > 0 && (
                                    <div className="flex justify-between gap-8 text-gray-400">
                                      <span>Discount ({disc}%)</span>
                                      <span className="tabular-nums text-red-400">− {peso(discountAmount(gross, disc))}</span>
                                    </div>
                                  )}
                                  {rate > 0 && (
                                    <div className="flex justify-between gap-8 text-gray-400">
                                      <span>WHT ({rate}%)</span>
                                      <span className="tabular-nums text-red-400">− {peso(whtAmount(afterDisc, rate))}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between gap-8 font-semibold text-gray-900 pt-1 border-t border-gray-200">
                                    <span>{(disc > 0 || rate > 0) ? 'Net Amount Due' : 'Total'}</span>
                                    <span className="tabular-nums">{peso(netDue(afterDisc, rate))}</span>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {/* Dispatch history */}
                          {order.dispatches.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-400 mb-1.5">Dispatch History</p>
                              <div className="space-y-2">
                                {order.dispatches
                                  .slice()
                                  .sort((a, b) => a.dispatched_date.localeCompare(b.dispatched_date))
                                  .map(d => (
                                    <div key={d.id} className="text-xs text-gray-600">
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-gray-700">{d.dr_number}</span>
                                        <span>{new Date(d.dispatched_date + 'T00:00:00').toLocaleDateString()}</span>
                                        {d.receiver_name && <span className="text-gray-400">· {d.receiver_name}</span>}
                                      </div>
                                      {d.dispatch_items.length > 0 && (
                                        <div className="mt-0.5 ml-2 space-y-0.5">
                                          {d.dispatch_items.map((di, i) => (
                                            <p key={i} className="text-gray-400">
                                              {di.order_items?.lots?.name ?? '—'} · <span className="font-medium text-gray-600">{parseFloat(di.weight_dispatched_kg)} kg</span>
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {confirmingOrder && <ConfirmModal order={confirmingOrder} onClose={() => setConfirmingOrder(null)} />}
      {soaOrder && <StatementOfAccount order={soaOrder} onClose={() => setSoaOrder(null)} />}
    </div>
  )
}
