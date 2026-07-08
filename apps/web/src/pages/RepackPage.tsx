import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

interface Batch {
  id: string
  batch_number: string
  weight_kg: string
  sacks: number | null
  sku_type: string | null
  sack_weight_kg: string | null
  location_id: string | null
  lot_id: string
  lots: { name: string } | null
  locations: { name: string } | null
}

interface RepackRow {
  id: string
  weight_consumed_kg: string
  weight_produced_kg: string
  variance_kg: string
  performed_by: string | null
  created_at: string
  source: { batch_number: string; lots: { name: string } | null } | null
  output: { batch_number: string; sku_type: string | null } | null
}

const SKU_OPTIONS: [string, string][] = [
  ['commercial', 'Commercial sack'],
  ['retail_1kg', '1 kg retail'],
]
const SKU_LABEL: Record<string, string> = Object.fromEntries(SKU_OPTIONS)
const DEFAULT_SACK_WEIGHT: Record<string, number> = { commercial: 60, retail_1kg: 1 }

export default function RepackPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()

  const [batchId, setBatchId] = useState('')
  const [consumedKg, setConsumedKg] = useState('')
  const [outputSku, setOutputSku] = useState('retail_1kg')
  const [sackWeightKg, setSackWeightKg] = useState('1')
  const [outputSacks, setOutputSacks] = useState('')
  const [producedKg, setProducedKg] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['batches-repack'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id, batch_number, weight_kg, sacks, sku_type, sack_weight_kg, location_id, lot_id, lots(name), locations(name)')
        .gt('weight_kg', 0)
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as unknown as Batch[]
    },
  })

  const { data: history = [] } = useQuery<RepackRow[]>({
    queryKey: ['repacks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repacks')
        .select('id, weight_consumed_kg, weight_produced_kg, variance_kg, performed_by, created_at, source:source_batch_id(batch_number, lots(name)), output:output_batch_id(batch_number, sku_type)')
        .order('created_at', { ascending: false })
        .limit(25)
      if (error) throw error
      return data as unknown as RepackRow[]
    },
  })

  const source = batches.find(b => b.id === batchId)
  const sourceWeight = source ? parseFloat(source.weight_kg) : 0
  const consumed = parseFloat(consumedKg || '0')
  const produced = parseFloat(producedKg || consumedKg || '0')
  const variance = consumed - produced

  const selectSku = (sku: string) => {
    setOutputSku(sku)
    setSackWeightKg(String(DEFAULT_SACK_WEIGHT[sku] ?? ''))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!source) { setError('Select a source batch.'); return }
    if (!consumed || consumed <= 0) { setError('Weight to repack must be greater than 0.'); return }
    if (consumed > sourceWeight + 0.001) { setError(`Only ${sourceWeight.toFixed(2)} kg available in this batch.`); return }
    if (!produced || produced <= 0) { setError('Produced weight must be greater than 0.'); return }
    if (produced > consumed + 0.001) { setError('Produced weight cannot exceed consumed weight.'); return }

    setLoading(true)

    // Guardrail: never repack stock that is reserved for orders.
    const { data: reservedItems, error: rErr } = await supabase
      .from('order_items')
      .select('weight_ordered_kg, orders(status)')
      .eq('batch_id', source.id)
    if (rErr) { setError(rErr.message); setLoading(false); return }
    const reserved = (reservedItems ?? [])
      .filter(i => {
        const s = (i.orders as unknown as { status: string } | null)?.status
        return s === 'reserved' || s === 'confirmed'
      })
      .reduce((sum, i) => sum + parseFloat(i.weight_ordered_kg as unknown as string), 0)
    if (consumed > sourceWeight - reserved + 0.001) {
      setError(`This batch has ${reserved.toFixed(2)} kg reserved for orders — you can repack at most ${Math.max(0, sourceWeight - reserved).toFixed(2)} kg without stranding them.`)
      setLoading(false); return
    }

    // 1) Decrement the source batch.
    const consumedSacks = source.sacks != null && source.sack_weight_kg && parseFloat(source.sack_weight_kg) > 0
      ? Math.round(consumed / parseFloat(source.sack_weight_kg))
      : null
    const { error: decErr } = await supabase.from('batches').update({
      weight_kg: (sourceWeight - consumed).toFixed(2),
      ...(consumedSacks != null && source.sacks != null ? { sacks: Math.max(0, source.sacks - consumedSacks) } : {}),
    }).eq('id', source.id)
    if (decErr) { setError(decErr.message); setLoading(false); return }

    // 2) Create the output batch (new SKU, same lot + location, lineage to source).
    const { count } = await supabase.from('batches').select('id', { count: 'exact', head: true }).eq('source_batch_id', source.id)
    const outputNumber = `${source.batch_number}-R${String((count ?? 0) + 1).padStart(2, '0')}`
    const { data: outData, error: outErr } = await supabase.from('batches').insert([{
      batch_number: outputNumber,
      lot_id: source.lot_id,
      weight_kg: produced.toFixed(2),
      sacks: outputSacks ? parseInt(outputSacks) : null,
      sku_type: outputSku,
      sack_weight_kg: sackWeightKg ? parseFloat(sackWeightKg) : null,
      location_id: source.location_id,
      source_batch_id: source.id,
      notes: notes.trim() || null,
    }]).select()
    if (outErr) { setError(outErr.message); setLoading(false); return }
    const outputId = outData[0].id

    // 3) Record the repack + inventory ledger entries (out on source, in on output).
    await supabase.from('repacks').insert([{
      source_batch_id: source.id,
      output_batch_id: outputId,
      weight_consumed_kg: consumed.toFixed(2),
      weight_produced_kg: produced.toFixed(2),
      variance_kg: variance.toFixed(2),
      performed_by: profile?.full_name ?? null,
      notes: notes.trim() || null,
    }])
    await supabase.from('inventory_transactions').insert([
      { batch_id: source.id, type: 'repack_out', weight_change_kg: (-consumed).toFixed(2), notes: `Repacked to ${SKU_LABEL[outputSku] ?? outputSku} (${outputNumber})` },
      { batch_id: outputId, type: 'repack_in', weight_change_kg: produced.toFixed(2), notes: `Repacked from ${source.batch_number}` },
    ])

    await queryClient.invalidateQueries({ queryKey: ['batches-repack'] })
    await queryClient.invalidateQueries({ queryKey: ['repacks'] })
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })

    setBatchId(''); setConsumedKg(''); setOutputSacks(''); setProducedKg(''); setNotes('')
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Repack</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <Card className="lg:col-span-2 p-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label>Source batch *</Label>
              <select
                value={batchId}
                onChange={e => { setBatchId(e.target.value); setConsumedKg(''); setProducedKg('') }}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a batch…</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.batch_number} · {b.lots?.name ?? '—'} · {Math.round(parseFloat(b.weight_kg))} kg
                    {b.locations?.name ? ` · ${b.locations.name}` : ''}
                    {b.sku_type ? ` · ${SKU_LABEL[b.sku_type] ?? b.sku_type}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {source && (
              <div className="rounded-md bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{source.lots?.name ?? '—'}</span> · {sourceWeight.toFixed(2)} kg
                {source.sacks != null ? ` · ${source.sacks} sacks` : ''}
                {source.sku_type ? ` · ${SKU_LABEL[source.sku_type] ?? source.sku_type}` : ''}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Weight to repack (kg) *</Label>
                <Input type="number" step="0.01" min="0" value={consumedKg}
                  onChange={e => setConsumedKg(e.target.value)} placeholder="0.00" />
                {source && (
                  <button type="button" onClick={() => setConsumedKg(sourceWeight.toFixed(2))}
                    className="text-xs text-blue-600 hover:underline">Use full batch ({sourceWeight.toFixed(2)} kg)</button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Produced weight (kg)</Label>
                <Input type="number" step="0.01" min="0" value={producedKg}
                  onChange={e => setProducedKg(e.target.value)} placeholder={consumedKg || 'same as repacked'} />
                {Math.abs(variance) >= 0.01 && (
                  <p className={`text-xs ${variance > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {variance > 0 ? `${variance.toFixed(2)} kg loss (spillage/tare)` : `${(-variance).toFixed(2)} kg gain — check entry`}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Output SKU *</Label>
              <div className="flex gap-2">
                {SKU_OPTIONS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => selectSku(val)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${outputSku === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Per-bag weight (kg)</Label>
                <Input type="number" step="0.01" min="0" value={sackWeightKg}
                  onChange={e => setSackWeightKg(e.target.value)} placeholder="1" />
              </div>
              <div className="space-y-1.5">
                <Label>Output bags / sacks</Label>
                <Input type="number" step="1" min="0" value={outputSacks}
                  onChange={e => setOutputSacks(e.target.value)} placeholder="optional" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything about this repack…" />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={loading || !source}>
              {loading ? 'Repacking…' : 'Repack'}
            </Button>
          </form>
        </Card>

        {/* History */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700">Recent repacks</p>
          </div>
          <div className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto">
            {history.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No repacks yet.</p>}
            {history.map(r => {
              const v = parseFloat(r.variance_kg)
              return (
                <div key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{r.source?.lots?.name ?? '—'}</span>
                    <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.source?.batch_number ?? '—'} → {r.output?.batch_number ?? '—'} · {SKU_LABEL[r.output?.sku_type ?? ''] ?? r.output?.sku_type ?? '—'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {parseFloat(r.weight_consumed_kg).toFixed(2)} kg → {parseFloat(r.weight_produced_kg).toFixed(2)} kg
                    {Math.abs(v) >= 0.01 && <span className="text-amber-600"> · {v.toFixed(2)} kg loss</span>}
                    {r.performed_by ? ` · ${r.performed_by}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
