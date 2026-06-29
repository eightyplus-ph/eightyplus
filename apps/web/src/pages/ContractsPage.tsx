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
interface AssignableUser { id: string; full_name: string }

interface ContractItem {
  id: string
  contract_id: string
  product_name: string
  price_per_kg: string
  monthly_schedule: Record<string, number>
  notes: string | null
}

interface ContractRow {
  id: string
  contract_number: string
  title: string | null
  client_id: string
  start_date: string
  end_date: string | null
  status: string
  assigned_to: string | null
  created_by: string | null
  notes: string | null
  created_at: string
  clients: { company_name: string } | null
  assignee: { full_name: string } | null
  contract_items: ContractItem[]
}

interface ItemDraft {
  tempId: string
  product_name: string
  price_per_kg: string
  schedule: Record<string, string> // YYYY-MM -> kg string
}

interface FormState {
  contract_number: string
  title: string
  client_id: string
  start_month: string  // YYYY-MM
  end_month: string    // YYYY-MM
  status: string
  assigned_to: string
  notes: string
  items: ItemDraft[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthRange(start: string, end: string): string[] {
  if (!start) return []
  const e = end || start
  const months: string[] = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = e.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return months
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

function itemTotal(item: ItemDraft, months: string[]): number {
  return months.reduce((s, m) => s + (parseFloat(item.schedule[m] || '0') || 0), 0)
}

function monthTotal(items: ItemDraft[], m: string): number {
  return items.reduce((s, i) => s + (parseFloat(i.schedule[m] || '0') || 0), 0)
}

function grandTotal(items: ItemDraft[], months: string[]): number {
  return months.reduce((s, m) => s + monthTotal(items, m), 0)
}

const today = new Date()
const DEFAULT_START = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const DEFAULT_END_DATE = new Date(today.getFullYear(), today.getMonth() + 5, 1)
const DEFAULT_END = `${DEFAULT_END_DATE.getFullYear()}-${String(DEFAULT_END_DATE.getMonth() + 1).padStart(2, '0')}`

const EMPTY_FORM: FormState = {
  contract_number: '', title: '', client_id: '',
  start_month: DEFAULT_START, end_month: DEFAULT_END,
  status: 'draft', assigned_to: '', notes: '', items: [],
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  active:    'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  expired:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function newItem(): ItemDraft {
  return { tempId: crypto.randomUUID(), product_name: '', price_per_kg: '', schedule: {} }
}

// ─── Contract Form ─────────────────────────────────────────────────────────────

function ContractForm({
  initial, clients, assignableUsers, onSave, onCancel, showPrice,
}: {
  initial: FormState
  clients: Client[]
  assignableUsers: AssignableUser[]
  onSave: (f: FormState) => Promise<void>
  onCancel: () => void
  showPrice: boolean
}) {
  const [form, setForm] = useState<FormState>({ ...initial, items: initial.items.length ? initial.items : [newItem()] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof Omit<FormState, 'items'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const months = monthRange(form.start_month, form.end_month)

  const updateItem = (tempId: string, field: keyof Omit<ItemDraft, 'tempId' | 'schedule'>, value: string) =>
    setForm(f => ({ ...f, items: f.items.map(i => i.tempId === tempId ? { ...i, [field]: value } : i) }))

  const updateSchedule = (tempId: string, month: string, value: string) =>
    setForm(f => ({ ...f, items: f.items.map(i => i.tempId === tempId ? { ...i, schedule: { ...i.schedule, [month]: value } } : i) }))

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, newItem()] }))
  const removeItem = (tempId: string) => setForm(f => ({ ...f, items: f.items.filter(i => i.tempId !== tempId) }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.contract_number.trim()) return setError('Contract number is required.')
    if (!form.client_id) return setError('Client is required.')
    if (!form.start_month) return setError('Start month is required.')
    if (form.items.length === 0 || !form.items.some(i => i.product_name.trim())) return setError('Add at least one product line.')
    setError('')
    setSaving(true)
    try { await onSave(form) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to save.') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-gray-50 border-b border-gray-200">
      {/* Header fields */}
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
        <div className="col-span-2 space-y-1">
          <Label>Title</Label>
          <Input value={form.title} onChange={set('title')} placeholder="e.g. Brazil for Yardstick — New Contract Revision" />
        </div>
        <div className="space-y-1">
          <Label>Client</Label>
          <select value={form.client_id} onChange={set('client_id')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Assigned To</Label>
          <select value={form.assigned_to} onChange={set('assigned_to')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Unassigned</option>
            {assignableUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Start Month</Label>
          <Input type="month" value={form.start_month} onChange={set('start_month')} />
        </div>
        <div className="space-y-1">
          <Label>End Month</Label>
          <Input type="month" value={form.end_month} onChange={set('end_month')} />
        </div>
        <div className="col-span-2 space-y-1">
          <Label>Notes</Label>
          <textarea value={form.notes} onChange={set('notes')} rows={2}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none" />
        </div>
      </div>

      {/* Product lines */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Product Lines</p>
          <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={addItem}>+ Add Product</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="text-sm min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-500 min-w-[200px]">Product</th>
                {showPrice && <th className="text-right px-3 py-2 font-medium text-gray-500 min-w-[90px]">₱/kg</th>}
                {months.map(m => (
                  <th key={m} className="text-right px-3 py-2 font-medium text-gray-500 min-w-[80px]">{monthLabel(m)}</th>
                ))}
                <th className="text-right px-3 py-2 font-medium text-gray-500 min-w-[90px]">Total kg</th>
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {form.items.map(item => {
                const total = itemTotal(item, months)
                return (
                  <tr key={item.tempId} className="border-b border-gray-100">
                    <td className="px-2 py-1.5">
                      <Input
                        value={item.product_name}
                        onChange={e => updateItem(item.tempId, 'product_name', e.target.value)}
                        placeholder="e.g. Fazenda IP (Yellow Bourbon)"
                        className="h-8 text-xs"
                      />
                    </td>
                    {showPrice && (
                      <td className="px-2 py-1.5">
                        <Input
                          type="number" step="0.01" min="0"
                          value={item.price_per_kg}
                          onChange={e => updateItem(item.tempId, 'price_per_kg', e.target.value)}
                          placeholder="0"
                          className="h-8 text-xs text-right"
                        />
                      </td>
                    )}
                    {months.map(m => (
                      <td key={m} className="px-2 py-1.5">
                        <Input
                          type="number" min="0" step="1"
                          value={item.schedule[m] || ''}
                          onChange={e => updateSchedule(item.tempId, m, e.target.value)}
                          placeholder="—"
                          className="h-8 text-xs text-right"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-medium text-gray-900">
                      {total > 0 ? total.toLocaleString() : '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => removeItem(item.tempId)}
                        className="text-gray-300 hover:text-red-400 text-sm leading-none">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {months.length > 0 && form.items.length > 1 && (
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-3 py-2 text-xs text-gray-400">Total</td>
                  {showPrice && <td />}
                  {months.map(m => {
                    const t = monthTotal(form.items, m)
                    return <td key={m} className="px-3 py-2 text-right text-xs font-medium text-gray-600">{t > 0 ? t.toLocaleString() : '—'}</td>
                  })}
                  <td className="px-3 py-2 text-right text-xs font-semibold text-gray-800">
                    {grandTotal(form.items, months).toLocaleString()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
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

// ─── Contract expanded detail ──────────────────────────────────────────────────

function ContractDetail({ contract, showPrice }: { contract: ContractRow; showPrice: boolean }) {
  const items = contract.contract_items ?? []
  if (items.length === 0) return (
    <div className="px-6 py-4 text-sm text-gray-400 bg-gray-50 border-b border-gray-200">
      No product lines yet.
    </div>
  )

  // Collect all months across items
  const monthSet = new Set<string>()
  items.forEach(i => Object.keys(i.monthly_schedule ?? {}).forEach(m => monthSet.add(m)))
  const months = [...monthSet].sort()

  return (
    <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="text-sm min-w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-500">Product</th>
              {showPrice && <th className="text-right px-3 py-2 font-medium text-gray-500">₱/kg</th>}
              {months.map(m => (
                <th key={m} className="text-right px-3 py-2 font-medium text-gray-500 text-xs">{monthLabel(m)}</th>
              ))}
              <th className="text-right px-3 py-2 font-medium text-gray-500">Total kg</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const total = months.reduce((s, m) => s + (item.monthly_schedule?.[m] ?? 0), 0)
              const totalValue = total * parseFloat(item.price_per_kg)
              return (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{item.product_name}</td>
                  {showPrice && <td className="px-3 py-2 text-right text-gray-600">₱{parseFloat(item.price_per_kg).toLocaleString()}</td>}
                  {months.map(m => {
                    const kg = item.monthly_schedule?.[m] ?? 0
                    return <td key={m} className="px-3 py-2 text-right text-gray-700">{kg > 0 ? kg.toLocaleString() : <span className="text-gray-300">—</span>}</td>
                  })}
                  <td className="px-3 py-2 text-right">
                    <p className="font-semibold text-gray-900">{total.toLocaleString()} kg</p>
                    {showPrice && <p className="text-xs text-gray-400">₱{Math.round(totalValue).toLocaleString()}</p>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {items.length > 1 && months.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td className="px-3 py-2 text-xs text-gray-400 font-medium">Total</td>
                {showPrice && <td />}
                {months.map(m => {
                  const t = items.reduce((s, i) => s + (i.monthly_schedule?.[m] ?? 0), 0)
                  return <td key={m} className="px-3 py-2 text-right text-xs font-medium text-gray-700">{t > 0 ? t.toLocaleString() : <span className="text-gray-300">—</span>}</td>
                })}
                <td className="px-3 py-2 text-right text-xs font-semibold text-gray-800">
                  {items.reduce((s, i) => s + months.reduce((ms, m) => ms + (i.monthly_schedule?.[m] ?? 0), 0), 0).toLocaleString()} kg
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
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
        .select('*, clients(company_name)')
        .order('created_at', { ascending: false })
      if (error) throw error

      const rows = (data ?? []) as Omit<ContractRow, 'contract_items' | 'assignee'>[]

      // Fetch contract items separately so a schema-cache miss on contract_items
      // doesn't wipe the entire contracts list
      const ids = rows.map(r => r.id)
      let itemsByContract: Record<string, ContractItem[]> = {}
      if (ids.length > 0) {
        const { data: items } = await supabase
          .from('contract_items')
          .select('*')
          .in('contract_id', ids)
        ;(items ?? []).forEach((ci: ContractItem) => {
          if (!itemsByContract[ci.contract_id]) itemsByContract[ci.contract_id] = []
          itemsByContract[ci.contract_id].push(ci)
        })
      }

      return rows.map(r => ({ ...r, assignee: null, contract_items: itemsByContract[r.id] ?? [] })) as ContractRow[]
    },
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, company_name').order('company_name')
      return (data ?? []) as Client[]
    },
  })

  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as AssignableUser[]
    },
  })

  const saveContract = async (id: string | null, form: FormState) => {
    const { data: { user } } = await supabase.auth.getUser()
    const startDate = form.start_month ? `${form.start_month}-01` : null
    const endDate = form.end_month ? `${form.end_month}-01` : null

    let contractId = id
    if (!id) {
      const { data, error } = await supabase.from('contracts').insert([{
        contract_number: form.contract_number.trim(),
        title: form.title.trim() || null,
        client_id: form.client_id,
        start_date: startDate,
        end_date: endDate,
        status: form.status,
        assigned_to: form.assigned_to || null,
        created_by: user?.id ?? null,
        notes: form.notes.trim() || null,
        lot_id: null,
        weight_contracted_kg: 0,
        price_per_kg: 0,
      }]).select()
      if (error) {
        if (error.code === '23505') throw new Error(`Contract number "${form.contract_number.trim()}" already exists. Use a different number.`)
        throw new Error(error.message)
      }
      contractId = data[0].id
    } else {
      const { error } = await supabase.from('contracts').update({
        contract_number: form.contract_number.trim(),
        title: form.title.trim() || null,
        client_id: form.client_id,
        start_date: startDate,
        end_date: endDate,
        status: form.status,
        assigned_to: form.assigned_to || null,
        notes: form.notes.trim() || null,
      }).eq('id', id)
      if (error) throw new Error(error.message)
      // Delete old items and re-insert
      await supabase.from('contract_items').delete().eq('contract_id', id)
    }

    // Insert contract items
    const itemsToInsert = form.items
      .filter(i => i.product_name.trim())
      .map(i => {
        const schedule: Record<string, number> = {}
        for (const [month, kg] of Object.entries(i.schedule)) {
          const v = parseFloat(kg)
          if (v > 0) schedule[month] = v
        }
        return {
          contract_id: contractId,
          product_name: i.product_name.trim(),
          price_per_kg: parseFloat(i.price_per_kg) || 0,
          monthly_schedule: schedule,
        }
      })

    if (itemsToInsert.length > 0) {
      const { error } = await supabase.from('contract_items').insert(itemsToInsert)
      if (error) throw new Error(error.message)
    }

    await queryClient.invalidateQueries({ queryKey: ['contracts'] })
    await queryClient.invalidateQueries({ queryKey: ['contract-items-active'] })
    setCreating(false)
    setEditingId(null)
  }

  const contractToForm = (c: ContractRow): FormState => {
    const startMonth = c.start_date ? c.start_date.slice(0, 7) : DEFAULT_START
    const endMonth = c.end_date ? c.end_date.slice(0, 7) : DEFAULT_END

    const items: ItemDraft[] = (c.contract_items ?? []).map(ci => {
      const schedule: Record<string, string> = {}
      for (const [m, kg] of Object.entries(ci.monthly_schedule ?? {})) {
        schedule[m] = String(kg)
      }
      return { tempId: crypto.randomUUID(), product_name: ci.product_name, price_per_kg: String(ci.price_per_kg), schedule }
    })

    return {
      contract_number: c.contract_number,
      title: c.title ?? '',
      client_id: c.client_id,
      start_month: startMonth,
      end_month: endMonth,
      status: c.status,
      assigned_to: c.assigned_to ?? '',
      notes: c.notes ?? '',
      items: items.length ? items : [newItem()],
    }
  }

  const canCreate = canCreateContracts(profile)
  const showPrice = canSeeFinancials(profile)
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
            assignableUsers={assignableUsers}
            showPrice={showPrice}
            onSave={f => saveContract(null, f)}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contract #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Title / Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Products</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Period</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Assigned</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && contracts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No contracts yet. {canCreate && 'Click "+ New Contract" to create one.'}
                  </td>
                </tr>
              )}
              {contracts.map(c => {
                const isExpanded = expandedId === c.id
                const isEditing = editingId === c.id
                const items = c.contract_items ?? []
                const totalKg = items.reduce((s, i) =>
                  s + Object.values(i.monthly_schedule ?? {}).reduce((ms, kg) => ms + kg, 0), 0)
                const startMonth = c.start_date ? c.start_date.slice(0, 7) : null
                const endMonth = c.end_date ? c.end_date.slice(0, 7) : null

                return (
                  <Fragment key={c.id}>
                    <tr
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => !isEditing && setExpandedId(isExpanded ? null : c.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 font-medium">{c.contract_number}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{c.title ?? c.clients?.company_name ?? '—'}</p>
                        {c.title && <p className="text-xs text-gray-400">{c.clients?.company_name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {items.length === 0
                          ? <span className="text-gray-300 text-xs">No products</span>
                          : (
                            <div>
                              <p className="text-gray-700">{items.map(i => i.product_name).join(', ')}</p>
                              {totalKg > 0 && <p className="text-xs text-gray-400">{totalKg.toLocaleString()} kg total</p>}
                            </div>
                          )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {startMonth ? monthLabel(startMonth) : '—'}
                        {endMonth ? ` → ${monthLabel(endMonth)}` : ''}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{assignableUsers.find(u => u.id === c.assigned_to)?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {canEdit(c) && (
                          <Button variant="ghost" size="sm" className="text-xs"
                            onClick={() => { setEditingId(isEditing ? null : c.id); setCreating(false) }}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr key={`${c.id}-edit`}>
                        <td colSpan={7} className="p-0">
                          <ContractForm
                            initial={contractToForm(c)}
                            clients={clients}
                            assignableUsers={assignableUsers}
                            showPrice={showPrice}
                            onSave={f => saveContract(c.id, f)}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                    {isExpanded && !isEditing && (
                      <tr key={`${c.id}-detail`}>
                        <td colSpan={7} className="p-0">
                          <ContractDetail contract={c} showPrice={showPrice} />
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
