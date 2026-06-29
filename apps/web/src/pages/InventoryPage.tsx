import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import PhysicalCountTab from '@/components/PhysicalCountTab'

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  location: string | null
  received_at: string
  lots: { name: string } | null
  locations: { name: string } | null
}

type Tab = 'stock' | 'physical-count'

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, location, received_at, lots(name), locations(name)')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as Batch[]
    },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Inventory</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['stock', 'physical-count'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'stock' ? 'Stock' : 'Physical Count'}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Product Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Location</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Weight</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Received</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                )}
                {!isLoading && batches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      No batches in inventory yet. Use Receiving to log incoming stock.
                    </td>
                  </tr>
                )}
                {batches.map(batch => (
                  <tr key={batch.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{batch.batch_number}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{batch.lots?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{batch.locations?.name ?? batch.location ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{Math.round(parseFloat(batch.weight_kg))} kg</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(batch.received_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'physical-count' && <PhysicalCountTab />}
    </div>
  )
}
