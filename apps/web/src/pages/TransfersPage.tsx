import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Location { id: string; name: string }
interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  sacks: number | null
  sack_weight_kg: string | null
  sku_type: string | null
  lot_id: string | null
  location_id: string | null
  lots: { name: string } | null
}
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

const normSku = (t: string | null) => t === 'retail_1kg' ? 'retail_1kg' : 'commercial'

const pillCls = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer select-none ${
    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
  }`

const rowCls = (active: boolean) =>
  `w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors cursor-pointer ${
    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
  }`

export default function TransfersPage() {
  const queryClient = useQueryClient()

  const [fromId,   setFromId]   = useState('')
  const [lotId,    setLotId]    = useState('')
  const [skuType,  setSkuType]  = useState('')
  const [batchId,  setBatchId]  = useState('')
  const [toId,     setToId]     = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [sacks,    setSacks]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('id, name').eq('is_active', true).order('name')
      if (error) throw error
      return data as Location[]
    },
  })

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['batches-transfer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, sack_weight_kg, sku_type, lot_id, location_id, lots(name)')
        .gt('weight_kg', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Batch[]
    },
  })

  const { data: transfers = [], isLoading: loadingHistory } = useQuery<Transfer[]>({
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

  // Step derivations
  const fromOptions = useMemo(() => {
    const locIds = new Set(batches.map(b => b.location_id).filter(Boolean))
    return locations.filter(l => locIds.has(l.id))
  }, [locations, batches])

  const lotOptions = useMemo(() => {
    if (!fromId) return []
    const map = new Map<string, string>()
    for (const b of batches) {
      if (b.location_id === fromId && b.lot_id && b.lots?.name) map.set(b.lot_id, b.lots.name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [batches, fromId])

  const skuOptions = useMemo(() => {
    if (!fromId || !lotId) return []
    const types = new Set(batches.filter(b => b.location_id === fromId && b.lot_id === lotId).map(b => normSku(b.sku_type)))
    return [...types].map(t => ({ value: t, label: t === 'retail_1kg' ? '1 kg bags' : 'Commercial sacks' }))
  }, [batches, fromId, lotId])

  const matchingBatches = useMemo(() => {
    if (!fromId || !lotId || !skuType) return []
    return batches.filter(b => b.location_id === fromId && b.lot_id === lotId && normSku(b.sku_type) === skuType)
  }, [batches, fromId, lotId, skuType])

  const resolvedBatch = useMemo(() => {
    if (matchingBatches.length === 1) return matchingBatches[0]
    if (batchId) return matchingBatches.find(b => b.id === batchId) ?? null
    return null
  }, [matchingBatches, batchId])

  const toOptions = useMemo(() => locations.filter(l => l.id !== fromId), [locations, fromId])

  // Handlers — each resets downstream state
  const handleFromChange = (id: string) => {
    setFromId(id); setLotId(''); setSkuType(''); setBatchId(''); setToId(''); setWeightKg(''); setSacks(''); setError('')
  }

  const handleLotChange = (id: string) => {
    setLotId(id); setSkuType(''); setBatchId(''); setToId(''); setWeightKg(''); setSacks('')
  }

  const handleSkuChange = (type: string) => {
    setSkuType(type); setBatchId(''); setToId('')
    const matches = batches.filter(b => b.location_id === fromId && b.lot_id === lotId && normSku(b.sku_type) === type)
    if (matches.length === 1) {
      setWeightKg(parseFloat(matches[0].weight_kg).toFixed(2))
      setSacks(matches[0].sacks != null ? String(matches[0].sacks) : '')
    } else {
      setWeightKg(''); setSacks('')
    }
  }

  const handleBatchChange = (id: string) => {
    setBatchId(id); setToId('')
    const b = matchingBatches.find(x => x.id === id)
    if (b) {
      setWeightKg(parseFloat(b.weight_kg).toFixed(2))
      setSacks(b.sacks != null ? String(b.sacks) : '')
    }
  }

  const handleBagsChange = (val: string) => {
    setSacks(val)
    const n = parseInt(val) || 0
    setWeightKg(n > 0 ? String(n) : '')
  }

  const handleSubmit = async () => {
    setError('')
    if (!resolvedBatch) { setError('Select a batch.'); return }
    if (!toId)          { setError('Select a destination.'); return }
    if (!weightKg || parseFloat(weightKg) <= 0) { setError('Enter a weight greater than 0.'); return }

    setLoading(true)
    const { error: tErr } = await supabase.from('transfers').insert([{
      batch_id:         resolvedBatch.id,
      from_location_id: fromId,
      to_location_id:   toId,
      weight_kg:        parseFloat(weightKg),
      sacks:            sacks ? parseInt(sacks) : null,
      notes:            notes.trim() || null,
    }])
    if (tErr) { setError(tErr.message); setLoading(false); return }

    await supabase.from('batches').update({ location_id: toId }).eq('id', resolvedBatch.id)
    await queryClient.invalidateQueries({ queryKey: ['transfers'] })
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['batches-transfer'] })

    setFromId(''); setLotId(''); setSkuType(''); setBatchId(''); setToId('')
    setWeightKg(''); setSacks(''); setNotes('')
    setLoading(false)
  }

  const showBatchPicker = skuType && matchingBatches.length > 1
  const showTo          = skuType && (matchingBatches.length === 1 || batchId)
  const showQuantity    = toId && resolvedBatch

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Transfers</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Form */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-base">New Transfer</CardTitle></CardHeader>
            <CardContent className="space-y-6">

              {/* FROM */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">From</p>
                <div className="flex flex-wrap gap-2">
                  {fromOptions.map(l => (
                    <button key={l.id} type="button" onClick={() => handleFromChange(l.id)} className={pillCls(fromId === l.id)}>
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* PRODUCT */}
              {fromId && lotOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Origin</p>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {lotOptions.map(lot => (
                      <button key={lot.id} type="button" onClick={() => handleLotChange(lot.id)} className={rowCls(lotId === lot.id)}>
                        {lot.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* TYPE */}
              {lotId && skuOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</p>
                  <div className="flex gap-2">
                    {skuOptions.map(opt => (
                      <button key={opt.value} type="button" onClick={() => handleSkuChange(opt.value)}
                        className={`flex-1 py-2 rounded-lg text-sm border transition-colors cursor-pointer ${
                          skuType === opt.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* BATCH PICKER (only if multiple) */}
              {showBatchPicker && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Batch</p>
                  <div className="space-y-1.5">
                    {matchingBatches.map(b => (
                      <button key={b.id} type="button" onClick={() => handleBatchChange(b.id)} className={rowCls(batchId === b.id)}>
                        <span className="font-mono">{b.batch_number}</span>
                        <span className={`ml-2 text-xs ${batchId === b.id ? 'text-gray-300' : 'text-gray-400'}`}>
                          {Math.round(parseFloat(b.weight_kg))} kg · {b.sacks ?? '?'} {skuType === 'retail_1kg' ? 'bags' : 'sacks'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch summary + TO */}
              {showTo && resolvedBatch && (
                <>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="font-mono text-xs text-gray-400">{resolvedBatch.batch_number}</p>
                    <p className="text-sm font-medium text-gray-800">
                      {Math.round(parseFloat(resolvedBatch.weight_kg))} kg
                      {resolvedBatch.sacks != null && (
                        <span className="text-gray-400 font-normal">
                          {' '}· {resolvedBatch.sacks} {skuType === 'retail_1kg' ? 'bags' : 'sacks'}
                          {resolvedBatch.sack_weight_kg && skuType !== 'retail_1kg' &&
                            ` @ ${resolvedBatch.sack_weight_kg} kg ea`}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">To</p>
                    <div className="flex flex-wrap gap-2">
                      {toOptions.map(l => (
                        <button key={l.id} type="button" onClick={() => setToId(l.id)} className={pillCls(toId === l.id)}>
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* QUANTITY + SUBMIT */}
              {showQuantity && (
                <div className="space-y-3">
                  {skuType === 'retail_1kg' ? (
                    <div className="space-y-1.5">
                      <Label>Bags to transfer</Label>
                      <Input type="number" min="1" value={sacks} onChange={e => handleBagsChange(e.target.value)} placeholder="0" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Weight (kg)</Label>
                        <Input type="number" step="0.01" min="0" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Sacks</Label>
                        <Input type="number" min="1" value={sacks} onChange={e => setSacks(e.target.value)} placeholder="0" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
                    <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. BGS Pop-up Jan 2026" />
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <Button onClick={handleSubmit} disabled={loading} className="w-full">
                    {loading ? 'Logging…' : 'Log Transfer'}
                  </Button>
                </div>
              )}

            </CardContent>
          </Card>
        </div>

        {/* History */}
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
                  {loadingHistory && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                  )}
                  {!loadingHistory && transfers.length === 0 && (
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
