import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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

const queryClient = new QueryClient()

function Router() {
  const path = window.location.pathname
  if (path === '/inventory') return <InventoryPage />
  if (path === '/receiving') return <ReceivingPage />
  if (path === '/lots') return <LotsPage />
  if (path === '/clients') return <ClientsPage />
  if (path === '/orders') return <OrdersPage />
  if (path === '/dispatches') return <DispatchesPage />
  if (path === '/locations') return <LocationsPage />
  if (path === '/transfers') return <TransfersPage />
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
