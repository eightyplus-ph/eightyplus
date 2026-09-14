import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Who buys this product, and when did they last do it.
 *
 * Two views over the same order lines: a per-client rollup sorted by most
 * recent purchase, and the raw line history underneath. Dispatched, reserved
 * and confirmed are all counted — excluding unshipped orders would hide the
 * most recent demand, which is the whole point of the panel.
 */

export interface LotSummary {
  id: string
  name: string
  origin: string
  region: string | null
  producer: string | null
  grade: string | null
  process: string | null
  price_per_kg: number | null
}

interface Line {
  weight_ordered_kg: number
  price_per_kg: number
  orders: {
    os_number: string
    order_date: string
    status: string
    clients: { company_name: string } | null
  } | null
}

/** Internal counterparties and event stalls — real rows, but not customers. */
const NON_CUSTOMER = /^(eighty\s*plus|sample beans|cofex)/i

/**
 * "Coffee Supply Co" and "Coffee Supply Co." are one buyer split across two
 * client rows. Fold on a normalized key so the rollup counts them once.
 */
const clientKey = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+$/, '')

const kg = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const peso = (v: number) => '₱' + Math.round(v).toLocaleString('en-US')
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US',
  { day: 'numeric', month: 'short', year: 'numeric' })

const sinceLabel = (d: string) => {
  const days = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

const statusVariant = (s: string) =>
  s === 'dispatched' ? 'success' : s === 'confirmed' ? 'info' : 'warning'

export default function LotHistoryDialog({ lot, onClose }: { lot: LotSummary; onClose: () => void }) {
  const { data: lines = [], isLoading } = useQuery<Line[]>({
    queryKey: ['lot-history', lot.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('weight_ordered_kg, price_per_kg, orders(os_number, order_date, status, clients(company_name))')
        .eq('lot_id', lot.id)
      if (error) throw error
      return (data ?? []) as unknown as Line[]
    },
  })

  const { data: stock } = useQuery({
    queryKey: ['lot-stock', lot.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('weight_kg')
        .eq('lot_id', lot.id)
      if (error) throw error
      const rows = data ?? []
      return { kg: rows.reduce((s, b) => s + Number(b.weight_kg ?? 0), 0), batches: rows.length }
    },
  })

  const { clients, history, realised } = useMemo(() => {
    const rows = lines
      .filter(l => l.orders)
      .map(l => ({
        client: l.orders!.clients?.company_name ?? 'Unnamed client',
        os: l.orders!.os_number,
        date: l.orders!.order_date,
        status: l.orders!.status,
        kg: Number(l.weight_ordered_kg ?? 0),
        price: Number(l.price_per_kg ?? 0),
      }))

    const map = new Map<string, {
      name: string; orders: Set<string>; kg: number; value: number; last: string; internal: boolean
    }>()
    for (const r of rows) {
      const key = clientKey(r.client)
      const e = map.get(key) ?? {
        name: r.client, orders: new Set<string>(), kg: 0, value: 0,
        last: r.date, internal: NON_CUSTOMER.test(r.client),
      }
      e.orders.add(r.os)
      e.kg += r.kg
      e.value += r.kg * r.price
      if (r.date > e.last) e.last = r.date
      // Keep the longest spelling — "Coffee Supply Co." over "Coffee Supply Co".
      if (r.client.length > e.name.length) e.name = r.client
      map.set(key, e)
    }

    // Zero-priced lines are internal transfers and roasting samples; they would
    // drag the realised price down without ever being a sale.
    const priced = rows.filter(r => r.price > 0).map(r => r.price)

    return {
      clients: [...map.values()].sort((a, b) => b.last.localeCompare(a.last)),
      history: rows.sort((a, b) => b.date.localeCompare(a.date)),
      realised: priced.length
        ? { min: Math.min(...priced), max: Math.max(...priced) }
        : null,
    }
  }, [lines])

  const facts = [lot.producer, lot.process, lot.grade, lot.region].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{lot.name}</CardTitle>
              <p className="text-sm text-gray-500 mt-1">{lot.origin}{facts && ` — ${facts}`}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-4 text-sm">
            <div>
              <span className="text-gray-500">List price </span>
              <span className="font-medium">{lot.price_per_kg ? `₱${Number(lot.price_per_kg).toLocaleString()}/kg` : '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">In stock </span>
              <span className="font-medium">{stock ? `${kg(stock.kg)} kg` : '…'}</span>
              {stock ? <span className="text-gray-400"> across {stock.batches} batch{stock.batches === 1 ? '' : 'es'}</span> : null}
            </div>
            {realised && (
              <div>
                <span className="text-gray-500">Sold between </span>
                <span className="font-medium">
                  {realised.min === realised.max
                    ? `₱${realised.min.toLocaleString()}/kg`
                    : `₱${realised.min.toLocaleString()}–₱${realised.max.toLocaleString()}/kg`}
                </span>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && <p className="text-gray-400 py-8 text-center text-sm">Loading history…</p>}

          {!isLoading && history.length === 0 && (
            <p className="text-gray-400 py-8 text-center text-sm">
              No one has ordered this product yet.
            </p>
          )}

          {!isLoading && history.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Buyers <span className="text-gray-400 font-normal">— {clients.length}, most recent first</span>
              </h3>
              <div className="overflow-x-auto mb-8">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Client</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Last ordered</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Orders</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Total kg</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map(c => (
                      <tr key={c.name} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {c.name}
                          {c.internal && <span className="ml-2 text-xs text-gray-400 font-normal">internal</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {day(c.last)}
                          <span className="text-gray-400 text-xs ml-1.5">{sinceLabel(c.last)}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{c.orders.size}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{kg(c.kg)}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{peso(c.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Every order <span className="text-gray-400 font-normal">— {history.length} lines</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">OS</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Client</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">kg</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">₱/kg</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Value</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={`${h.os}-${i}`} className="border-b border-gray-100">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{day(h.date)}</td>
                        <td className="px-3 py-2 text-gray-500">{h.os}</td>
                        <td className="px-3 py-2 text-gray-900">{h.client}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{kg(h.kg)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {h.price > 0 ? h.price.toLocaleString() : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{peso(h.kg * h.price)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={statusVariant(h.status)}>{h.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
