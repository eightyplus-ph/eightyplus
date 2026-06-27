import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'

interface StatCardProps {
  label: string
  value: string | number
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-3xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { data: stockData } = useQuery({
    queryKey: ['dashboard', 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('weight_kg')
        .in('status', ['available', 'reserved'])
      if (error) return null
      const total = (data ?? []).reduce((sum, b) => sum + parseFloat(b.weight_kg ?? '0'), 0)
      return total
    },
  })

  const { data: qcCount } = useQuery({
    queryKey: ['dashboard', 'qc'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('batches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'qc_pending')
      if (error) return null
      return count
    },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="On-Hand Stock"
          value={stockData != null ? `${stockData.toFixed(2)} kg` : '—'}
        />
        <StatCard
          label="Batches in QC"
          value={qcCount != null ? qcCount : '—'}
        />
        <StatCard
          label="Open Orders"
          value="—"
        />
      </div>
    </div>
  )
}
