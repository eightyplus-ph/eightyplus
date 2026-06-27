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
}

export default function ReceivingPage() {
  const queryClient = useQueryClient()

  const [lotId, setLotId] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [sacks, setSacks] = useState('')
  const [location, setLocation] = useState('')
  const [moisture, setMoisture] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastBatchNumber, setLastBatchNumber] = useState<string | null>(null)

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['lots-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lots').select('id, name, origin').order('name')
      if (error) throw error
      return data
    },
  })

  const weightPerSack =
    weightKg && sacks && parseInt(sacks) > 0
      ? (parseFloat(weightKg) / parseInt(sacks)).toFixed(2) + ' kg'
      : '—'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!lotId) { setError('Please select a coffee lot.'); return }
    if (!weightKg || parseFloat(weightKg) <= 0) { setError('Weight must be greater than 0.'); return }
    if (!sacks || parseInt(sacks) <= 0) { setError('Number of sacks must be greater than 0.'); return }
    if (!location.trim()) { setError('Location is required.'); return }

    setLoading(true)
    const batchNumber = `BATCH-${Date.now()}`

    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert([{
        batch_number: batchNumber,
        lot_id: lotId,
        weight_kg: parseFloat(weightKg),
        sacks: parseInt(sacks),
        status: 'qc_pending',
        location: location.trim(),
        moisture_arrival: moisture ? parseFloat(moisture) : null,
        source_reference: sourceRef.trim() || null,
        notes: notes.trim() || null,
      }])
      .select()

    if (batchError) { setError(batchError.message); setLoading(false); return }

    const batchId = batchData[0].id
    const { error: txError } = await supabase.from('inventory_transactions').insert([{
      batch_id: batchId,
      type: 'receive',
      weight_change_kg: parseFloat(weightKg),
      notes: `Received ${sacks} sacks`,
    }])

    if (txError) { setError(txError.message); setLoading(false); return }

    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })

    setLastBatchNumber(batchNumber)
    setLotId('')
    setWeightKg('')
    setSacks('')
    setLocation('')
    setMoisture('')
    setSourceRef('')
    setNotes('')
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Receive Stock</h1>

      {lastBatchNumber && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <div>
            <p className="font-medium text-green-800">Batch received successfully!</p>
            <p className="text-sm text-green-600 mt-0.5">Batch #: {lastBatchNumber}</p>
          </div>
          <button
            onClick={() => setLastBatchNumber(null)}
            className="text-green-600 hover:text-green-800 text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Incoming Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Coffee Lot *</Label>
              <select
                value={lotId}
                onChange={e => setLotId(e.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Select a coffee lot…</option>
                {lots.map(lot => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name} — {lot.origin}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Weight (kg) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={weightKg}
                  onChange={e => setWeightKg(e.target.value)}
                  placeholder="e.g. 300.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Sacks *</Label>
                <Input
                  type="number"
                  min="1"
                  value={sacks}
                  onChange={e => setSacks(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Weight per Sack</Label>
              <Input value={weightPerSack} readOnly className="bg-gray-50 text-gray-500 cursor-default" />
            </div>

            <div className="space-y-1.5">
              <Label>Location *</Label>
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Warehouse A"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Moisture Content (%) <span className="text-gray-400 font-normal">optional</span></Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={moisture}
                onChange={e => setMoisture(e.target.value)}
                placeholder="e.g. 11.50"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Source Reference <span className="text-gray-400 font-normal">optional</span></Label>
              <Input
                value={sourceRef}
                onChange={e => setSourceRef(e.target.value)}
                placeholder="PO or OS number"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-gray-400 font-normal">optional</span></Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Any additional notes…"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Receiving…' : 'Receive Stock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
