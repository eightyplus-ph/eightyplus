// SKU display helpers — one source of truth for how a bean's packaging reads.

export const SKU_LABEL: Record<string, string> = {
  commercial: 'Commercial',
  retail_1kg: '1 kg retail',
}

// The unit a SKU is counted in.
export const SKU_UNIT: Record<string, string> = {
  commercial: 'sacks',
  retail_1kg: 'bags',
}

export const skuUnit = (skuType?: string | null): string => SKU_UNIT[skuType ?? ''] ?? 'sacks'
export const skuLabel = (skuType?: string | null): string => SKU_LABEL[skuType ?? ''] ?? (skuType ?? '')

// A fixed-weight SKU (e.g. 1 kg bags) can be counted by units exactly.
export const isFixedWeightSku = (skuType?: string | null): boolean => skuType === 'retail_1kg'

// "379 sacks · 240 bags" — per-SKU unit counts, in a stable order, skipping zeros.
export function formatUnitsBySku(bySku: Record<string, number>): string {
  const order = ['commercial', 'retail_1kg']
  return Object.entries(bySku)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([sku, n]) => `${n} ${skuUnit(sku)}`)
    .join(' · ')
}
