/**
 * Matching an ordered lot to a contract line.
 *
 * There is no foreign key between `contract_items.product_name` (free text) and
 * `lots.name`. The association is made by significant-token overlap: normalise
 * both, drop tokens under three characters and a stop list of process/grade
 * words that appear on nearly every product, then pick the line sharing the
 * most tokens with the lot name.
 *
 * This lives here rather than inside a page because two surfaces depend on
 * agreeing exactly — the Contracts page draws down the schedule with it, and
 * the order form prices a line from it. If they ever disagree, an order would
 * be priced against one contract line and deducted from another.
 *
 * Known sharpness, worth stating: for a line called `Ethiopia Natural G2` the
 * only surviving token is `ethiopia`, so every Ethiopian lot matches it. Add a
 * second Ethiopia line to the same contract and the winner is whichever scores
 * first. A zero score means no match at all, which callers must handle — never
 * silently treat it as "the first line".
 */

const STOP = new Set([
  'the', 'and', 'natural', 'washed', 'anaerobic', 'slow', 'dry',
  'project', 'grade', 'screen', 'size', 'clean',
])

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const nameTokens = (s: string) =>
  normName(s).split(' ').filter(t => t.length > 2 && !STOP.has(t))

export interface MatchableLine { id: string; product_name: string }

/** The contract line a lot belongs to, or null when nothing overlaps. */
export function matchLotToContractLine<T extends MatchableLine>(
  lotName: string,
  lines: T[],
): { line: T; score: number } | null {
  const lot = normName(lotName)
  let best: T | null = null
  let bestScore = 0
  for (const line of lines) {
    const score = nameTokens(line.product_name).filter(t => lot.includes(t)).length
    if (score > bestScore) { bestScore = score; best = line }
  }
  return best && bestScore > 0 ? { line: best, score: bestScore } : null
}

/**
 * A match strong enough to PRICE an order from, which is a higher bar than the
 * one used to draw down a schedule.
 *
 * Measured against the live book on 2026-09-19, the loose rule was unusable for
 * pricing: the contract line `Brazil Cerrado` matched 10 of 51 lots on the token
 * `brazil` alone, and `Ethiopia Natural G2` matched 30 — every Ethiopian lot in
 * the catalogue. Locking a price off a one-token country match would quietly
 * bill Red Catuai at the Cerrado rate.
 *
 * So pricing requires: every significant token of the contract line present in
 * the lot name, at least two of them, and exactly one line qualifying. Anything
 * weaker or ambiguous returns null and the price stays editable — a human
 * deciding beats a confident wrong number.
 */
export function priceLineFor<T extends MatchableLine & { price_per_kg: string }>(
  lotName: string,
  lines: T[],
): T | null {
  const lot = normName(lotName)
  const qualifying = lines.filter(line => {
    const toks = nameTokens(line.product_name)
    return toks.length >= 2 && toks.every(t => lot.includes(t))
  })
  return qualifying.length === 1 ? qualifying[0] : null
}
