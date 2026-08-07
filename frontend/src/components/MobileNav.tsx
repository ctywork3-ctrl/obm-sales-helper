import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ListOrdered,
  Users,
  ClipboardList,
  Settings,
  UsersRound,
  Shield,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  roles?: string[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: 'Products', href: '/products', icon: <Package className="h-5 w-5" /> },
  { label: 'My Customers', href: '/sales/customers', icon: <UsersRound className="h-5 w-5" />, roles: ['OUTSIDE_SALES', 'INSIDE_SALES'] },
  { label: 'Create Order', href: '/sales/create', icon: <ShoppingCart className="h-5 w-5" />, roles: ['OUTSIDE_SALES'] },
  { label: 'My Orders', href: '/sales/my-orders', icon: <ListOrdered className="h-5 w-5" />, roles: ['OUTSIDE_SALES'] },
  { label: 'All Orders', href: '/sales/all-orders', icon: <ClipboardList className="h-5 w-5" />, roles: ['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER'] },
]

const adminItems: NavItem[] = [
  { label: 'Users', href: '/admin/users', icon: <Users className="h-5 w-5" />, roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Products', href: '/admin/products', icon: <Package className="h-5 w-5" />, roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Customers', href: '/admin/customers', icon: <UsersRound className="h-5 w-5" />, roles: ['IT_ADMIN', 'INSIDE_SALES'] },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: <ClipboardList className="h-5 w-5" />, roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Settings', href: '/admin/settings', icon: <Settings className="h-5 w-5" />, roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Role Permissions', href: '/admin/role-permissions', icon: <Shield className="h-5 w-5" />, roles: ['IT_ADMIN', 'DEVELOPER'] },
]

interface MobileNavProps {
  open: boolean
  onClose: () => void
}

export default function MobileNav({ open, onClose }: MobileNavProps) {
  const { user } = useAuth()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const canSeeItem = (item: NavItem) => {
    if (!item.roles) return true
    return item.roles.includes(user?.role || '')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <aside className="fixed inset-y-0 left-0 w-72 bg-white shadow-lg">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <h1 className="text-lg font-bold text-primary">OBM Helper</h1>
          <button onClick={onClose} className="p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1 p-2">
          {navItems.filter(canSeeItem).map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          {adminItems.some(canSeeItem) && (
            <div className="pt-4">
              <p className="mb-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
                Admin
              </p>
              {adminItems.filter(canSeeItem).map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </nav>
      </aside>
    </div>
  )
}
