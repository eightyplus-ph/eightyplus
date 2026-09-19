/**
 * The one definition of reserved and available.
 *
 * Before this existed, the Dashboard counted only `reserved`-status orders, the
 * order form counted nothing at all, and ad-hoc checks counted something else
 * again. The three disagreed, which is how nine products came to be sold beyond
 * their stock without anything objecting.
 *
 * Agreed with CK 2026-09-19:
 *
 *     reserved  = contract reservations
 *               + open orders (status reserved AND confirmed), less what has shipped
 *     available = on hand − reserved
 *
 * A confirmed order is as much a commitment as a reserved one — it is paid and
 * waiting for a truck. Excluding it overstated available by 26,893 kg on the day
 * the definition was agreed.
 */

export type OrderStatus = 'reserved' | 'confirmed' | 'dispatched'

/** Statuses that still hold stock. Dispatched has already left the building. */
export const COMMITTING_STATUSES: OrderStatus[] = ['reserved', 'confirmed']

export interface StockBatch {
  lot_id: string | null
  weight_kg: string | number
  /** Tagged to a contract line, so ring-fenced and not sellable to anyone else. */
  contract_item_id?: string | null
}

export interface CommittingLine {
  lot_id: string | null
  weight_ordered_kg: string | number
  dispatch_items?: { weight_dispatched_kg: string | number }[] | null
}

const num = (v: string | number | null | undefined) =>
  typeof v === 'number' ? v : parseFloat(v ?? '0') || 0

/** Ordered less already shipped — what a line still needs from stock. */
export const outstandingKg = (line: CommittingLine) =>
  Math.max(0, num(line.weight_ordered_kg) -
    (line.dispatch_items ?? []).reduce((s, d) => s + num(d.weight_dispatched_kg), 0))

export interface LotPosition {
  onHandKg: number
  contractReservedKg: number
  orderReservedKg: number
  reservedKg: number
  availableKg: number
}

/**
 * Position per lot. `lines` must already be filtered to orders that are open
 * (reserved or confirmed) and NOT archived — an archived order commits nothing.
 */
export function positionsByLot(
  batches: StockBatch[],
  lines: CommittingLine[],
): Map<string, LotPosition> {
  const out = new Map<string, LotPosition>()
  const blank = (): LotPosition => ({
    onHandKg: 0, contractReservedKg: 0, orderReservedKg: 0, reservedKg: 0, availableKg: 0,
  })

  for (const b of batches) {
    if (!b.lot_id) continue
    const p = out.get(b.lot_id) ?? blank()
    const kg = num(b.weight_kg)
    p.onHandKg += kg
    if (b.contract_item_id) p.contractReservedKg += kg
    out.set(b.lot_id, p)
  }
  for (const l of lines) {
    if (!l.lot_id) continue
    const p = out.get(l.lot_id) ?? blank()
    p.orderReservedKg += outstandingKg(l)
    out.set(l.lot_id, p)
  }
  for (const p of out.values()) {
    p.reservedKg = p.contractReservedKg + p.orderReservedKg
    // Never negative: over-committed stock is a shortage, reported elsewhere as
    // such, not a negative availability that would read as a credit.
    p.availableKg = Math.max(0, p.onHandKg - p.reservedKg)
  }
  return out
}

/** Available for one lot; 0 when the lot is unknown. */
export const availableForLot = (positions: Map<string, LotPosition>, lotId: string) =>
  positions.get(lotId)?.availableKg ?? 0
