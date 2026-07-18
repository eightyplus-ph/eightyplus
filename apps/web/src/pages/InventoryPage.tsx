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

interface ProductGroup {
  lotId: string
  name: string
  batches: Batch[]
}

type Tab = 'stock' | 'physical-count'
type StockFilter = 'all' | 'available' | 'contract'

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

function fmtKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${Math.round(kg).toLocaleString()} kg`
}

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('stock')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all') // 'all' or a location name
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
        .gt('weight_kg', 0)
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

  const filteredBatches = batches.filter(b => {
    if (filter === 'available' && b.contract_item_id) return false
    if (filter === 'contract' && !b.contract_item_id) return false
    if (locationFilter !== 'all' && locationName(b) !== locationFilter.toLowerCase()) return false
    return true
  })

  // Group by lot
  const groups: ProductGroup[] = []
  const seen = new Map<string, ProductGroup>()
  for (const b of filteredBatches) {
    const key = b.lot_id ?? b.id
    if (!seen.has(key)) {
      const g: ProductGroup = { lotId: key, name: b.lots?.name ?? '—', batches: [] }
      seen.set(key, g)
      groups.push(g)
    }
    seen.get(key)!.batches.push(b)
  }

  const contractCount  = batches.filter(b =>  b.contract_item_id).length
  const availableCount = batches.filter(b => !b.contract_item_id).length
  const totalKg        = batches.reduce((s, b) => s + parseFloat(b.weight_kg), 0)

  // Distinct locations present in the batch data, with counts — drives the filter pills
  const locationOptions = (() => {
    const counts = new Map<string, number>()
    for (const b of batches) {
      const name = b.locations?.name ?? b.location
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })()

  const toggleProduct = (lotId: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(lotId) ? n.delete(lotId) : n.add(lotId); return n })

  const allExpanded = groups.length > 0 && groups.every(g => expanded.has(g.lotId))

  const toggleAll = () => {
    if (allExpanded) setExpanded(new Set())
    else setExpanded(new Set(groups.map(g => g.lotId)))
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        {!isLoading && (
          <p className="text-sm text-gray-400 mt-0.5">
            {groups.length} products · {batches.length} batches · {fmtKg(totalKg)} total
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
          {/* Filters */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Status</span>
                <Pill active={filter === 'all'}       onClick={() => setFilter('all')}>All ({batches.length})</Pill>
                <Pill active={filter === 'available'} onClick={() => setFilter('available')}>Available ({availableCount})</Pill>
                <Pill active={filter === 'contract'}  onClick={() => setFilter('contract')}>Contract ({contractCount})</Pill>
              </div>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Location</span>
                <Pill active={locationFilter === 'all'} onClick={() => setLocationFilter('all')}>All</Pill>
                {locationOptions.map(({ name, count }) => (
                  <Pill key={name} active={locationFilter === name} onClick={() => setLocationFilter(name)}>{name} ({count})</Pill>
                ))}
              </div>
            </div>
            {groups.length > 0 && (
              <button onClick={toggleAll} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {isLoading && (
              <div className="px-4 py-16 text-center text-sm text-gray-400">Loading…</div>
            )}
            {!isLoading && groups.length === 0 && (
              <div className="px-4 py-16 text-center text-sm text-gray-400">
                {filter === 'all' ? 'No batches yet. Use Receiving to log incoming stock.' : `No ${filter} batches.`}
              </div>
            )}

            {groups.map(({ lotId, name, batches: groupBatches }) => {
              const isOpen = expanded.has(lotId)
              const groupTotalKg = groupBatches.reduce((s, b) => s + parseFloat(b.weight_kg), 0)
              const allAvailable = groupBatches.every(b => !b.contract_item_id)
              const allContract  = groupBatches.every(b =>  b.contract_item_id)
              const locations    = [...new Set(groupBatches.map(b => b.locations?.name ?? b.location).filter(Boolean))]
              const skuTypes     = [...new Set(groupBatches.map(b => b.sku_type))]

              return (
                <div key={lotId}>
                  {/* Product header row */}
                  <button
                    onClick={() => toggleProduct(lotId)}
                    className="w-full text-left px-4 py-4 hover:bg-gray-50/80 transition-colors flex items-center gap-4"
                  >
                    {/* Chevron */}
                    <span className={`text-gray-400 text-xs transition-transform duration-150 w-3 shrink-0 ${isOpen ? 'rotate-90' : ''}`}>
                      ▶
                    </span>

                    {/* Product name + meta */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 leading-snug">{name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {locations.map(loc => (
                          <span key={loc} className="text-xs text-gray-400">{loc}</span>
                        ))}
                        {locations.length > 0 && skuTypes.length > 0 && <span className="text-gray-200 text-xs">·</span>}
                        {skuTypes.map(sku => (
                          <span key={sku} className="text-xs text-gray-400">{sku === 'retail_1kg' ? '1 kg bags' : 'Commercial'}</span>
                        ))}
                      </div>
                    </div>

                    {/* Status summary */}
                    <div className="shrink-0">
                      {allAvailable
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">Available</span>
                        : allContract
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">Contract</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200 text-xs font-medium">Mixed</span>}
                    </div>

                    {/* Batch count */}
                    <div className="shrink-0 text-right w-16">
                      <p className="text-xs text-gray-400 tabular-nums">{groupBatches.length} batch{groupBatches.length !== 1 ? 'es' : ''}</p>
                    </div>

                    {/* Total weight */}
                    <div className="shrink-0 text-right w-24">
                      <p className="font-semibold text-gray-900 tabular-nums">{fmtKg(groupTotalKg)}</p>
                    </div>
                  </button>

                  {/* Expanded batch rows */}
                  {isOpen && (
                    <div className="border-t border-gray-100 bg-gray-50/40">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="w-8" />
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Batch #</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Location</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Type</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Status</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">On hand</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-400">Weight</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-400">Received</th>
                            <th className="w-16" />
                          </tr>
                        </thead>
                        <tbody>
                          {[...groupBatches].sort((a, b) => (a.sku_type === 'retail_1kg' ? -1 : 1) - (b.sku_type === 'retail_1kg' ? -1 : 1)).map(batch => {
                            const isEditing  = editingId === batch.id
                            const fixed      = isFixedWeightSku(batch.sku_type)
                            const unit       = skuUnit(batch.sku_type)
                            const perUnitKg  = batch.sack_weight_kg ? parseFloat(batch.sack_weight_kg) : null
                            const locDisplay = batch.locations?.name ?? batch.location ?? '—'

                            return (
                              <tr key={batch.id} className={`border-b border-gray-100 last:border-0 group ${isEditing ? 'bg-blue-50' : 'hover:bg-white/80'}`}>
                                <td className="w-8 pl-9" />
                                <td className="px-4 py-3 font-mono text-xs text-gray-400">{batch.batch_number}</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-gray-200 text-xs text-gray-600 font-medium">{locDisplay}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`text-xs font-medium ${fixed ? 'text-purple-600' : 'text-gray-500'}`}>
                                    {fixed ? '1 kg bags' : 'Commercial'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  {batch.contract_items ? (
                                    <div>
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">Contract</span>
                                      <p className="text-xs text-gray-400 mt-0.5">{batch.contract_items.contracts?.contract_number}</p>
                                    </div>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">Available</span>
                                  )}
                                </td>

                                {isEditing ? (
                                  <>
                                    <td className="px-4 py-2" colSpan={2}>
                                      <div className="flex flex-wrap gap-2 items-center justify-end">
                                        <div className="flex items-center gap-1">
                                          <input type="number" value={editSacks} onChange={e => setEditSacks(e.target.value)} placeholder="0" className="w-14 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                          <span className="text-xs text-gray-500">{unit}</span>
                                        </div>
                                        {!fixed && (
                                          <div className="flex items-center gap-1">
                                            <span className="text-xs text-gray-300">×</span>
                                            <input type="number" value={editSackWeight} onChange={e => setEditSackWeight(e.target.value)} placeholder="kg ea" className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                            <span className="text-xs text-gray-400">kg ea</span>
                                          </div>
                                        )}
                                        <div className="flex items-center gap-1">
                                          <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)} placeholder="total kg" className="w-20 border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                          <span className="text-xs text-gray-400">kg</span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex gap-2 items-center">
                                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        <button onClick={() => saveEdit(batch.id)} disabled={editSaving} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">{editSaving ? '…' : 'Save'}</button>
                                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-4 py-3 text-right">
                                      {batch.sacks != null ? (
                                        <>
                                          <p className="font-medium text-gray-900 tabular-nums">{batch.sacks.toLocaleString()} {unit}</p>
                                          {!fixed && perUnitKg != null && (
                                            <p className="text-xs text-gray-400 tabular-nums mt-0.5">{Number.isInteger(perUnitKg) ? perUnitKg : perUnitKg.toFixed(1)} kg ea</p>
                                          )}
                                        </>
                                      ) : (
                                        <span className="text-gray-300 text-xs">—</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <p className="font-medium text-gray-900 tabular-nums">{fmtKg(parseFloat(batch.weight_kg))}</p>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-400">
                                      {new Date(batch.received_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </td>
                                  </>
                                )}

                                <td className="px-3 py-3 text-right">
                                  {!isEditing && (
                                    <button onClick={() => startEdit(batch)} className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded transition-all">
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
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {tab === 'physical-count' && <PhysicalCountTab />}
    </div>
  )
}
