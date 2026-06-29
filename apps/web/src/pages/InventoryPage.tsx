import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  const [tab, setTab] = useState<Tab>('stock')
  const [filter, setFilter] = useState<StockFilter>('all')

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, location, received_at, contract_item_id, lots(name), locations(name), contract_items(product_name, contracts(contract_number, title))')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as Batch[]
    },
  })

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
                  return (
                    <tr key={batch.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{batch.batch_number}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{batch.lots?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        {contractRef ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                              Contract
                            </span>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {contractRef.contracts?.contract_number} → {contractRef.product_name}
                            </p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                            Available
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{batch.locations?.name ?? batch.location ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{Math.round(parseFloat(batch.weight_kg))} kg</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(batch.received_at).toLocaleDateString()}</td>
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
