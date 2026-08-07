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
    case 'KEYED_TO_OBM': return 'bg-green-100 text-green-800'
    case 'REJECTED': return 'bg-red-100 text-red-800'
    case 'CANCELLED': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

export function getRoleDisplayName(role: string): string {
  switch (role) {
    case 'IT_ADMIN': return 'IT Admin'
    case 'DEVELOPER': return 'Developer'
    case 'INSIDE_SALES': return 'Inside Sales'
    case 'OUTSIDE_SALES': return 'Outside Sales'
    default: return role?.replace(/_/g, ' ') || role
  }
}
