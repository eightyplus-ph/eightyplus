import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ActiveContractItem {
  id: string
  product_name: string
  contracts: { contract_number: string; title: string | null; client_name: string } | null
}

function generateProductName(origin: string, region: string, producer: string, process: string, grade: string, otherInfo: string): string {
  return [origin, region, producer, process, grade, otherInfo].filter(s => s.trim().length > 0).join(' · ')
}

interface Location { id: string; name: string }

export default function ReceivingPage() {
  const queryClient = useQueryClient()

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('id, name').eq('is_active', true).order('name')
      if (error) throw error
      return data as Location[]
    },
  })

  // Product identity
  const [origin, setOrigin] = useState('')
  const [region, setRegion] = useState('')
  const [producer, setProducer] = useState('')
  const [process, setProcess] = useState('')
  const [grade, setGrade] = useState('')
  const [otherInfo, setOtherInfo] = useState('')
  const [tasteNotes, setTasteNotes] = useState('')

  // Physical details
  const [weightKg, setWeightKg] = useState('')
  const [sacks, setSacks] = useState('')
  const [perSack, setPerSack] = useState('')
  const [locationId, setLocationId] = useState('')
  const [moisture, setMoisture] = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [sourceRef, setSourceRef] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastBatch, setLastBatch] = useState<{ id: string; number: string; name: string } | null>(null)
  const [assigningContractItem, setAssigningContractItem] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignDone, setAssignDone] = useState(false)

  const { data: activeContractItems = [] } = useQuery<ActiveContractItem[]>({
    queryKey: ['contract-items-active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contract_items')
        .select('id, product_name, contracts!inner(contract_number, title, clients(company_name))')
        .eq('contracts.status', 'active')
        .order('product_name')
      if (!data) return []
      return data.map((d: unknown) => {
        const row = d as { id: string; product_name: string; contracts: { contract_number: string; title: string | null; clients: { company_name: string } | null } | null }
        return {
          id: row.id,
          product_name: row.product_name,
          contracts: row.contracts ? {
            contract_number: row.contracts.contract_number,
            title: row.contracts.title,
            client_name: row.contracts.clients?.company_name ?? '',
          } : null,
        }
      })
    },
  })

  const handleAssign = async () => {
    if (!lastBatch || !assigningContractItem) return
    setAssignLoading(true)
    await supabase.from('batches').update({ contract_item_id: assigningContractItem }).eq('id', lastBatch.id)
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    setAssignDone(true)
    setAssignLoading(false)
  }

  const productName = generateProductName(origin, region, producer, process, grade, otherInfo)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!origin.trim()) { setError('Origin is required.'); return }
    if (!sacks || parseInt(sacks) <= 0) { setError('Number of sacks must be greater than 0.'); return }
    if (!perSack || parseFloat(perSack) <= 0) { setError('Per-sack weight must be greater than 0.'); return }
    if (!locationId) { setError('Location is required.'); return }

    setLoading(true)

    const { data: lotData, error: lotError } = await supabase
      .from('lots')
      .insert([{
        name: productName,
        origin: origin.trim(),
        region: region.trim() || null,
        producer: producer.trim() || null,
        process: process.trim() || null,
        grade: grade.trim() || null,
        other_info: otherInfo.trim() || null,
        taste_notes: tasteNotes.trim() || null,
      }])
      .select()

    if (lotError) { setError(lotError.message); setLoading(false); return }

    const lotId = lotData[0].id
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const yyyy = now.getFullYear()
    const dateStr = `${mm}${dd}${yyyy}`
    const { count } = await supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .like('batch_number', `${dateStr}%`)
    const seq = String((count ?? 0) + 1).padStart(2, '0')
    const batchNumber = `${dateStr}-${seq}`

    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert([{
        batch_number: batchNumber,
        lot_id: lotId,
        weight_kg: parseFloat(weightKg),
        sacks: parseInt(sacks),
        location_id: locationId,
        received_at: receivedDate,
        moisture_arrival: moisture ? parseFloat(moisture) : null,
        source_reference: sourceRef.trim() || null,
        notes: notes.trim() || null,
      }])
      .select()

    if (batchError) { setError(batchError.message); setLoading(false); return }

    await supabase.from('inventory_transactions').insert([{
      batch_id: batchData[0].id,
      type: 'receive',
      weight_change_kg: parseFloat(weightKg),
      notes: `Received ${sacks} sacks`,
    }])

    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['lots'] })
    await queryClient.invalidateQueries({ queryKey: ['lots-select'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })

    setLastBatch({ id: batchData[0].id, number: batchNumber, name: productName })
    setAssigningContractItem('')
    setAssignDone(false)
    setOrigin(''); setRegion(''); setProducer(''); setProcess(''); setGrade(''); setOtherInfo(''); setTasteNotes('')
    setWeightKg(''); setSacks(''); setPerSack(''); setLocationId('')
    setReceivedDate(new Date().toISOString().slice(0, 10))
    setMoisture(''); setSourceRef(''); setNotes('')
    setLoading(false)
  }

  const handleSacksChange = (val: string) => {
    setSacks(val)
    const s = parseInt(val)
    if (perSack && s > 0) setWeightKg((parseFloat(perSack) * s).toFixed(2))
    else if (weightKg && s > 0) setPerSack((parseFloat(weightKg) / s).toFixed(2))
  }

  const handlePerSackChange = (val: string) => {
    setPerSack(val)
    const s = parseInt(sacks)
    if (val && s > 0) setWeightKg((parseFloat(val) * s).toFixed(2))
  }

  const handleWeightChange = (val: string) => {
    setWeightKg(val)
    const s = parseInt(sacks)
    if (val && s > 0) setPerSack((parseFloat(val) / s).toFixed(2))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Receive Stock</h1>

      {lastBatch && (
        <div className="mb-6 border border-green-200 rounded-lg overflow-hidden">
          <div className="p-4 bg-green-50 flex items-start justify-between">
            <div>
              <p className="font-medium text-green-800">Stock received successfully!</p>
              <p className="text-sm text-green-700 mt-0.5">{lastBatch.name}</p>
              <p className="text-xs text-green-600 mt-0.5">Batch #{lastBatch.number}</p>
            </div>
            <button onClick={() => setLastBatch(null)} className="text-green-500 hover:text-green-700 text-sm ml-4">✕</button>
          </div>
          {activeContractItems.length > 0 && !assignDone && (
            <div className="p-4 bg-white border-t border-green-100">
              <p className="text-sm font-medium text-gray-700 mb-2">Assign to contract? <span className="text-gray-400 font-normal">(optional)</span></p>
              <div className="flex gap-2 items-center">
                <select
                  value={assigningContractItem}
                  onChange={e => setAssigningContractItem(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not a contract batch</option>
                  {activeContractItems.map(ci => (
                    <option key={ci.id} value={ci.id}>
                      {ci.contracts ? `${ci.contracts.contract_number} · ${ci.contracts.client_name}` : ''} → {ci.product_name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={!assigningContractItem || assignLoading}
                  onClick={handleAssign}
                  className="shrink-0"
                >
                  {assignLoading ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            </div>
          )}
          {assignDone && (
            <div className="px-4 py-3 bg-blue-50 border-t border-blue-100">
              <p className="text-sm text-blue-700 font-medium">Assigned to contract ✓</p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">

        {/* Product Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Product Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Origin *</Label>
                <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Ethiopia" />
              </div>
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Input value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. Sidama" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Producer / Farm</Label>
                <Input value={producer} onChange={e => setProducer(e.target.value)} placeholder="e.g. Daye Bensa" />
              </div>
              <div className="space-y-1.5">
                <Label>Process <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                <Input value={process} onChange={e => setProcess(e.target.value)} placeholder="e.g. Natural, Washed, Honey" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Grade <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                <Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. Grade 1" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Other Info</Label>
              <textarea
                value={otherInfo}
                onChange={e => setOtherInfo(e.target.value)}
                rows={2}
                placeholder="Varietal, process, certifications, or any other product details…"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Taste Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
              <textarea
                value={tasteNotes}
                onChange={e => setTasteNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Blueberry, jasmine, dark chocolate…"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>

            {productName && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-xs text-blue-500 font-medium mb-0.5">Generated product name</p>
                <p className="text-sm font-semibold text-blue-900">{productName}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Physical Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Physical Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Sacks *</Label>
                <Input type="number" min="1" value={sacks} onChange={e => handleSacksChange(e.target.value)} placeholder="10" />
              </div>
              <div className="space-y-1.5">
                <Label>Per Sack (kg) *</Label>
                <Input type="number" step="0.01" min="0" value={perSack} onChange={e => handlePerSackChange(e.target.value)} placeholder="60.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Total Weight (kg)</Label>
                <Input type="number" step="0.01" min="0" value={weightKg} onChange={e => handleWeightChange(e.target.value)} placeholder="600.00" className="bg-gray-50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Location *</Label>
                <select
                  value={locationId}
                  onChange={e => setLocationId(e.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <option value="">Select location…</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Moisture % <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                <Input type="number" step="0.01" min="0" max="100" value={moisture} onChange={e => setMoisture(e.target.value)} placeholder="11.50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Received Date</Label>
                <Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Source Reference <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                <Input value={sourceRef} onChange={e => setSourceRef(e.target.value)} placeholder="PO or OS number" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Any additional notes…"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Receiving…' : 'Receive Stock'}
        </Button>
      </form>
    </div>
  )
}
