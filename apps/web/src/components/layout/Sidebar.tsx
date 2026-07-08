import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useProfile, type Profile } from '@/lib/profile'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface NavLink {
  label: string
  href: string
  moduleKey: string
  defaultRoles?: string[]
  checkFn?: (p: Profile | null) => boolean
}

const ALL_NAV: NavLink[] = [
  { label: 'Dashboard',     href: '/',           moduleKey: 'dashboard' },
  { label: 'Inventory',     href: '/inventory',  moduleKey: 'inventory' },
  { label: 'Receiving',     href: '/receiving',  moduleKey: 'receiving',  defaultRoles: ['admin', 'ops'] },
  { label: 'Transfers',     href: '/transfers',  moduleKey: 'transfers',  defaultRoles: ['admin', 'ops'] },
  { label: 'Repack',        href: '/repack',     moduleKey: 'repack',     defaultRoles: ['admin', 'ops'] },
  { label: 'Product Names', href: '/lots',       moduleKey: 'lots' },
  { label: 'Locations',     href: '/locations',  moduleKey: 'locations',  defaultRoles: ['admin', 'ops', 'manager'] },
  { label: 'Clients',       href: '/clients',    moduleKey: 'clients',    defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Orders',        href: '/orders',     moduleKey: 'orders',     defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Dispatches',    href: '/dispatches', moduleKey: 'dispatches', defaultRoles: ['admin', 'ops', 'sales'] },
  { label: 'Contracts',     href: '/contracts',  moduleKey: 'contracts',  defaultRoles: ['admin', 'manager', 'sales'] },
  { label: 'Users',         href: '/users',      moduleKey: 'users',      defaultRoles: ['admin'] },
]

export default function Sidebar() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const { data: profile } = useProfile()
  const path = window.location.pathname

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
    })
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const visibleLinks = ALL_NAV.filter(link => {
    if (!profile) return true
    if (profile.role === 'admin') return true
    if (profile.allowed_modules) return profile.allowed_modules.includes(link.moduleKey)
    if (!link.defaultRoles) return true
    return link.defaultRoles.includes(profile.role)
  })

  return (
    <aside className="fixed left-0 top-0 w-64 h-screen bg-white border-r border-gray-200 flex flex-col p-4 z-10">
      <div className="mb-6 px-2">
        <p className="font-bold text-xl text-gray-900">Eightyplus</p>
        <p className="text-xs text-gray-400 mt-0.5">Operations</p>
      </div>

      <nav className="flex-1 space-y-1">
        {visibleLinks.map(({ label, href }) => {
          const isActive = path === href
          return (
            <a
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              {label}
            </a>
          )
        })}
      </nav>

      <div className="border-t border-gray-200 pt-4 space-y-2">
        {profile && (
          <div className="px-2">
            <p className="text-xs font-medium text-gray-700">{profile.full_name}</p>
            <p className="text-xs text-gray-400 capitalize">{profile.role}</p>
          </div>
        )}
        {userEmail && !profile && (
          <p className="text-xs text-gray-400 px-2 truncate">{userEmail}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={handleSignOut}
        >
          Sign Out
        </Button>
      </div>
    </aside>
  )
}
