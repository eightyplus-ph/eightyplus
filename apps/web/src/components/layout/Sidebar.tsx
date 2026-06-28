import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navLinks = [
  { label: 'Dashboard', href: '/' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'Receiving', href: '/receiving' },
  { label: 'Transfers', href: '/transfers' },
  { label: 'Product Names', href: '/lots' },
  { label: 'Locations', href: '/locations' },
  { label: 'Clients', href: '/clients' },
  { label: 'Orders', href: '/orders' },
  { label: 'Dispatches', href: '/dispatches' },
]

export default function Sidebar() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
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

  return (
    <aside className="fixed left-0 top-0 w-64 h-screen bg-white border-r border-gray-200 flex flex-col p-4 z-10">
      <div className="mb-6 px-2">
        <p className="font-bold text-xl text-gray-900">Eightyplus</p>
        <p className="text-xs text-gray-400 mt-0.5">Operations</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navLinks.map(({ label, href }) => {
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
        {userEmail && (
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
