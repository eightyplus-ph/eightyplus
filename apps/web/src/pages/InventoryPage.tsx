import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import PhysicalCountTab from '@/components/PhysicalCountTab'

interface ContractRef {
  product_name: string
  contracts: { contract_number: string; title: string | null } | null
}

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  sacks: number | null
  location: string | null
  received_at: string
  contract_item_id: string | null
  lots: { name: string } | null
  locations: { name: string } | null
  contract_items: ContractRef | null
}

type Tab = 'stock' | 'physical-count'
type StockFilter = 'all' | 'available' | 'contract'

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('stock')
  const [filter, setFilter] = useState<StockFilter>('all')
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
        .select('id, batch_number, weight_kg, sacks, location, received_at, contract_item_id, lots(name), locations(name), contract_items(product_name, contracts(contract_number, title))')
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

  const filtered = batches.filter(b => {
    if (filter === 'available') return !b.contract_item_id
    if (filter === 'contract') return !!b.contract_item_id
    return true
  })

  const contractCount = batches.filter(b => b.contract_item_id).length
  const availableCount = batches.filter(b => !b.contract_item_id).length

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Inventory</h1>

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
          {/* Filter row */}
          <div className="px-4 py-3 border-b border-gray-100 flex gap-2">
            {([
              ['all', `All (${batches.length})`],
              ['available', `Available (${availableCount})`],
              ['contract', `Contract (${contractCount})`],
            ] as [StockFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Product</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Contract</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Location</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Weight</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Received</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      {filter === 'all' ? 'No batches in inventory yet. Use Receiving to log incoming stock.' : `No ${filter} batches.`}
                    </td>
                  </tr>
                )}
                {filtered.map(batch => {
                  const contractRef = batch.contract_items
                  const isEditing = editingId === batch.id
                  return (
                    <tr key={batch.id} className={`border-b border-gray-100 ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{batch.batch_number}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{batch.lots?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        {contractRef ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">Contract</span>
                            <p className="text-xs text-gray-500 mt-0.5">{contractRef.contracts?.contract_number} → {contractRef.product_name}</p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">Available</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{batch.locations?.name ?? batch.location ?? '—'}</td>
                      {isEditing ? (
                        <>
                          <td className="px-4 py-2">
                            <div className="flex gap-1.5 items-center">
                              <input type="number" value={editSacks} onChange={e => setEditSacks(e.target.value)} className="w-16 border border-gray-300 rounded px-2 py-1 text-xs" placeholder="sacks" />
                              <span className="text-gray-400 text-xs">sacks</span>
                              <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)} className="w-20 border border-gray-300 rounded px-2 py-1 text-xs" placeholder="kg" />
                              <span className="text-gray-400 text-xs">kg</span>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1.5 items-center">
                              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
                              <button onClick={() => saveEdit(batch.id)} disabled={editSaving} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50">{editSaving ? '…' : 'Save'}</button>
                              <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-1">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-right text-gray-900">
                            <span className="cursor-pointer hover:text-blue-600" onClick={() => startEdit(batch)} title="Click to edit">
                              {Math.round(parseFloat(batch.weight_kg))} kg
                              {batch.sacks ? <span className="text-gray-400 text-xs ml-1">· {batch.sacks} sacks</span> : null}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            <span className="cursor-pointer hover:text-blue-600" onClick={() => startEdit(batch)} title="Click to edit">
                              {new Date(batch.received_at).toLocaleDateString()}
                            </span>
                          </td>
                        </>
                      )}
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
