import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'

interface Lot {
  id: string
  name: string
  origin: string
  region: string | null
  producer: string | null
  grade: string | null
  process: string | null
  created_at: string
}

interface LotWithBatchCount extends Lot {
  batch_count: number
}

export default function LotsPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: lots = [], isLoading } = useQuery<LotWithBatchCount[]>({
    queryKey: ['lots'],
    queryFn: async () => {
      const { data: lotData, error } = await supabase.from('lots').select('*').order('name')
      if (error) throw error
      const { data: batchCounts } = await supabase.from('batches').select('lot_id')
      const countMap = new Map<string, number>()
      for (const b of batchCounts ?? []) {
        const lid = b.lot_id as string
        countMap.set(lid, (countMap.get(lid) ?? 0) + 1)
      }
      return (lotData ?? []).map(l => ({ ...l, batch_count: countMap.get(l.id) ?? 0 }))
    },
  })

  const startEdit = (lot: Lot) => {
    setEditingId(lot.id)
    setEditName(lot.name)
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return
    setSaving(true)
    await supabase.from('lots').update({ name: editName.trim() }).eq('id', editingId)
    await queryClient.invalidateQueries({ queryKey: ['lots'] })
    await queryClient.invalidateQueries({ queryKey: ['lots-select'] })
    await queryClient.invalidateQueries({ queryKey: ['batches'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    setEditingId(null)
    setSaving(false)
  }

  const cancelEdit = () => setEditingId(null)

  const deleteLot = async (id: string) => {
    setDeletingId(id)
    await supabase.from('lots').delete().eq('id', id)
    await queryClient.invalidateQueries({ queryKey: ['lots'] })
    await queryClient.invalidateQueries({ queryKey: ['lots-select'] })
    setDeletingId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Product Names</h1>
          <p className="text-sm text-gray-500 mt-0.5">Click any product name to edit it.</p>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Product Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Origin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Process</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Grade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Batches</th>
              <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && lots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No products yet — receive stock to create your first lot.
                  </td>
                </tr>
              )}
              {lots.map(lot => (
                <tr key={lot.id} className={`border-b border-gray-100 ${editingId === lot.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {editingId === lot.id ? (
                      <div className="flex gap-1.5 items-center">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 rounded px-2 py-1 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button onClick={saveEdit} disabled={saving} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:text-blue-600 hover:underline"
                        onClick={() => startEdit(lot)}
                        title="Click to edit"
                      >
                        {lot.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lot.origin}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.producer ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.process ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.grade ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {lot.batch_count === 0
                      ? <span className="text-amber-500">0 batches</span>
                      : `${lot.batch_count} batch${lot.batch_count === 1 ? '' : 'es'}`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {lot.batch_count === 0 && (
                      <button
                        onClick={() => deleteLot(lot.id)}
                        disabled={deletingId === lot.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingId === lot.id ? '…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
