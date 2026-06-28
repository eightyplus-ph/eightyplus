import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Client {
  id: string
  company_name: string
  brand_name: string | null
  tin: string | null
  contact_name: string | null
  contact_phone: string | null
  address: string | null
  payment_terms: string | null
  credit_limit: string | null
  withholding_tax_rate: string
  status: string
  notes: string | null
}

interface ClientOrder {
  id: string
  os_number: string
  order_date: string
  payment_date: string | null
  status: string
  order_items: { weight_ordered_kg: string; price_per_kg: string; lots: { name: string } | null }[]
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  reserved: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-green-100 text-green-700',
}
const ORDER_STATUS_LABELS: Record<string, string> = { reserved: 'Reserved', confirmed: 'Confirmed', dispatched: 'Dispatched' }

function ClientOrders({ clientId }: { clientId: string }) {
  const { data: orders = [], isLoading } = useQuery<ClientOrder[]>({
    queryKey: ['client-orders', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, os_number, order_date, payment_date, status, order_items(weight_ordered_kg, price_per_kg, lots(name))')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ClientOrder[]
    },
  })

  if (isLoading) return <p className="text-xs text-gray-400 py-2">Loading…</p>
  if (orders.length === 0) return <p className="text-xs text-gray-400 py-2">No orders yet.</p>

  const totals = orders.reduce(
    (s, o) => ({
      kg: s.kg + o.order_items.reduce((t, i) => t + parseFloat(i.weight_ordered_kg), 0),
      value: s.value + o.order_items.reduce((t, i) => t + parseFloat(i.weight_ordered_kg) * parseFloat(i.price_per_kg), 0),
    }),
    { kg: 0, value: 0 }
  )

  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_120px_80px_100px] gap-x-4 text-xs font-medium text-gray-400 pb-1.5 border-b border-gray-100 mb-1">
        <span>OS#</span><span>Date</span><span>Status</span><span className="text-right">kg</span><span className="text-right">Value</span>
      </div>
      {orders.map(o => {
        const kg = o.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg), 0)
        const val = o.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg) * parseFloat(i.price_per_kg), 0)
        return (
          <div key={o.id} className="py-1.5 border-b border-gray-50">
            <div className="grid grid-cols-[1fr_1fr_120px_80px_100px] gap-x-4 text-xs text-gray-600">
              <span className="font-mono text-gray-700">{o.os_number}</span>
              <span>
                {new Date(o.order_date + 'T00:00:00').toLocaleDateString()}
                {o.payment_date && <span className="block text-gray-400">paid {new Date(o.payment_date + 'T00:00:00').toLocaleDateString()}</span>}
              </span>
              <span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {ORDER_STATUS_LABELS[o.status] ?? o.status}
                </span>
              </span>
              <span className="text-right">{Math.round(kg)} kg</span>
              <span className="text-right">₱{val.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 ml-0 space-y-0.5">
              {o.order_items.map((item, i) => (
                <p key={i} className="text-xs text-gray-400">
                  {item.lots?.name ?? '—'} · <span className="text-gray-500">{parseFloat(item.weight_ordered_kg)} kg</span>
                </p>
              ))}
            </div>
          </div>
        )
      })}
      <div className="grid grid-cols-[1fr_1fr_120px_80px_100px] gap-x-4 text-xs font-semibold text-gray-700 pt-1.5 mt-0.5">
        <span className="col-span-3 text-gray-400">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
        <span className="text-right">{Math.round(totals.kg)} kg</span>
        <span className="text-right">₱{totals.value.toLocaleString()}</span>
      </div>
    </div>
  )
}

const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 60', 'COD']
const EWT_RATES = ['0', '1', '2', '5', '10', '15']

// ─── Shared form fields ───────────────────────────────────────────────────────

interface ClientFormState {
  company_name: string
  brand_name: string
  tin: string
  contact_name: string
  contact_phone: string
  address: string
  payment_terms: string
  credit_limit: string
  withholding_tax_rate: string
  notes: string
}

const emptyForm = (): ClientFormState => ({
  company_name: '',
  brand_name: '',
  tin: '',
  contact_name: '',
  contact_phone: '',
  address: '',
  payment_terms: 'Net 30',
  credit_limit: '',
  withholding_tax_rate: '0',
  notes: '',
})

function ClientFormFields({
  form,
  onChange,
}: {
  form: ClientFormState
  onChange: (field: keyof ClientFormState, value: string) => void
}) {
  const set = (field: keyof ClientFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange(field, e.target.value)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Company Name *</Label>
          <Input value={form.company_name} onChange={set('company_name')} placeholder="e.g. Yardstick Coffee Roasters Inc." />
        </div>
        <div className="space-y-1.5">
          <Label>Brand Name <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input value={form.brand_name} onChange={set('brand_name')} placeholder="e.g. Yardstick Coffee" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>TIN <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input value={form.tin} onChange={set('tin')} placeholder="000-000-000-000" />
        </div>
        <div className="space-y-1.5">
          <Label>Contact Name <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input value={form.contact_name} onChange={set('contact_name')} placeholder="Juan Santos" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Contact Phone <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input value={form.contact_phone} onChange={set('contact_phone')} placeholder="+63 9xx xxx xxxx" />
        </div>
        <div className="space-y-1.5">
          <Label>Payment Terms</Label>
          <select
            value={form.payment_terms}
            onChange={set('payment_terms')}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Credit Limit (₱) <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input type="number" min="0" step="1000" value={form.credit_limit} onChange={set('credit_limit')} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <Label>EWT Rate</Label>
          <select
            value={form.withholding_tax_rate}
            onChange={set('withholding_tax_rate')}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {EWT_RATES.map(r => (
              <option key={r} value={r}>{r === '0' ? 'None (0%)' : `${r}%`}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Address <span className="text-gray-400 font-normal text-xs">optional</span></Label>
          <Input value={form.address} onChange={set('address')} placeholder="City, Province" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
        <textarea
          value={form.notes}
          onChange={set('notes')}
          rows={2}
          placeholder="Any additional notes…"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        />
      </div>
    </div>
  )
}

// ─── Add Client dialog ────────────────────────────────────────────────────────

function AddClientDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ClientFormState>(emptyForm())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (field: keyof ClientFormState, value: string) =>
    setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.company_name.trim()) { setError('Company name is required.'); return }
    setLoading(true)
    const { error } = await supabase.from('clients').insert([{
      company_name: form.company_name.trim(),
      brand_name: form.brand_name.trim() || null,
      tin: form.tin.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      address: form.address.trim() || null,
      payment_terms: form.payment_terms,
      credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : 0,
      withholding_tax_rate: parseFloat(form.withholding_tax_rate),
      notes: form.notes.trim() || null,
      status: 'active',
    }])
    if (error) { setError(error.message); setLoading(false); return }
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    onClose()
  }

  return (
    <Dialog onClose={onClose} title="Add Client">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ClientFormFields form={form} onChange={handleChange} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Add Client'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ─── Edit Client dialog ───────────────────────────────────────────────────────

function EditClientDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ClientFormState>({
    company_name: client.company_name,
    brand_name: client.brand_name ?? '',
    tin: client.tin ?? '',
    contact_name: client.contact_name ?? '',
    contact_phone: client.contact_phone ?? '',
    address: client.address ?? '',
    payment_terms: client.payment_terms ?? 'Net 30',
    credit_limit: client.credit_limit ?? '',
    withholding_tax_rate: client.withholding_tax_rate ?? '0',
    notes: client.notes ?? '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (field: keyof ClientFormState, value: string) =>
    setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.company_name.trim()) { setError('Company name is required.'); return }
    setLoading(true)
    const { error } = await supabase.from('clients').update({
      company_name: form.company_name.trim(),
      brand_name: form.brand_name.trim() || null,
      tin: form.tin.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      address: form.address.trim() || null,
      payment_terms: form.payment_terms,
      credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : 0,
      withholding_tax_rate: parseFloat(form.withholding_tax_rate),
      notes: form.notes.trim() || null,
    }).eq('id', client.id)
    if (error) { setError(error.message); setLoading(false); return }
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    onClose()
  }

  const handleToggleStatus = async () => {
    const next = client.status === 'active' ? 'inactive' : 'active'
    await supabase.from('clients').update({ status: next }).eq('id', client.id)
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    onClose()
  }

  return (
    <Dialog onClose={onClose} title="Edit Client">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ClientFormFields form={form} onChange={handleChange} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleToggleStatus}
            className={client.status === 'active' ? 'text-gray-500' : 'text-green-600 border-green-300 hover:bg-green-50'}
          >
            {client.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

// ─── Shared dialog wrapper ────────────────────────────────────────────────────

function Dialog({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('company_name', { ascending: true })
      if (error) throw error
      return data as Client[]
    },
  })

  const formatCreditLimit = (val: string | null) => {
    if (!val || parseFloat(val) === 0) return '—'
    return '₱' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 0 })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Button onClick={() => setShowAdd(true)}>Add Client</Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-8 px-4 py-3"></th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Company</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Payment Terms</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Credit Limit</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">EWT</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && clients.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    No clients yet. Add your first client to get started.
                  </td>
                </tr>
              )}
              {clients.map(client => {
                const isOpen = expanded.has(client.id)
                return (
                  <>
                    <tr
                      key={client.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleExpand(client.id)}
                    >
                      <td className="px-4 py-3 text-gray-400 text-xs select-none">{isOpen ? '▲' : '▼'}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{client.company_name}</p>
                        {client.brand_name && <p className="text-xs text-gray-400 mt-0.5">{client.brand_name}</p>}
                        {client.tin && <p className="text-xs text-gray-400 mt-0.5">TIN {client.tin}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{client.contact_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{client.contact_phone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{client.payment_terms ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCreditLimit(client.credit_limit)}</td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {parseFloat(client.withholding_tax_rate) > 0 ? `${parseFloat(client.withholding_tax_rate)}%` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={client.status === 'active' ? 'success' : 'default'}>
                          {client.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(client)}
                          className="text-xs text-gray-400 hover:text-blue-600 whitespace-nowrap"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${client.id}-orders`} className="bg-gray-50 border-b border-gray-100">
                        <td colSpan={9} className="px-8 py-4">
                          <p className="text-xs font-medium text-gray-400 mb-3">Purchase History</p>
                          <ClientOrders clientId={client.id} />
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

      {showAdd && <AddClientDialog onClose={() => setShowAdd(false)} />}
      {editing && <EditClientDialog client={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
