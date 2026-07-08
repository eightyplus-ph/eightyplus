import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import PhysicalCountTab from '@/components/PhysicalCountTab'
import { skuUnit } from '@/lib/sku'

interface ContractRef {
  product_name: string
  contracts: { contract_number: string; title: string | null } | null
}

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  sacks: number | null
  sku_type: string | null
  lot_id: string | null
  location: string | null
  received_at: string
  contract_item_id: string | null
  lots: { name: string } | null
  locations: { name: string } | null
  contract_items: ContractRef | null
}

type Tab = 'stock' | 'physical-count'
type StockFilter = 'all' | 'available' | 'contract'
type LocationFilter = 'all' | 'bagtikan' | 'paco'

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
        active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('stock')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSacks, setEditSacks] = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, sku_type, lot_id, location, received_at, contract_item_id, lots(name), locations(name), contract_items(product_name, contracts(contract_number, title))')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as Batch[]
    },
  })

  const startEdit = (batch: Batch) => {
    setEditingId(batch.id)
    setEditSacks(String(batch.sacks ?? ''))
    setEditWeight(batch.weight_kg)
    setEditDate(batch.received_at.slice(0, 10))
  }

  const saveEdit = async (id: string) => {
    setEditSaving(true)
    await supabase.from('batches').update({
      sacks: parseInt(editSacks),
      weight_kg: parseFloat(editWeight),
      received_at: editDate,
    }).eq('id', id)
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    setEditingId(null)
    setEditSaving(false)
  }

  const locationName = (b: Batch) => (b.locations?.name ?? b.location ?? '').toLowerCase()

  const filtered = batches.filter(b => {
    if (filter === 'available' && b.contract_item_id) return false
    if (filter === 'contract' && !b.contract_item_id) return false
    if (locationFilter === 'bagtikan' && !locationName(b).includes('bagtikan')) return false
    if (locationFilter === 'paco' && !locationName(b).includes('paco')) return false
    return true
  })

  const contractCount = batches.filter(b => b.contract_item_id).length
  const availableCount = batches.filter(b => !b.contract_item_id).length
  const bagtikanCount = batches.filter(b => locationName(b).includes('bagtikan')).length
  const pacoCount = batches.filter(b => locationName(b).includes('paco')).length
  const totalKg = batches.reduce((s, b) => s + parseFloat(b.weight_kg), 0)

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        {!isLoading && (
          <p className="text-sm text-gray-400 mt-0.5">
            {batches.length} batches · {Math.round(totalKg).toLocaleString()} kg total
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['stock', 'physical-count'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'stock' ? 'Stock' : 'Physical Count'}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <Card>
          {/* Filters */}
          <div className="flex items-center gap-6 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 mr-1">Status</span>
              <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All ({batches.length})</Pill>
              <Pill active={filter === 'available'} onClick={() => setFilter('available')}>Available ({availableCount})</Pill>
              <Pill active={filter === 'contract'} onClick={() => setFilter('contract')}>Contract ({contractCount})</Pill>
            </div>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 mr-1">Location</span>
              <Pill active={locationFilter === 'all'} onClick={() => setLocationFilter('all')}>All</Pill>
              <Pill active={locationFilter === 'bagtikan'} onClick={() => setLocationFilter('bagtikan')}>Bagtikan ({bagtikanCount})</Pill>
              <Pill active={locationFilter === 'paco'} onClick={() => setLocationFilter('paco')}>Paco ({pacoCount})</Pill>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch #</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Weight</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Received</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                      {filter === 'all' ? 'No batches yet. Use Receiving to log incoming stock.' : `No ${filter} batches.`}
                    </td>
                  </tr>
                )}
                {filtered.map(batch => {
                  const contractRef = batch.contract_items
                  const isEditing = editingId === batch.id
                  const locDisplay = batch.locations?.name ?? batch.location ?? null
                  return (
                    <tr key={batch.id} className={`border-b border-gray-100 group ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50/70'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{batch.batch_number}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{batch.lots?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        {contractRef ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">Contract</span>
                            <p className="text-xs text-gray-400 mt-0.5">{contractRef.contracts?.contract_number}</p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">Available</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {locDisplay
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium">{locDisplay}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {isEditing ? (
                        <>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1.5 items-center justify-end">
                              <input type="number" value={editSacks} onChange={e => setEditSacks(e.target.value)} className="w-14 border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="sacks" />
                              <span className="text-gray-400 text-xs">sk</span>
                              <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)} className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="kg" />
                              <span className="text-gray-400 text-xs">kg</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-2 items-center">
                              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                              <button onClick={() => saveEdit(batch.id)} disabled={editSaving} className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50 font-medium">{editSaving ? '…' : 'Save'}</button>
                              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-gray-900 tabular-nums">{Math.round(parseFloat(batch.weight_kg)).toLocaleString()} kg</span>
                            {batch.sacks ? <span className="text-gray-400 text-xs ml-1.5">{batch.sacks} {skuUnit(batch.sku_type)}</span> : null}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {new Date(batch.received_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-3 text-right">
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(batch)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 text-xs px-1.5 py-0.5 rounded transition-all"
                            title="Edit"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'physical-count' && <PhysicalCountTab />}
    </div>
  )
}
