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

interface ExistingLot { id: string; name: string; origin: string }
interface Location { id: string; name: string }

interface LocationRow {
  id: string
  locationId: string
  sacks: string
  perSack: string
  weightKg: string
  receivedDate: string
  sourceRef: string
  notes: string
}

function newLocationRow(): LocationRow {
  return {
    id: crypto.randomUUID(),
    locationId: '',
    sacks: '',
    perSack: '',
    weightKg: '',
    receivedDate: new Date().toISOString().slice(0, 10),
    sourceRef: '',
    notes: '',
  }
}

function generateProductName(origin: string, region: string, producer: string, process: string, grade: string, otherInfo: string): string {
  return [origin, region, producer, process, grade, otherInfo].filter(s => s.trim().length > 0).join(' · ')
}

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

  const { data: existingLots = [] } = useQuery<ExistingLot[]>({
    queryKey: ['lots-select'],
    queryFn: async () => {
      const { data } = await supabase.from('lots').select('id, name, origin').order('name')
      return (data ?? []) as ExistingLot[]
    },
  })

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

  const [lotMode, setLotMode] = useState<'existing' | 'new'>('existing')
  const [selectedLotId, setSelectedLotId] = useState('')

  // New lot fields
  const [origin, setOrigin] = useState('')
  const [region, setRegion] = useState('')
  const [producer, setProducer] = useState('')
  const [process, setProcess] = useState('')
  const [grade, setGrade] = useState('')
  const [otherInfo, setOtherInfo] = useState('')
  const [tasteNotes, setTasteNotes] = useState('')

  // Multi-location rows
  const [locationRows, setLocationRows] = useState<LocationRow[]>([newLocationRow()])

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const [lastProductName, setLastProductName] = useState('')

  // Contract assignment (post-submit)
  const [createdBatches, setCreatedBatches] = useState<{ id: string; locationName: string }[]>([])
  const [assigningBatchId, setAssigningBatchId] = useState('')
  const [assigningContractItem, setAssigningContractItem] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignDone, setAssignDone] = useState(false)

  const productName = lotMode === 'new'
    ? generateProductName(origin, region, producer, process, grade, otherInfo)
    : (existingLots.find(l => l.id === selectedLotId)?.name ?? '')

  const updateRow = (id: string, field: keyof LocationRow, value: string) => {
    setLocationRows(rows => rows.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: value }
      if (field === 'sacks' || field === 'perSack') {
        const s = parseInt(field === 'sacks' ? value : updated.sacks)
        const p = parseFloat(field === 'perSack' ? value : updated.perSack)
        if (s > 0 && p > 0) updated.weightKg = (s * p).toFixed(2)
      }
      if (field === 'weightKg') {
        const s = parseInt(updated.sacks)
        const w = parseFloat(value)
        if (s > 0 && w > 0) updated.perSack = (w / s).toFixed(2)
      }
      return updated
    }))
  }

  const addRow = () => setLocationRows(r => [...r, newLocationRow()])
  const removeRow = (id: string) => setLocationRows(r => r.filter(row => row.id !== id))

  const handleAssign = async () => {
    const batchId = createdBatches.length === 1 ? createdBatches[0].id : assigningBatchId
    if (!batchId || !assigningContractItem) return
    setAssignLoading(true)
    await supabase.from('batches').update({ contract_item_id: assigningContractItem }).eq('id', batchId)
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    setAssignDone(true)
    setAssignLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (lotMode === 'existing' && !selectedLotId) { setError('Select an existing product or switch to New Product.'); return }
    if (lotMode === 'new' && !origin.trim()) { setError('Origin is required.'); return }

    for (const row of locationRows) {
      if (!row.locationId) { setError('Select a location for each row.'); return }
      if (!row.sacks || parseInt(row.sacks) <= 0) { setError('Sacks must be greater than 0 in each row.'); return }
      if (!row.perSack || parseFloat(row.perSack) <= 0) { setError('Per-sack weight must be greater than 0 in each row.'); return }
    }

    setLoading(true)

    let lotId: string
    if (lotMode === 'existing') {
      lotId = selectedLotId
    } else {
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
      lotId = lotData[0].id
    }

    let createdBatchList: { id: string; locationName: string }[] = []

    for (const row of locationRows) {
      const [yyyy, mm, dd] = row.receivedDate.split('-')
      const dateStr = `${mm}${dd}${yyyy}`
      const { count } = await supabase.from('batches').select('id', { count: 'exact', head: true }).like('batch_number', `${dateStr}%`)
      const seq = String((count ?? 0) + 1 + createdBatchList.length).padStart(2, '0')
      const batchNumber = `${dateStr}-${seq}`

      const { data: batchData, error: batchError } = await supabase
        .from('batches')
        .insert([{
          batch_number: batchNumber,
          lot_id: lotId,
          weight_kg: parseFloat(row.weightKg),
          sacks: parseInt(row.sacks),
          location_id: row.locationId,
          received_at: row.receivedDate,
          source_reference: row.sourceRef.trim() || null,
          notes: row.notes.trim() || null,
        }])
        .select()

      if (batchError) { setError(batchError.message); setLoading(false); return }

      await supabase.from('inventory_transactions').insert([{
        batch_id: batchData[0].id,
        type: 'receive',
        weight_change_kg: parseFloat(row.weightKg),
        notes: `Received ${row.sacks} sacks`,
      }])

      const locName = locations.find(l => l.id === row.locationId)?.name ?? 'Unknown'
      createdBatchList.push({ id: batchData[0].id, locationName: locName })
    }

    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['lots'] })
    await queryClient.invalidateQueries({ queryKey: ['lots-select'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })

    setSuccessCount(locationRows.length)
    setLastProductName(productName)
    setCreatedBatches(createdBatchList)
    setAssigningBatchId(createdBatchList.length === 1 ? createdBatchList[0].id : '')
    setAssigningContractItem('')
    setAssignDone(false)

    setLocationRows([newLocationRow()])
    if (lotMode === 'new') {
      setOrigin(''); setRegion(''); setProducer(''); setProcess(''); setGrade(''); setOtherInfo(''); setTasteNotes('')
    }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Receive Stock</h1>

      {successCount !== null && (
        <div className="mb-6 border border-green-200 rounded-lg overflow-hidden">
          <div className="p-4 bg-green-50 flex items-start justify-between">
            <div>
              <p className="font-medium text-green-800">
                {successCount === 1 ? 'Stock received successfully!' : `${successCount} batches received successfully!`}
              </p>
              <p className="text-sm text-green-700 mt-0.5">{lastProductName}</p>
            </div>
            <button onClick={() => setSuccessCount(null)} className="text-green-500 hover:text-green-700 text-sm ml-4">✕</button>
          </div>
          {activeContractItems.length > 0 && createdBatches.length > 0 && !assignDone && (
            <div className="p-4 bg-white border-t border-green-100 space-y-2">
              <p className="text-sm font-medium text-gray-700">Assign to contract? <span className="text-gray-400 font-normal">(optional)</span></p>
              <div className="flex gap-2 items-center flex-wrap">
                {createdBatches.length > 1 && (
                  <select
                    value={assigningBatchId}
                    onChange={e => setAssigningBatchId(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Pick batch…</option>
                    {createdBatches.map(b => (
                      <option key={b.id} value={b.id}>{b.locationName}</option>
                    ))}
                  </select>
                )}
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
                  disabled={!assigningContractItem || assignLoading || (createdBatches.length > 1 && !assigningBatchId)}
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
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Product Identity</CardTitle>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                <button type="button" onClick={() => setLotMode('existing')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${lotMode === 'existing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Existing product</button>
                <button type="button" onClick={() => setLotMode('new')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${lotMode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>New product</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {lotMode === 'existing' ? (
              <div className="space-y-1.5">
                <Label>Select product</Label>
                <select value={selectedLotId} onChange={e => setSelectedLotId(e.target.value)} className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <option value="">Choose a product…</option>
                  {existingLots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Origin *</Label><Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Brazil" /></div>
                  <div className="space-y-1.5"><Label>Region</Label><Input value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. Cerrado" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Producer / Farm</Label><Input value={producer} onChange={e => setProducer(e.target.value)} placeholder="e.g. Fazenda Um" /></div>
                  <div className="space-y-1.5"><Label>Process <span className="text-gray-400 font-normal text-xs">optional</span></Label><Input value={process} onChange={e => setProcess(e.target.value)} placeholder="e.g. Natural, Washed" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Grade <span className="text-gray-400 font-normal text-xs">optional</span></Label><Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. Grade 1" /></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Other Info</Label>
                  <textarea value={otherInfo} onChange={e => setOtherInfo(e.target.value)} rows={2} placeholder="Varietal, certifications, or any other details…" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none" />
                </div>
                <div className="space-y-1.5">
                  <Label>Taste Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                  <textarea value={tasteNotes} onChange={e => setTasteNotes(e.target.value)} rows={2} placeholder="e.g. Blueberry, jasmine, dark chocolate…" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none" />
                </div>
                {productName && (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                    <p className="text-xs text-blue-500 font-medium mb-0.5">Generated product name</p>
                    <p className="text-sm font-semibold text-blue-900">{productName}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Location Rows */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Stock by Location</CardTitle>
              <button type="button" onClick={addRow} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add location</button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {locationRows.map((row, idx) => (
              <div key={row.id} className="space-y-3">
                {locationRows.length > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Location {idx + 1}</p>
                    <button type="button" onClick={() => removeRow(row.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Location *</Label>
                    <select value={row.locationId} onChange={e => updateRow(row.id, 'locationId', e.target.value)} className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <option value="">Select location…</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Received Date</Label>
                    <Input type="date" value={row.receivedDate} onChange={e => updateRow(row.id, 'receivedDate', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Sacks *</Label>
                    <Input type="number" min="1" value={row.sacks} onChange={e => updateRow(row.id, 'sacks', e.target.value)} placeholder="10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Per Sack (kg) *</Label>
                    <Input type="number" step="0.01" min="0" value={row.perSack} onChange={e => updateRow(row.id, 'perSack', e.target.value)} placeholder="60.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Total (kg)</Label>
                    <Input type="number" step="0.01" min="0" value={row.weightKg} onChange={e => updateRow(row.id, 'weightKg', e.target.value)} placeholder="600.00" className="bg-gray-50" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Source Reference <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                  <Input value={row.sourceRef} onChange={e => updateRow(row.id, 'sourceRef', e.target.value)} placeholder="PO or OS number" />
                </div>
                {idx < locationRows.length - 1 && <div className="border-b border-gray-100 pt-2" />}
              </div>
            ))}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Receiving…' : locationRows.length === 1 ? 'Receive Stock' : `Receive Stock — ${locationRows.length} locations`}
        </Button>
      </form>
    </div>
  )
}
