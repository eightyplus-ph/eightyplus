import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  status: string
  location: string | null
  received_at: string
  lots: { name: string } | null
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info'

const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  qc_pending: { label: 'QC Pending', variant: 'warning' },
  available: { label: 'Available', variant: 'success' },
  reserved: { label: 'Reserved', variant: 'info' },
  dispatched: { label: 'Dispatched', variant: 'default' },
  quarantine: { label: 'Quarantine', variant: 'destructive' },
  closed: { label: 'Closed', variant: 'default' },
}

export default function InventoryPage() {
  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('*, lots(name)')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as Batch[]
    },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Inventory</h1>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Batch #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Lot</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Location</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Weight</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Received</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && batches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    No batches in inventory yet. Use Receiving to log incoming stock.
                  </td>
                </tr>
              )}
              {batches.map(batch => {
                const status = statusConfig[batch.status] ?? { label: batch.status, variant: 'default' as BadgeVariant }
                return (
                  <tr key={batch.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{batch.batch_number}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{batch.lots?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{batch.location ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{parseFloat(batch.weight_kg).toFixed(2)} kg</td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(batch.received_at).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
