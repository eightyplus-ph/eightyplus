import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'

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
}

function StatCell({ kg, sacks }: { kg: number; sacks: number }) {
  return (
    <td className="px-4 py-3 text-right">
      <p className="text-gray-900 font-medium">{Math.round(kg)}</p>
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

export default function DashboardPage() {
  const { data: rows = [], isLoading } = useQuery<ProductRow[]>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      // Fetch batches (in-stock)
      const { data: batches, error: bErr } = await supabase
        .from('batches')
        .select('lot_id, weight_kg, sacks, lots(name)')
      if (bErr) throw bErr

      // Fetch active order items (reserved + confirmed)
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

      // Build per-lot map from batches
      const map = new Map<string, ProductRow>()
      for (const b of batches ?? []) {
        const lotId = b.lot_id as string
        const name = (b.lots as unknown as { name: string } | null)?.name ?? '—'
        const kg = parseFloat(b.weight_kg ?? '0')
        const sacks = (b.sacks as number | null) ?? 0
        if (!map.has(lotId)) {
          map.set(lotId, { lotId, name, inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0 })
        }
        const row = map.get(lotId)!
        row.inStockKg += kg
        row.inStockSacks += sacks
      }

      // Track which orders touch each lot (for open/dispatch counts)
      const lotReservedOrders = new Map<string, Set<string>>()
      const lotConfirmedOrders = new Map<string, Set<string>>()

      // Accumulate reserved kg per lot from order items
      for (const item of orderItems) {
        const lotId = item.lot_id as string
        const kg = parseFloat(item.weight_ordered_kg ?? '0')
        const orderId = item.order_id as string

        if (!map.has(lotId)) {
          map.set(lotId, { lotId, name: '—', inStockKg: 0, inStockSacks: 0, reservedKg: 0, reservedSacks: 0, availableKg: 0, availableSacks: 0, openOrderCount: 0, dispatchCount: 0 })
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

      // Compute derived fields
      for (const [lotId, row] of map) {
        const ratio = row.inStockKg > 0 ? row.reservedKg / row.inStockKg : 0
        row.reservedSacks = Math.round(row.inStockSacks * ratio)
        row.availableKg = Math.max(0, row.inStockKg - row.reservedKg)
        row.availableSacks = Math.max(0, row.inStockSacks - row.reservedSacks)
        row.openOrderCount = (lotReservedOrders.get(lotId)?.size ?? 0) + (lotConfirmedOrders.get(lotId)?.size ?? 0)
        row.dispatchCount = lotConfirmedOrders.get(lotId)?.size ?? 0
      }

      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  })

  const totalInStockKg = rows.reduce((s, r) => s + r.inStockKg, 0)
  const totalInStockSacks = rows.reduce((s, r) => s + r.inStockSacks, 0)
  const totalOpenOrders = rows.reduce((s, r) => s + r.openOrderCount, 0)
  const totalDispatch = rows.reduce((s, r) => s + r.dispatchCount, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Summary strip */}
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

      {/* Product overview table */}
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
              {rows.map(row => (
                <tr key={row.lotId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                  <StatCell kg={row.inStockKg} sacks={row.inStockSacks} />
                  <StatCell kg={row.reservedKg} sacks={row.reservedSacks} />
                  <StatCell kg={row.availableKg} sacks={row.availableSacks} />
                  <CountCell count={row.openOrderCount} />
                  <CountCell count={row.dispatchCount} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
