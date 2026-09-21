import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = 'MYR'): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: currency,
  }).format(amount)
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT': return 'bg-gray-100 text-gray-800'
    case 'SUBMITTED': return 'bg-blue-100 text-blue-800'
    case 'APPROVED': return 'bg-emerald-100 text-emerald-800'
    case 'KEYED_TO_OBM': return 'bg-green-100 text-green-800'
    case 'REJECTED': return 'bg-red-100 text-red-800'
    case 'CANCELLED': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

/** Roles in rough seniority order — used by the user form and role pickers. */
export const ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'DIRECTOR', label: 'Director', description: 'Oversight, approvals and reports' },
  { value: 'OPERATIONS_MANAGER', label: 'Operations Manager', description: 'Runs orders, stock and warehouse flow' },
  { value: 'PURCHASE_MANAGER', label: 'Purchase Manager', description: 'Suppliers, purchase orders and receiving tasks' },
  { value: 'MANAGER', label: 'Manager', description: 'General manager access' },
  { value: 'INSIDE_SALES', label: 'Inside Sales', description: 'Reviews and keys in orders' },
  { value: 'OUTSIDE_SALES', label: 'Outside Sales', description: 'Field sales, creates orders' },
  { value: 'STOCK_KEEPER', label: 'Store Keeper', description: 'Receiving, scanning and stock counts' },
  { value: 'IT_ADMIN', label: 'IT Admin', description: 'Users, settings and master data' },
  { value: 'DEVELOPER', label: 'Developer', description: 'Full system access' },
]

const ROLE_LABELS: Record<string, string> = ROLE_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.label }),
  {} as Record<string, string>,
)

export function getRoleDisplayName(role: string): string {
  return ROLE_LABELS[role] || role?.replace(/_/g, ' ') || role
}

/** Roles that can be handed a receiving task. */
export const WORKER_ROLES = [
  'STOCK_KEEPER',
  'OPERATIONS_MANAGER',
  'MANAGER',
  'PURCHASE_MANAGER',
  'IT_ADMIN',
  'DEVELOPER',
]

// --- Discount helpers ----------------------------------------------------

export const DISCOUNT_TYPES = [
  { value: 'NONE', label: 'No discount' },
  { value: 'PERCENT', label: '%' },
  { value: 'AMOUNT', label: 'RM' },
]

/**
 * Mirror of the server's discount maths so the draft screen shows the same
 * numbers before saving. `base` is the gross amount the discount applies to.
 */
export function computeDiscount(base: number, type: string, value: number): number {
  const amount = Number(base) || 0
  const raw = Number(value) || 0
  if (type === 'PERCENT') {
    const pct = Math.min(Math.max(raw, 0), 100)
    return round2((amount * pct) / 100)
  }
  if (type === 'AMOUNT') {
    return round2(Math.min(Math.max(raw, 0), amount))
  }
  return 0
}

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function discountLabel(type: string, value: number): string {
  if (type === 'PERCENT') return `${value}%`
  if (type === 'AMOUNT') return formatCurrency(value)
  return '—'
}

export function effectiveDiscountPercent(gross: number, discount: number): number {
  if (!gross) return 0
  return round2((discount / gross) * 100)
}

/** "twelve thousand three hundred and forty five ringgit and fifty sen" */
export function amountInWords(amount: number, currency = 'RINGGIT MALAYSIA'): string {
  const value = round2(amount)
  const sen = Math.round((value - Math.floor(value)) * 100)
  const whole = Math.floor(value)
  if (whole === 0 && sen === 0) return `ZERO ${currency} ONLY`

  const words = numberToWords(whole).trim().toUpperCase()
  let result = `${words} ${currency}`
  if (sen > 0) {
    result += ` AND ${numberToWords(sen).trim().toUpperCase()} SEN`
  }
  return `${result} ONLY`
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function numberToWords(value: number): string {
  if (value < 0) return `minus ${numberToWords(-value)}`
  if (value < 20) return ONES[value]
  if (value < 100) {
    const rest = value % 10
    return `${TENS[Math.floor(value / 10)]}${rest ? `-${ONES[rest]}` : ''}`
  }
  if (value < 1000) {
    const rest = value % 100
    return `${ONES[Math.floor(value / 100)]} hundred${rest ? ` and ${numberToWords(rest)}` : ''}`
  }
  const scales: [number, string][] = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ]
  for (const [scale, name] of scales) {
    if (value >= scale) {
      const rest = value % scale
      return `${numberToWords(Math.floor(value / scale))} ${name}${rest ? ` ${numberToWords(rest)}` : ''}`
    }
  }
  return String(value)
}
