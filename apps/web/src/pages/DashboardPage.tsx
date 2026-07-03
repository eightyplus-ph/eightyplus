import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { useProfile } from '@/lib/profile'

interface LocationBreakdown {
  locationId: string
  locationName: string
  kg: number
  sacks: number
}

interface ProductRow {
  lotId: string
  name: string
  inStockKg: number
  inStockSacks: number
  reservedKg: number
  reservedSacks: number
  availableKg: number
  availableSacks: number
  openOrderCount: number
  dispatchCount: number
  locations: LocationBreakdown[]
}

function StatCell({ kg, sacks }: { kg: number; sacks: number }) {
  return (
    <td className="px-4 py-3 text-right">
      <p className="text-gray-900 font-medium">{Math.round(kg)}</p>
      <p className="text-gray-400 text-xs">{sacks} sacks</p>
    </td>
  )
}

function StatCellSub({ kg, sacks }: { kg: number; sacks: number }) {
  return (
    <td className="px-4 py-2 text-right">
      <p className="text-gray-600 text-xs">{Math.round(kg)} kg</p>
      <p className="text-gray-400 text-xs">{sacks} sacks</p>
    </td>
  )
}

function CountCell({ count }: { count: number }) {
  return (
    <td className="px-4 py-3 text-center">
      {count > 0
        ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">{count}</span>
        : <span className="text-gray-300 text-xs">—</span>}
    </td>
  )
}

interface SalesRepRow { repId: string; repName: string; orderCount: number; totalValue: number }

const fmt = (n: number) => `₱${Math.round(n).toLocaleString()}`
const monthLabel = () => new Date().toLocaleString('default', { month: 'long', year: 'numeric' })

export default function DashboardPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data: profile } = useProfile()

  const toggleExpand = (lotId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.add(lotId)
      return next
    })
  }

  const { data: rows = [], isLoading } = useQuery<ProductRow[]>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data: batches, error: bErr } = await supabase
        .from('batches')
        .select('lot_id, weight_kg, sacks, lots(name), location_id, locations(name)')
      if (bErr) throw bErr

      const { data: activeOrders, error: oErr } = await supabase
        .from('orders')
        .select('id, status')
        .in('status', ['reserved', 'confirmed'])
      if (oErr) throw oErr

      const activeOrderIds = (activeOrders ?? []).map(o => o.id)
      const reservedOrderIds = new Set((activeOrders ?? []).filter(o => o.status === 'reserved').map(o => o.id))
      const confirmedOrderIds = new Set((activeOrders ?? []).filter(o => o.status === 'confirmed').map(o => o.id))

      let orderItems: { lot_id: string; weight_ordered_kg: string; order_id: string }[] = []
      if (activeOrderIds.length > 0) {
        const { data: items } = await supabase
          .from('order_items')
          .select('lot_id, weight_ordered_kg, order_id')
          .in('order_id', activeOrderIds)
        orderItems = (items ?? []) as typeof orderItems
      }

      const map = new Map<string, ProductRow>()
      // per-lot per-location breakdown
      const locMap = new Map<string, Map<string, LocationBreakdown>>()

      for (const b of batches ?? []) {
        const lotId = b.lot_id as string
        const name = (b.lots as unknown as { name: string } | null)?.name ?? '—'
        const kg = parseFloat(b.weight_kg ?? '0')
        const sacks = (b.sacks as number | null) ?? 0
        const locationId = (b.location_id as string | null) ?? 'unknown'
        const locationName = (b.locations as unknown as { name: string } | null)?.name ?? 'Unknown'

        if (!map.has(lotId)) {
          map.set(lotId, { lotId, name, inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0, locations: [] })
          locMap.set(lotId, new Map())
        }
        const row = map.get(lotId)!
        row.inStockKg += kg
        row.inStockSacks += sacks

        const lm = locMap.get(lotId)!
        if (!lm.has(locationId)) lm.set(locationId, { locationId, locationName, kg: 0, sacks: 0 })
        const loc = lm.get(locationId)!
        loc.kg += kg
        loc.sacks += sacks
      }

      const lotReservedOrders = new Map<string, Set<string>>()
      const lotConfirmedOrders = new Map<string, Set<string>>()

      for (const item of orderItems) {
        const lotId = item.lot_id as string
        const kg = parseFloat(item.weight_ordered_kg ?? '0')
        const orderId = item.order_id as string

        if (!map.has(lotId)) {
          map.set(lotId, { lotId, name: '—', inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0, locations: [] })
        }
        const row = map.get(lotId)!

        if (reservedOrderIds.has(orderId)) {
          row.reservedKg += kg
          if (!lotReservedOrders.has(lotId)) lotReservedOrders.set(lotId, new Set())
          lotReservedOrders.get(lotId)!.add(orderId)
        }
        if (confirmedOrderIds.has(orderId)) {
          if (!lotConfirmedOrders.has(lotId)) lotConfirmedOrders.set(lotId, new Set())
          lotConfirmedOrders.get(lotId)!.add(orderId)
        }
      }

      for (const [lotId, row] of map) {
        const ratio = row.inStockKg > 0 ? row.reservedKg / row.inStockKg : 0
        row.reservedSacks = Math.round(row.inStockSacks * ratio)
        row.availableKg = Math.max(0, row.inStockKg - row.reservedKg)
        row.availableSacks = Math.max(0, row.inStockSacks - row.reservedSacks)
        row.openOrderCount = (lotReservedOrders.get(lotId)?.size ?? 0) + (lotConfirmedOrders.get(lotId)?.size ?? 0)
        row.dispatchCount = lotConfirmedOrders.get(lotId)?.size ?? 0
        row.locations = [...(locMap.get(lotId)?.values() ?? [])].sort((a, b) => a.locationName.localeCompare(b.locationName))
      }

      const key = (name: string) => name.replace(/\s*·\s*/g, ' ').toLowerCase()
      return [...map.values()].sort((a, b) => key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0)
    },
  })

  const { data: salesRows = [] } = useQuery<SalesRepRow[]>({
    queryKey: ['sales-this-month'],
    queryFn: async () => {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('orders')
        .select('id, created_by, profiles(full_name), order_items(weight_ordered_kg, price_per_kg)')
        .gte('order_date', monthStart)
        .lte('order_date', monthEnd)
      if (error) throw error
      const map = new Map<string, SalesRepRow>()
      for (const o of data ?? []) {
        const repId = (o.created_by as string | null) ?? 'unknown'
        const repName = (o.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Unassigned'
        const value = ((o.order_items as { weight_ordered_kg: string; price_per_kg: string }[]) ?? [])
          .reduce((s, i) => s + parseFloat(i.weight_ordered_kg) * parseFloat(i.price_per_kg), 0)
        if (!map.has(repId)) map.set(repId, { repId, repName, orderCount: 0, totalValue: 0 })
        const row = map.get(repId)!
        row.orderCount += 1
        row.totalValue += value
      }
      return [...map.values()].sort((a, b) => b.totalValue - a.totalValue)
    },
    staleTime: 5 * 60 * 1000,
  })

  const isAdminOrManager = profile?.role === 'admin' || profile?.role === 'manager'
  const mySales = salesRows.find(r => r.repId === profile?.id)

  const { data: myStats } = useQuery({
    queryKey: ['my-stats', profile?.id],
    enabled: !!profile && !isAdminOrManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('status')
        .eq('created_by', profile!.id)
        .in('status', ['reserved', 'confirmed'])
      if (error) throw error
      const openOrders = (data ?? []).length
      const forDispatch = (data ?? []).filter(o => o.status === 'confirmed').length
      return { openOrders, forDispatch }
    },
    staleTime: 5 * 60 * 1000,
  })

  const totalInStockKg = rows.reduce((s, r) => s + r.inStockKg, 0)
  const totalInStockSacks = rows.reduce((s, r) => s + r.inStockSacks, 0)
  const totalOpenOrders = rows.reduce((s, r) => s + r.openOrderCount, 0)
  const totalDispatch = rows.reduce((s, r) => s + r.dispatchCount, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {isAdminOrManager ? (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">Total Stock</p>
            <p className="text-2xl font-bold text-gray-900">{Math.round(totalInStockKg)} kg</p>
            <p className="text-xs text-gray-400 mt-0.5">{totalInStockSacks} sacks · {rows.length} products</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">Open Orders</p>
            <p className="text-2xl font-bold text-gray-900">{totalOpenOrders > 0 ? totalOpenOrders : '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">{totalOpenOrders === 1 ? '1 order' : totalOpenOrders > 1 ? `${totalOpenOrders} orders` : 'none active'}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">For Dispatch</p>
            <p className="text-2xl font-bold text-gray-900">{totalDispatch > 0 ? totalDispatch : '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">{totalDispatch === 1 ? '1 confirmed order' : totalDispatch > 1 ? `${totalDispatch} confirmed orders` : 'none confirmed'}</p>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">{profile?.full_name ?? 'My'} Sales — {monthLabel()}</p>
            <p className="text-2xl font-bold text-gray-900">{mySales ? fmt(mySales.totalValue) : '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">{mySales?.orderCount ?? 0} orders this month</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">Open Orders</p>
            <p className="text-2xl font-bold text-gray-900">{myStats?.openOrders ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">reserved or confirmed</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500 mb-1">For Dispatch</p>
            <p className="text-2xl font-bold text-gray-900">{myStats?.forDispatch ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">confirmed orders</p>
          </Card>
        </div>
      )}

      {isAdminOrManager && salesRows.length > 0 && (
        <Card className="mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700">Sales This Month — {monthLabel()}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Sales Rep</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Orders</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {salesRows.map(r => (
                <tr key={r.repId} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.repName}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{r.orderCount}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(r.totalValue)}</td>
                </tr>
              ))}
              {salesRows.length > 1 && (
                <tr className="bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">Total</td>
                  <td className="px-4 py-3 text-right text-gray-700">{salesRows.reduce((s, r) => s + r.orderCount, 0)}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(salesRows.reduce((s, r) => s + r.totalValue, 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">Product Overview</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Product</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">In Stock</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Reserved</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Available</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Orders</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No stock yet.</td></tr>
              )}
              {rows.map(row => {
                const isExpanded = expanded.has(row.lotId)
                const hasMultipleLocations = row.locations.length > 1
                return (
                  <>
                    <tr
                      key={row.lotId}
                      onClick={() => hasMultipleLocations && toggleExpand(row.lotId)}
                      className={`border-b border-gray-100 ${hasMultipleLocations ? 'cursor-pointer hover:bg-gray-50' : ''} ${isExpanded ? 'bg-gray-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs">
                        <div className="flex items-center gap-2">
                          {hasMultipleLocations && (
                            <span className="text-gray-400 text-xs select-none shrink-0">{isExpanded ? '▾' : '▸'}</span>
                          )}
                          <span className="truncate" title={row.name}>{row.name}</span>
                        </div>
                      </td>
                      <StatCell kg={row.inStockKg} sacks={row.inStockSacks} />
                      <StatCell kg={row.reservedKg} sacks={row.reservedSacks} />
                      <StatCell kg={row.availableKg} sacks={row.availableSacks} />
                      <CountCell count={row.openOrderCount} />
                      <CountCell count={row.dispatchCount} />
                    </tr>
                    {isExpanded && row.locations.map(loc => (
                      <tr key={`${row.lotId}-${loc.locationId}`} className="border-b border-gray-100 bg-gray-50/70">
                        <td className="pl-10 pr-4 py-2 text-gray-500 text-xs">{loc.locationName}</td>
                        <StatCellSub kg={loc.kg} sacks={loc.sacks} />
                        <td colSpan={4} />
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
