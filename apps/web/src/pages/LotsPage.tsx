import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'

interface Lot {
  id: string
  name: string
  origin: string
  region: string | null
  producer: string | null
  grade: string | null
  varietal: string | null
  process: string | null
  created_at: string
}

export default function LotsPage() {
  const { data: lots = [], isLoading } = useQuery<Lot[]>({
    queryKey: ['lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lots')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Product Names</h1>
          <p className="text-sm text-gray-500 mt-0.5">Product names are generated when you receive stock.</p>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Product Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Origin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Region</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Grade</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && lots.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                    No lots yet — receive stock to create your first coffee lot.
                  </td>
                </tr>
              )}
              {lots.map(lot => (
                <tr key={lot.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{lot.name}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.origin}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.region ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.producer ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.grade ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
