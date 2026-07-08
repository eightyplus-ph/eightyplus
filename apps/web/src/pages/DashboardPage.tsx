import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { useProfile } from '@/lib/profile'
import { formatUnitsBySku, skuUnit } from '@/lib/sku'

interface LocationBreakdown {
  locationId: string
  locationName: string
  kg: number
  sacks: number
  skuType: string
  sackWeightKg: number | null
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
  inStockBySku: Record<string, number>
  locations: LocationBreakdown[]
}

function fmtKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${Math.round(kg).toLocaleString()} kg`
}

function StatCell({ kg, sacks, bySku }: { kg: number; sacks: number; bySku?: Record<string, number> }) {
  const sub = bySku ? formatUnitsBySku(bySku) : `${sacks} sacks`
  return (
    <td className="px-4 py-4 text-right align-top">
      <p className="font-semibold text-gray-900 tabular-nums">{fmtKg(kg)}</p>
      <p className="text-gray-400 text-xs tabular-nums mt-0.5">{sub}</p>
    </td>
  )
}

function StatCellSub({ kg, sacks, skuType }: { kg: number; sacks: number; skuType?: string }) {
  const unitLabel = skuUnit(skuType)
  return (
    <td className="px-4 py-2 text-right align-top">
      <p className="font-medium text-gray-700 text-xs tabular-nums">{fmtKg(kg)}</p>
      <p className="text-gray-400 text-xs tabular-nums mt-0.5">{sacks} {unitLabel}</p>
    </td>
  )
}

function CountCell({ count }: { count: number }) {
  return (
    <td className="px-4 py-4 text-center align-top">
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
        .select('lot_id, weight_kg, sacks, sku_type, sack_weight_kg, lots(name), location_id, locations(name)')
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
        const skuType = (b.sku_type as string | null) ?? 'commercial'
        const sackWeightKg = b.sack_weight_kg ? parseFloat(String(b.sack_weight_kg)) : null

        if (!map.has(lotId)) {
          map.set(lotId, { lotId, name, inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0, inStockBySku: {}, locations: [] })
          locMap.set(lotId, new Map())
        }
        const row = map.get(lotId)!
        row.inStockKg += kg
        row.inStockSacks += sacks
        row.inStockBySku[skuType] = (row.inStockBySku[skuType] ?? 0) + sacks

        const lm = locMap.get(lotId)!
        const locKey = `${locationId}::${skuType}::${sackWeightKg ?? ''}`
        if (!lm.has(locKey)) lm.set(locKey, { locationId, locationName, kg: 0, sacks: 0, skuType, sackWeightKg })
        const loc = lm.get(locKey)!
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
          map.set(lotId, { lotId, name: '—', inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0, inStockBySku: {}, locations: [] })
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
  const canSeeInventory = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'ops'
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

      {canSeeInventory && <Card>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Product Overview</p>
          {rows.length > 0 && (
            <button
              onClick={() => {
                const allOpen = rows.every(r => expanded.has(r.lotId))
                setExpanded(allOpen ? new Set() : new Set(rows.map(r => r.lotId)))
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {rows.every(r => expanded.has(r.lotId)) ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">In stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Reserved</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-32">Available</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Orders</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Dispatch</th>
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
                const uniqueLocations = [...new Set(row.locations.map(l => l.locationName))]
                const uniqueSkus = [...new Set(row.locations.map(l => l.skuType))]
                return (
                  <>
                    <tr
                      key={row.lotId}
                      onClick={() => toggleExpand(row.lotId)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${isExpanded ? 'bg-gray-50/60' : 'hover:bg-gray-50/60'}`}
                    >
                      <td className="px-4 py-4 align-top">
                        <div className="flex items-start gap-3">
                          <span className={`text-gray-400 text-xs mt-1 transition-transform duration-150 shrink-0 ${isExpanded ? 'rotate-90' : ''} inline-block`}>▶</span>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 leading-snug">{row.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {uniqueLocations.map(l => (
                                <span key={l} className="text-xs text-gray-400">{l}</span>
                              ))}
                              {uniqueLocations.length > 0 && uniqueSkus.length > 0 && <span className="text-gray-200 text-xs">·</span>}
                              {uniqueSkus.map(s => (
                                <span key={s} className="text-xs text-gray-400">{s === 'retail_1kg' ? '1 kg bags' : 'Commercial'}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <StatCell kg={row.inStockKg} sacks={row.inStockSacks} bySku={row.inStockBySku} />
                      <StatCell kg={row.reservedKg} sacks={row.reservedSacks} />
                      <StatCell kg={row.availableKg} sacks={row.availableSacks} />
                      <CountCell count={row.openOrderCount} />
                      <CountCell count={row.dispatchCount} />
                    </tr>
                    {isExpanded && row.locations.filter(loc => loc.kg > 0).map(loc => {
                      const derivedKgPerSk = (loc.sacks > 0 && loc.skuType !== 'retail_1kg') ? Math.round(loc.kg / loc.sacks) : null
                      const displayKgPerSk = loc.sackWeightKg ? Math.round(loc.sackWeightKg) : derivedKgPerSk
                      const skuLabel = loc.skuType === 'retail_1kg' ? '1 kg bags' : (displayKgPerSk ? `${displayKgPerSk} kg/sk` : 'commercial')
                      return (
                        <tr key={`${row.lotId}-${loc.locationId}-${loc.skuType}-${loc.sackWeightKg}`} className="border-b border-gray-100 bg-gray-50/40">
                          <td className="pl-12 pr-4 py-2.5 align-top">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-gray-200 text-xs text-gray-600 font-medium">{loc.locationName}</span>
                              <span className={`text-xs font-medium ${loc.skuType === 'retail_1kg' ? 'text-purple-600' : 'text-gray-400'}`}>{skuLabel}</span>
                            </div>
                          </td>
                          <StatCellSub kg={loc.kg} sacks={loc.sacks} skuType={loc.skuType} />
                          <td colSpan={4} />
                        </tr>
                      )
                    })}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>}
    </div>
  )
}
