import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Lot {
  id: string
  name: string
  origin: string
  varietal: string | null
  process: string | null
  grade: string | null
}

function AddLotDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [origin, setOrigin] = useState('')
  const [varietal, setVarietal] = useState('')
  const [process, setProcess] = useState('')
  const [grade, setGrade] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !origin) { setError('Name and origin are required.'); return }
    setLoading(true)
    const { error } = await supabase.from('lots').insert([{
      name, origin,
      varietal: varietal || null,
      process: process || null,
      grade: grade || null,
    }])
    if (error) { setError(error.message); setLoading(false); return }
    await queryClient.invalidateQueries({ queryKey: ['lots'] })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Add Coffee Lot</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kenya Kiambu AA" required />
            </div>
            <div className="space-y-1.5">
              <Label>Origin *</Label>
              <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Kenya" required />
            </div>
            <div className="space-y-1.5">
              <Label>Varietal</Label>
              <Input value={varietal} onChange={e => setVarietal(e.target.value)} placeholder="e.g. SL28" />
            </div>
            <div className="space-y-1.5">
              <Label>Process</Label>
              <Input value={process} onChange={e => setProcess(e.target.value)} placeholder="e.g. Washed" />
            </div>
            <div className="space-y-1.5">
              <Label>Grade</Label>
              <Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. AA" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Add Lot'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LotsPage() {
  const [showDialog, setShowDialog] = useState(false)

  const { data: lots = [], isLoading } = useQuery<Lot[]>({
    queryKey: ['lots'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lots').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Coffee Lots</h1>
        <Button onClick={() => setShowDialog(true)}>Add Lot</Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Origin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Varietal</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Process</th>
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
                    No coffee lots yet. Add your first lot to get started.
                  </td>
                </tr>
              )}
              {lots.map(lot => (
                <tr key={lot.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{lot.name}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.origin}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.varietal ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.process ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.grade ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showDialog && <AddLotDialog onClose={() => setShowDialog(false)} />}
    </div>
  )
}
