import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Location { id: string; name: string; type: string }
interface Batch { id: string; batch_number: string; weight_kg: string; sacks: number | null; location_id: string | null; lots: { name: string } | null }
interface Transfer {
  id: string
  transferred_at: string
  weight_kg: string
  sacks: number | null
  notes: string | null
  batches: { batch_number: string; lots: { name: string } | null } | null
  from_location: { name: string } | null
  to_location: { name: string } | null
}

export default function TransfersPage() {
  const queryClient = useQueryClient()

  const [batchId, setBatchId] = useState('')
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [sacks, setSacks] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('id, name, type').eq('is_active', true).order('name')
      if (error) throw error
      return data as Location[]
    },
  })

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['batches-transfer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, location_id, lots(name)')
        .order('received_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Batch[]
    },
  })

  const { data: transfers = [], isLoading } = useQuery<Transfer[]>({
    queryKey: ['transfers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transfers')
        .select('*, batches(batch_number, lots(name)), from_location:from_location_id(name), to_location:to_location_id(name)')
        .order('transferred_at', { ascending: false })
      if (error) throw error
      return data as Transfer[]
    },
  })

  // When batch is selected, auto-set from location
  const handleBatchChange = (id: string) => {
    setBatchId(id)
    const batch = batches.find(b => b.id === id)
    if (batch?.location_id) setFromId(batch.location_id)
    else setFromId('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!batchId) { setError('Select a batch.'); return }
    if (!fromId) { setError('Select a from location.'); return }
    if (!toId) { setError('Select a to location.'); return }
    if (fromId === toId) { setError('From and To locations must be different.'); return }
    if (!weightKg || parseFloat(weightKg) <= 0) { setError('Weight must be greater than 0.'); return }

    setLoading(true)

    const { error: tErr } = await supabase.from('transfers').insert([{
      batch_id: batchId,
      from_location_id: fromId,
      to_location_id: toId,
      weight_kg: parseFloat(weightKg),
      sacks: sacks ? parseInt(sacks) : null,
      notes: notes.trim() || null,
    }])
    if (tErr) { setError(tErr.message); setLoading(false); return }

    // Update batch current location
    await supabase.from('batches').update({ location_id: toId }).eq('id', batchId)

    await queryClient.invalidateQueries({ queryKey: ['transfers'] })
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['batches-transfer'] })

    setBatchId(''); setFromId(''); setToId(''); setWeightKg(''); setSacks(''); setNotes('')
    setLoading(false)
  }

  const selectedBatch = batches.find(b => b.id === batchId)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Transfers</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Transfer form */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-base">New Transfer</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Batch *</Label>
                  <select
                    value={batchId}
                    onChange={e => handleBatchChange(e.target.value)}
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <option value="">Select batch…</option>
                    {batches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.batch_number} — {b.lots?.name ?? 'Unknown'}
                      </option>
                    ))}
                  </select>
                  {selectedBatch && (
                    <p className="text-xs text-gray-400">
                      {Math.round(parseFloat(selectedBatch.weight_kg))} kg · {selectedBatch.sacks ?? '?'} sacks
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>From *</Label>
                  <select
                    value={fromId}
                    onChange={e => setFromId(e.target.value)}
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <option value="">Select location…</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>To *</Label>
                  <select
                    value={toId}
                    onChange={e => setToId(e.target.value)}
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <option value="">Select location…</option>
                    {locations.filter(l => l.id !== fromId).map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Weight (kg) *</Label>
                    <Input type="number" step="0.01" min="0" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="60.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sacks</Label>
                    <Input type="number" min="1" value={sacks} onChange={e => setSacks(e.target.value)} placeholder="2" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. BGS Pop-up Jan 2026" />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Logging…' : 'Log Transfer'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Transfer history */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Transfer History</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Batch</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">From</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">To</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                  )}
                  {!isLoading && transfers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No transfers yet.</td></tr>
                  )}
                  {transfers.map(t => (
                    <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 text-xs">{new Date(t.transferred_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 text-xs">{t.batches?.batch_number}</p>
                        <p className="text-gray-400 text-xs">{t.batches?.lots?.name}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{t.from_location?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{t.to_location?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{Math.round(parseFloat(t.weight_kg))} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
