import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { navForPath, canAccessModule } from '@/lib/nav'
import LoginPage from '@/pages/LoginPage'
import AppLayout from '@/components/layout/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import InventoryPage from '@/pages/InventoryPage'
import ReceivingPage from '@/pages/ReceivingPage'
import LotsPage from '@/pages/LotsPage'
import ClientsPage from '@/pages/ClientsPage'
import OrdersPage from '@/pages/OrdersPage'
import LocationsPage from '@/pages/LocationsPage'
import TransfersPage from '@/pages/TransfersPage'
import DispatchesPage from '@/pages/DispatchesPage'
import ContractsPage from '@/pages/ContractsPage'
import UsersPage from '@/pages/UsersPage'
import RepackPage from '@/pages/RepackPage'

const queryClient = new QueryClient()

function Router() {
  const path = window.location.pathname
  const { data: profile, isLoading } = useProfile()

  // Hiding the sidebar link was never enough — the route still rendered for
  // anyone who typed the URL. Gate on the same allowed_modules precedence the
  // sidebar uses, so "Dashboard only" means the other pages are unreachable.
  // Wait for the profile before judging; otherwise the first paint denies
  // access to everyone while the query is in flight.
  if (isLoading) {
    return <p className="text-gray-400 text-sm">Loading…</p>
  }
  const link = navForPath(path)
  if (link && !canAccessModule(profile, link.moduleKey)) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-2">No access</h1>
        <p className="text-sm text-gray-500">
          You don't have access to {link.label}. Ask an admin if you need it.
        </p>
      </div>
    )
  }

  if (path === '/inventory') return <InventoryPage />
  if (path === '/receiving') return <ReceivingPage />
  if (path === '/lots') return <LotsPage />
  if (path === '/clients') return <ClientsPage />
  if (path === '/orders') return <OrdersPage />
  if (path === '/dispatches') return <DispatchesPage />
  if (path === '/locations') return <LocationsPage />
  if (path === '/transfers') return <TransfersPage />
  if (path === '/repack') return <RepackPage />
  if (path === '/contracts') return <ContractsPage />
  if (path === '/users') return <UsersPage />
  return <DashboardPage />
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <span className="text-gray-400 text-sm">Loading…</span>
      </div>
    )
  }

  if (!session) return <LoginPage />

  return (
    <AppLayout>
      <Router />
    </AppLayout>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  )
}
