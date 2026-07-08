import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const MODULES = [
  { key: 'dashboard',  label: 'Dashboard' },
  { key: 'inventory',  label: 'Inventory' },
  { key: 'receiving',  label: 'Receiving' },
  { key: 'transfers',  label: 'Transfers' },
  { key: 'repack',     label: 'Repack' },
  { key: 'lots',       label: 'Product Names' },
  { key: 'locations',  label: 'Locations' },
  { key: 'clients',    label: 'Clients' },
  { key: 'orders',     label: 'Orders' },
  { key: 'dispatches', label: 'Dispatches' },
  { key: 'contracts',  label: 'Contracts' },
]

const ROLES = ['admin', 'manager', 'sales', 'ops']

interface UserProfile {
  id: string
  full_name: string
  role: string
  allowed_modules: string[] | null
}

export default function UsersPage() {
  const { data: profile } = useProfile()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ role: string; modules: string[] | null }>({ role: '', modules: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: users = [], isLoading } = useQuery<UserProfile[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, allowed_modules')
        .order('full_name')
      if (error) throw error
      return data as UserProfile[]
    },
  })

  if (profile?.role !== 'admin') {
    return <p className="text-gray-500 text-sm p-4">Access restricted to admins.</p>
  }

  const startEdit = (u: UserProfile) => {
    setEditingId(u.id)
    setDraft({ role: u.role, modules: u.allowed_modules ? [...u.allowed_modules] : null })
    setError('')
  }

  const cancelEdit = () => { setEditingId(null); setError('') }

  const toggleModule = (key: string) => {
    setDraft(prev => {
      const current = prev.modules ?? []
      return {
        ...prev,
        modules: current.includes(key) ? current.filter(k => k !== key) : [...current, key],
      }
    })
  }

  const setUseRoleDefaults = (useDefaults: boolean) => {
    setDraft(prev => ({ ...prev, modules: useDefaults ? null : MODULES.map(m => m.key) }))
  }

  const save = async (userId: string) => {
    setSaving(true); setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ role: draft.role, allowed_modules: draft.modules })
      .eq('id', userId)
    setSaving(false)
    if (err) { setError(err.message); return }
    await queryClient.invalidateQueries({ queryKey: ['users-list'] })
    await queryClient.invalidateQueries({ queryKey: ['profile'] })
    setEditingId(null)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Users</h1>
      <Card>
        {isLoading && <p className="p-4 text-sm text-gray-400">Loading…</p>}
        <div className="divide-y divide-gray-100">
          {users.map(u => {
            const isEditing = editingId === u.id
            return (
              <div key={u.id} className="px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{u.full_name || '(no name)'}</p>
                    <p className="text-xs text-gray-400 capitalize mt-0.5">
                      {u.role} · {u.allowed_modules ? `${u.allowed_modules.length} modules` : 'role defaults'}
                    </p>
                  </div>
                  {!isEditing && (
                    <Button variant="outline" size="sm" onClick={() => startEdit(u)}>Edit</Button>
                  )}
                </div>

                {isEditing && (
                  <CardContent className="mt-4 p-0 space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Role</p>
                      <div className="flex gap-2 flex-wrap">
                        {ROLES.map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setDraft(prev => ({ ...prev, role: r }))}
                            className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors capitalize ${draft.role === r ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Module Access</p>
                        <button
                          type="button"
                          onClick={() => setUseRoleDefaults(draft.modules !== null)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {draft.modules !== null ? 'Use role defaults' : 'Customize'}
                        </button>
                      </div>

                      {draft.modules !== null ? (
                        <div className="grid grid-cols-2 gap-1.5">
                          {MODULES.map(m => (
                            <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={draft.modules!.includes(m.key)}
                                onChange={() => toggleModule(m.key)}
                                className="rounded border-gray-300"
                              />
                              {m.label}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Showing modules based on <span className="font-medium capitalize">{draft.role}</span> role. Click "Customize" to override.</p>
                      )}
                    </div>

                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => save(u.id)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                      <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                    </div>
                  </CardContent>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
