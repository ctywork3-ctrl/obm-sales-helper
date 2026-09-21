import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  LayoutDashboard, Package, ShoppingCart, ListOrdered, Users,
  ClipboardList, Settings, UsersRound, Shield, Search,
  MapPin, X, ArrowRight,
} from 'lucide-react'

interface CommandItem {
  label: string
  href: string
  icon: React.ReactNode
  keywords: string
  roles?: string[]
}

const commands: CommandItem[] = [
  { label: 'Dashboard', href: '/app', icon: <LayoutDashboard className="h-4 w-4" />, keywords: 'home overview dashboard', roles: [] },
  { label: 'Products', href: '/app/products', icon: <Package className="h-4 w-4" />, keywords: 'inventory stock items products', roles: [] },
  { label: 'My Customers', href: '/app/sales/customers', icon: <UsersRound className="h-4 w-4" />, keywords: 'clients accounts customers', roles: ['OUTSIDE_SALES', 'INSIDE_SALES'] },
  { label: 'Create Order', href: '/app/sales/create', icon: <ShoppingCart className="h-4 w-4" />, keywords: 'new purchase draft create order', roles: ['OUTSIDE_SALES'] },
  { label: 'My Orders', href: '/app/sales/my-orders', icon: <ListOrdered className="h-4 w-4" />, keywords: 'sales my orders', roles: ['OUTSIDE_SALES'] },
  { label: 'All Orders', href: '/app/sales/all-orders', icon: <ClipboardList className="h-4 w-4" />, keywords: 'all sales list orders', roles: ['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Reports', href: '/app/admin/reports', icon: <ClipboardList className="h-4 w-4" />, keywords: 'reports sales inventory commission export', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Salesman Map', href: '/app/admin/salesman-map', icon: <MapPin className="h-4 w-4" />, keywords: 'location tracking map salesman', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Scan Item', href: '/app/warehouse/scanner', icon: <Package className="h-4 w-4" />, keywords: 'scan barcode unit warehouse', roles: ['STOCK_KEEPER', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Goods Received', href: '/app/warehouse/receiving', icon: <Package className="h-4 w-4" />, keywords: 'receive stock inventory shipment warehouse', roles: ['STOCK_KEEPER', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Fix Stock Count', href: '/app/warehouse/adjustment', icon: <Package className="h-4 w-4" />, keywords: 'adjust correction damage stock inventory', roles: ['STOCK_KEEPER', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Received History', href: '/app/warehouse/receipts', icon: <ClipboardList className="h-4 w-4" />, keywords: 'goods receipt history delivery note inventory', roles: ['STOCK_KEEPER', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Supplier PO', href: '/app/purchase-orders', icon: <ClipboardList className="h-4 w-4" />, keywords: 'purchase order supplier po procurement receiving task', roles: ['STOCK_KEEPER', 'IT_ADMIN', 'DEVELOPER', 'MANAGER'] },

  { label: 'Customer Assignments', href: '/app/admin/customers', icon: <Users className="h-4 w-4" />, keywords: 'assign salesman customer territory', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Manage Users', href: '/app/admin/users', icon: <Users className="h-4 w-4" />, keywords: 'staff team accounts users', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Manage Products', href: '/app/admin/products', icon: <Package className="h-4 w-4" />, keywords: 'admin catalog products', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'Manage Categories', href: '/app/admin/categories', icon: <Package className="h-4 w-4" />, keywords: 'product categories master data', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'] },
  { label: 'New Item Requests', href: '/app/admin/intake-requests', icon: <ClipboardList className="h-4 w-4" />, keywords: 'unknown products receiving review new item request', roles: ['MANAGER', 'IT_ADMIN', 'DEVELOPER'] },
  { label: 'Manage Customers', href: '/app/admin/customers', icon: <UsersRound className="h-4 w-4" />, keywords: 'admin clients customers', roles: ['IT_ADMIN', 'INSIDE_SALES', 'MANAGER'] },
  { label: 'Activity', href: '/app/admin/activity', icon: <ClipboardList className="h-4 w-4" />, keywords: 'audit logs timeline analytics activity', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Settings', href: '/app/admin/settings', icon: <Settings className="h-4 w-4" />, keywords: 'config preferences settings', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Menu Access', href: '/app/admin/role-permissions', icon: <Shield className="h-4 w-4" />, keywords: 'roles access permissions role menu pages', roles: ['IT_ADMIN', 'DEVELOPER'] },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return commands.filter((cmd) => {
      if (cmd.roles && cmd.roles.length > 0) {
        if (!cmd.roles.includes(user?.role || '')) return false
      }
      if (!q) return true
      return cmd.label.toLowerCase().includes(q) || cmd.keywords.includes(q)
    })
  }, [query, user?.role])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelect = (href: string) => {
    navigate(href)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex].href)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]" onKeyDown={handleKeyDown}>
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="fixed inset-x-0 top-[15%] mx-auto max-w-lg px-4">
        <div className="overflow-hidden rounded-xl border bg-white shadow-2xl">
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent py-3 text-sm outline-none"
            />
            <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-500">
                No results found.
              </div>
            )}
            {filtered.map((cmd, i) => (
              <button
                key={cmd.href}
                onClick={() => handleSelect(cmd.href)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-gray-100'
                    : 'hover:bg-gray-50'
                }`}
              >
                <span className="text-gray-500">{cmd.icon}</span>
                <span className="flex-1 text-left text-gray-700">{cmd.label}</span>
                <ArrowRight className="h-3 w-3 text-gray-300" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-gray-400">
            <span><kbd className="rounded border bg-gray-50 px-1">↑↓</kbd> navigate</span>
            <span><kbd className="rounded border bg-gray-50 px-1">↵</kbd> select</span>
            <span><kbd className="rounded border bg-gray-50 px-1">Esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
