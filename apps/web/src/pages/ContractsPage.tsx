import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile, canCreateContracts, canManageContracts, canSeeFinancials } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client { id: string; company_name: string }
interface Lot { id: string; name: string }
interface AssignableUser { id: string; full_name: string }

interface ContractRow {
  id: string
  contract_number: string
  client_id: string
  lot_id: string
  weight_contracted_kg: string
  price_per_kg: string
  start_date: string
  end_date: string | null
  status: string
  assigned_to: string | null
  created_by: string | null
  notes: string | null
  created_at: string
  clients: { company_name: string } | null
  lots: { name: string } | null
  assignee: { full_name: string } | null
}

interface LinkedOrder {
  id: string
  os_number: string
  status: string
  order_items: { weight_ordered_kg: string }[]
  dispatches: { dispatch_items: { weight_dispatched_kg: string }[] }[]
}

interface FormState {
  contract_number: string
  client_id: string
  lot_id: string
  weight_contracted_kg: string
  price_per_kg: string
  start_date: string
  end_date: string
  status: string
  assigned_to: string
  notes: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormState = {
  contract_number: '', client_id: '', lot_id: '',
  weight_contracted_kg: '', price_per_kg: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '', status: 'draft', assigned_to: '', notes: '',
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  active:    'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  expired:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function contractDispatchedKg(orders: LinkedOrder[]): number {
  return orders.reduce((sum, o) =>
    sum + o.dispatches.reduce((ds, d) =>
      ds + d.dispatch_items.reduce((is, i) => is + parseFloat(i.weight_dispatched_kg || '0'), 0)
    , 0)
  , 0)
}

function orderedKg(orders: LinkedOrder[]): number {
  return orders.reduce((sum, o) =>
    sum + o.order_items.reduce((s, i) => s + parseFloat(i.weight_ordered_kg || '0'), 0)
  , 0)
}

// ─── Contract Form ─────────────────────────────────────────────────────────────

function ContractForm({
  initial, clients, lots, assignableUsers, onSave, onCancel,
}: {
  initial: FormState
  clients: Client[]
  lots: Lot[]
  assignableUsers: AssignableUser[]
  onSave: (f: FormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.contract_number.trim()) return setError('Contract number is required.')
    if (!form.client_id) return setError('Client is required.')
    if (!form.lot_id) return setError('Lot is required.')
    if (!form.weight_contracted_kg || parseFloat(form.weight_contracted_kg) <= 0) return setError('Weight must be greater than 0.')
    if (!form.price_per_kg || parseFloat(form.price_per_kg) <= 0) return setError('Price per kg is required.')
    if (!form.start_date) return setError('Start date is required.')
    setError('')
    setSaving(true)
    try {
      await onSave(form)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-gray-50 border-b border-gray-200">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Contract #</Label>
          <Input value={form.contract_number} onChange={set('contract_number')} placeholder="EP-2026-001" />
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <select value={form.status} onChange={set('status')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            {['draft','active','fulfilled','expired','cancelled'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Client</Label>
          <select value={form.client_id} onChange={set('client_id')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Lot</Label>
          <select value={form.lot_id} onChange={set('lot_id')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Select lot…</option>
            {lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Weight Contracted (kg)</Label>
          <Input type="number" step="0.01" value={form.weight_contracted_kg} onChange={set('weight_contracted_kg')} placeholder="0.00" />
        </div>
        <div className="space-y-1">
          <Label>Price / kg (₱)</Label>
          <Input type="number" step="0.01" value={form.price_per_kg} onChange={set('price_per_kg')} placeholder="0.00" />
        </div>
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input type="date" value={form.start_date} onChange={set('start_date')} />
        </div>
        <div className="space-y-1">
          <Label>End Date (optional)</Label>
          <Input type="date" value={form.end_date} onChange={set('end_date')} />
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Assigned To</Label>
          <select value={form.assigned_to} onChange={set('assigned_to')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Unassigned</option>
            {assignableUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Notes</Label>
          <textarea value={form.notes} onChange={set('notes')} rows={2}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Contract'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ─── Contract Detail ───────────────────────────────────────────────────────────

function ContractDetail({ contract }: { contract: ContractRow }) {
  const { data: orders = [], isLoading } = useQuery<LinkedOrder[]>({
    queryKey: ['contract-orders', contract.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, os_number, status, order_items(weight_ordered_kg), dispatches(dispatch_items(weight_dispatched_kg))')
        .eq('contract_id', contract.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as LinkedOrder[]
    },
  })

  if (isLoading) return <div className="px-6 py-4 text-sm text-gray-400">Loading orders…</div>
  if (orders.length === 0) return <div className="px-6 py-4 text-sm text-gray-400">No orders linked to this contract yet.</div>

  return (
    <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
      <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">Linked Orders</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 text-xs">
            <th className="pb-2 font-medium">OS #</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium text-right">Ordered</th>
            <th className="pb-2 font-medium text-right">Dispatched</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => {
            const ordered = orderedKg([o])
            const dispatched = contractDispatchedKg([o])
            return (
              <tr key={o.id} className="border-t border-gray-200">
                <td className="py-2 font-mono text-xs text-gray-600">{o.os_number}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="py-2 text-right text-gray-700">{Math.round(ordered)} kg</td>
                <td className="py-2 text-right text-gray-700">{Math.round(dispatched)} kg</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ContractsPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: contracts = [], isLoading } = useQuery<ContractRow[]>({
    queryKey: ['contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(company_name), lots(name), assignee:profiles!contracts_assigned_to_fkey(full_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ContractRow[]
    },
  })

  // Compute dispatched weight per contract
  const contractIds = contracts.map(c => c.id)
  const { data: dispatchedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['contracts-dispatched', contractIds.join(',')],
    enabled: contractIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('contract_id, dispatches(dispatch_items(weight_dispatched_kg))')
        .in('contract_id', contractIds)
        .not('contract_id', 'is', null)
      if (error) throw error
      const map: Record<string, number> = {}
      ;(data ?? []).forEach((o: { contract_id: string; dispatches: { dispatch_items: { weight_dispatched_kg: string }[] }[] }) => {
        if (!o.contract_id) return
        const kg = o.dispatches.reduce((ds: number, d: { dispatch_items: { weight_dispatched_kg: string }[] }) =>
          ds + d.dispatch_items.reduce((is: number, i: { weight_dispatched_kg: string }) => is + parseFloat(i.weight_dispatched_kg || '0'), 0)
        , 0)
        map[o.contract_id] = (map[o.contract_id] ?? 0) + kg
      })
      return map
    },
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, company_name').order('company_name')
      return (data ?? []) as Client[]
    },
  })

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['lots-select'],
    queryFn: async () => {
      const { data } = await supabase.from('lots').select('id, name').order('name')
      return (data ?? []) as Lot[]
    },
  })

  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'sales'])
        .order('full_name')
      return (data ?? []) as AssignableUser[]
    },
  })

  const handleCreate = async (form: FormState) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('contracts').insert([{
      contract_number: form.contract_number.trim(),
      client_id: form.client_id,
      lot_id: form.lot_id,
      weight_contracted_kg: parseFloat(form.weight_contracted_kg),
      price_per_kg: parseFloat(form.price_per_kg),
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      assigned_to: form.assigned_to || null,
      created_by: user?.id ?? null,
      notes: form.notes.trim() || null,
    }])
    if (error) throw new Error(error.message)
    await queryClient.invalidateQueries({ queryKey: ['contracts'] })
    setCreating(false)
  }

  const handleEdit = async (id: string, form: FormState) => {
    const { error } = await supabase.from('contracts').update({
      contract_number: form.contract_number.trim(),
      client_id: form.client_id,
      lot_id: form.lot_id,
      weight_contracted_kg: parseFloat(form.weight_contracted_kg),
      price_per_kg: parseFloat(form.price_per_kg),
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      assigned_to: form.assigned_to || null,
      notes: form.notes.trim() || null,
    }).eq('id', id)
    if (error) throw new Error(error.message)
    await queryClient.invalidateQueries({ queryKey: ['contracts'] })
    setEditingId(null)
  }

  const canCreate = canCreateContracts(profile)
  const showPrice = canSeeFinancials(profile)

  const toForm = (c: ContractRow): FormState => ({
    contract_number: c.contract_number,
    client_id: c.client_id,
    lot_id: c.lot_id,
    weight_contracted_kg: c.weight_contracted_kg,
    price_per_kg: c.price_per_kg,
    start_date: c.start_date,
    end_date: c.end_date ?? '',
    status: c.status,
    assigned_to: c.assigned_to ?? '',
    notes: c.notes ?? '',
  })

  const canEdit = (c: ContractRow) =>
    canManageContracts(profile) ||
    (profile?.role === 'sales' && (c.assigned_to === profile.id || c.created_by === profile.id))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Contracts</h1>
        {canCreate && !creating && (
          <Button onClick={() => { setCreating(true); setEditingId(null) }}>+ New Contract</Button>
        )}
      </div>

      <Card>
        {creating && (
          <ContractForm
            initial={EMPTY_FORM}
            clients={clients}
            lots={lots}
            assignableUsers={assignableUsers}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contract #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Lot</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Contracted</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 w-40">Progress</th>
                {showPrice && <th className="text-right px-4 py-3 font-medium text-gray-500">₱/kg</th>}
                {showPrice && <th className="text-right px-4 py-3 font-medium text-gray-500">Total Value</th>}
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">End Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Assigned</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={showPrice ? 11 : 9} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && contracts.length === 0 && (
                <tr>
                  <td colSpan={showPrice ? 11 : 9} className="px-4 py-12 text-center text-gray-400">
                    No contracts yet. {canCreate && 'Click "+ New Contract" to create one.'}
                  </td>
                </tr>
              )}
              {contracts.map(c => {
                const contracted = parseFloat(c.weight_contracted_kg)
                const dispatched = dispatchedMap[c.id] ?? 0
                const pct = contracted > 0 ? Math.min(100, Math.round((dispatched / contracted) * 100)) : 0
                const totalValue = contracted * parseFloat(c.price_per_kg)
                const isExpanded = expandedId === c.id
                const isEditing = editingId === c.id

                return (
                  <Fragment key={c.id}>
                    <tr
                      key={c.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => !isEditing && setExpandedId(isExpanded ? null : c.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 font-medium">{c.contract_number}</td>
                      <td className="px-4 py-3 text-gray-900">{c.clients?.company_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{c.lots?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{Math.round(contracted)} kg</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{Math.round(dispatched)}/{Math.round(contracted)} kg</p>
                      </td>
                      {showPrice && <td className="px-4 py-3 text-right text-gray-700">₱{parseFloat(c.price_per_kg).toLocaleString()}</td>}
                      {showPrice && <td className="px-4 py-3 text-right text-gray-700">₱{Math.round(totalValue).toLocaleString()}</td>}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {c.end_date ? new Date(c.end_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{c.assignee?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {canEdit(c) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => { setEditingId(isEditing ? null : c.id); setCreating(false) }}
                          >
                            {isEditing ? 'Cancel' : 'Edit'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr key={`${c.id}-edit`}>
                        <td colSpan={showPrice ? 11 : 9} className="p-0">
                          <ContractForm
                            initial={toForm(c)}
                            clients={clients}
                            lots={lots}
                            assignableUsers={assignableUsers}
                            onSave={form => handleEdit(c.id, form)}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                    {isExpanded && !isEditing && (
                      <tr key={`${c.id}-detail`}>
                        <td colSpan={showPrice ? 11 : 9} className="p-0">
                          <ContractDetail contract={c} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
