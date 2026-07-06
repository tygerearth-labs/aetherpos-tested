export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || typeof amount !== 'number' || isNaN(amount)) {
    return 'Rp0'
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || typeof num !== 'number' || isNaN(num)) {
    return '0'
  }
  return new Intl.NumberFormat('id-ID').format(num)
}
