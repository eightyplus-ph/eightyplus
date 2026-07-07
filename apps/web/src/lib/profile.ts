import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Role = 'admin' | 'manager' | 'sales' | 'ops'

export interface Profile {
  id: string
  full_name: string
  role: Role
  can_create_dispatches: boolean
  can_manage_contracts: boolean
  can_view_orders: boolean
  can_view_clients: boolean
}

export function useProfile() {
  return useQuery<Profile | null>({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, can_create_dispatches, can_manage_contracts, can_view_orders, can_view_clients')
        .eq('id', user.id)
        .maybeSingle()
      // Surface real failures (e.g. a missing column → 400) instead of silently
      // returning null, which would quietly downgrade every user to the rep view.
      // maybeSingle keeps a genuinely-absent row graceful (null, no throw).
      if (error) throw error
      return (data as Profile) ?? null
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function canManageContracts(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.can_manage_contracts
}

export function canCreateContracts(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.role === 'sales' || p.can_manage_contracts
}

export function canCreateDispatches(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.role === 'ops' || p.can_create_dispatches
}

export function canSeeFinancials(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.role === 'manager' || p.role === 'sales'
}

export function canViewOrders(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.role === 'manager' || p.role === 'sales' || p.can_view_orders
}

export function canViewClients(p: Profile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'admin' || p.role === 'manager' || p.role === 'sales' || p.can_view_clients
}
