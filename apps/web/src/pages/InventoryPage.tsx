import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import PhysicalCountTab from '@/components/PhysicalCountTab'
import { isFixedWeightSku, skuUnit } from '@/lib/sku'

interface ContractRef {
  product_name: string
  contracts: { contract_number: string; title: string | null } | null
}

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  sacks: number | null
  sack_weight_kg: string | null
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
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
  const [editSackWeight, setEditSackWeight] = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lot_id, location, received_at, contract_item_id, lots(name), locations(name), contract_items(product_name, contracts(contract_number, title))')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as Batch[]
    },
  })

  const startEdit = (batch: Batch) => {
    setEditingId(batch.id)
    setEditSacks(String(batch.sacks ?? ''))
    setEditSackWeight(batch.sack_weight_kg ?? '')
    setEditWeight(batch.weight_kg)
    setEditDate(batch.received_at.slice(0, 10))
  }

  const saveEdit = async (id: string) => {
    setEditSaving(true)
    await supabase.from('batches').update({
      sacks:          parseInt(editSacks) || null,
      sack_weight_kg: parseFloat(editSackWeight) || null,
      weight_kg:      parseFloat(editWeight),
      received_at:    editDate,
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

  const contractCount  = batches.filter(b =>  b.contract_item_id).length
  const availableCount = batches.filter(b => !b.contract_item_id).length
  const bagtikanCount  = batches.filter(b => locationName(b).includes('bagtikan')).length
  const pacoCount      = batches.filter(b => locationName(b).includes('paco')).length
  const totalKg        = batches.reduce((s, b) => s + parseFloat(b.weight_kg), 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        {!isLoading && (
          <p className="text-sm text-gray-400 mt-0.5">
            {batches.length} batches · {Math.round(totalKg).toLocaleString()} kg total
          </p>
        )}
      </div>

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
          <div className="flex items-center gap-6 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 mr-1">Status</span>
              <Pill active={filter === 'all'}       onClick={() => setFilter('all')}>All ({batches.length})</Pill>
              <Pill active={filter === 'available'} onClick={() => setFilter('available')}>Available ({availableCount})</Pill>
              <Pill active={filter === 'contract'}  onClick={() => setFilter('contract')}>Contract ({contractCount})</Pill>
            </div>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 mr-1">Location</span>
              <Pill active={locationFilter === 'all'}      onClick={() => setLocationFilter('all')}>All</Pill>
              <Pill active={locationFilter === 'bagtikan'} onClick={() => setLocationFilter('bagtikan')}>Bagtikan ({bagtikanCount})</Pill>
              <Pill active={locationFilter === 'paco'}     onClick={() => setLocationFilter('paco')}>Paco ({pacoCount})</Pill>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Batch #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Location</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">On hand</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Weight</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Received</th>
                  <th className="w-16 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400 text-sm">Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-gray-400 text-sm">
                      {filter === 'all' ? 'No batches yet. Use Receiving to log incoming stock.' : `No ${filter} batches.`}
                    </td>
                  </tr>
                )}
                {filtered.map(batch => {
                  const contractRef = batch.contract_items
                  const isEditing   = editingId === batch.id
                  const locDisplay  = batch.locations?.name ?? batch.location ?? null
                  const fixed       = isFixedWeightSku(batch.sku_type)
                  const unit        = skuUnit(batch.sku_type)
                  const totalKgNum  = parseFloat(batch.weight_kg)
                  const perUnitKg   = batch.sack_weight_kg ? parseFloat(batch.sack_weight_kg) : null

                  return (
                    <tr
                      key={batch.id}
                      className={`border-b border-gray-100 group transition-colors ${
                        isEditing ? 'bg-blue-50/60' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      {/* Batch # */}
                      <td className="px-4 py-4 font-mono text-xs text-gray-400 align-top">
                        {batch.batch_number}
                      </td>

                      {/* Product */}
                      <td className="px-4 py-4 align-top">
                        <p className="font-semibold text-gray-900 leading-snug">{batch.lots?.name ?? '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          {fixed ? '1 kg bags' : 'Commercial'}
                        </p>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4 align-top">
                        {contractRef ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">Contract</span>
                            <p className="text-xs text-gray-400 mt-1">{contractRef.contracts?.contract_number}</p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">Available</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-4 py-4 align-top">
                        {locDisplay
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium">{locDisplay}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {isEditing ? (
                        <>
                          {/* Edit: on hand + kg/unit */}
                          <td className="px-4 py-3 align-middle" colSpan={2}>
                            <div className="flex flex-wrap gap-2 items-center justify-end">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number" value={editSacks}
                                  onChange={e => setEditSacks(e.target.value)}
                                  placeholder="0"
                                  className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-500">{unit}</span>
                              </div>
                              {!fixed && (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-gray-300">×</span>
                                  <input
                                    type="number" value={editSackWeight}
                                    onChange={e => setEditSackWeight(e.target.value)}
                                    placeholder="kg/unit"
                                    className="w-20 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <span className="text-xs text-gray-400">kg ea</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <input
                                  type="number" value={editWeight}
                                  onChange={e => setEditWeight(e.target.value)}
                                  placeholder="total kg"
                                  className="w-24 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-400">kg</span>
                              </div>
                            </div>
                          </td>

                          {/* Edit: date + actions */}
                          <td className="px-4 py-3 align-middle">
                            <div className="flex gap-2 items-center">
                              <input
                                type="date" value={editDate}
                                onChange={e => setEditDate(e.target.value)}
                                className="border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <button
                                onClick={() => saveEdit(batch.id)}
                                disabled={editSaving}
                                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                              >
                                {editSaving ? '…' : 'Save'}
                              </button>
                              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* On hand: count + per-unit weight */}
                          <td className="px-4 py-4 text-right align-top">
                            {batch.sacks != null ? (
                              <>
                                <p className="font-semibold text-gray-900 tabular-nums">{batch.sacks.toLocaleString()} {unit}</p>
                                {!fixed && perUnitKg != null && (
                                  <p className="text-xs text-gray-400 tabular-nums mt-0.5">{perUnitKg % 1 === 0 ? perUnitKg : perUnitKg.toFixed(1)} kg ea</p>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>

                          {/* Weight: total kg */}
                          <td className="px-4 py-4 text-right align-top">
                            <p className="font-semibold text-gray-900 tabular-nums">
                              {totalKgNum >= 1000
                                ? `${(totalKgNum / 1000).toFixed(1)} t`
                                : `${Math.round(totalKgNum).toLocaleString()} kg`}
                            </p>
                          </td>

                          {/* Received */}
                          <td className="px-4 py-4 text-xs text-gray-400 align-top">
                            {new Date(batch.received_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                        </>
                      )}

                      {/* Edit trigger */}
                      <td className="px-3 py-4 text-right align-top">
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(batch)}
                            className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded transition-all"
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
