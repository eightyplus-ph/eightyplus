import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Location {
  id: string
  name: string
  type: string
  is_active: boolean
  address: string | null
  notes: string | null
}

interface LocationForm {
  name: string
  type: string
  address: string
  notes: string
}

const emptyForm = (): LocationForm => ({ name: '', type: 'warehouse', address: '', notes: '' })

function LocationDialog({
  location,
  onClose,
}: {
  location?: Location
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!location
  const [form, setForm] = useState<LocationForm>(
    location
      ? { name: location.name, type: location.type, address: location.address ?? '', notes: location.notes ?? '' }
      : emptyForm()
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field: keyof LocationForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }
    setLoading(true)
    const payload = {
      name: form.name.trim(),
      type: form.type,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }
    const { error } = isEdit
      ? await supabase.from('locations').update(payload).eq('id', location!.id)
      : await supabase.from('locations').insert([payload])
    if (error) { setError(error.message); setLoading(false); return }
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
    onClose()
  }

  const handleToggle = async () => {
    await supabase.from('locations').update({ is_active: !location!.is_active }).eq('id', location!.id)
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <CardHeader><CardTitle>{isEdit ? 'Edit Location' : 'Add Location'}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Makati Event Booth" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                value={form.type}
                onChange={set('type')}
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="warehouse">Warehouse</option>
                <option value="event">Event</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Address <span className="text-gray-400 font-normal text-xs">optional</span></Label>
              <Input value={form.address} onChange={set('address')} placeholder="Street, City" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-gray-400 font-normal text-xs">optional</span></Label>
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={2}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center justify-between pt-2">
              {isEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleToggle}
                  className={location!.is_active ? 'text-gray-500' : 'text-green-600 border-green-300 hover:bg-green-50'}
                >
                  {location!.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? 'Saving…' : isEdit ? 'Save' : 'Add Location'}</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LocationsPage() {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('type').order('name')
      if (error) throw error
      return data as Location[]
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Locations</h1>
        <Button onClick={() => setShowAdd(true)}>Add Location</Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Address</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && locations.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">No locations yet.</td></tr>
              )}
              {locations.map(loc => (
                <tr key={loc.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEditing(loc)}>
                  <td className="px-4 py-3 font-medium text-gray-900">{loc.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={loc.type === 'warehouse' ? 'info' : 'default'}>
                      {loc.type === 'warehouse' ? 'Warehouse' : 'Event'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{loc.address ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={loc.is_active ? 'success' : 'default'}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showAdd && <LocationDialog onClose={() => setShowAdd(false)} />}
      {editing && <LocationDialog location={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
