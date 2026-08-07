import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useRolePermissions } from '@/hooks/useRolePermissions'
import { cn } from '@/lib/utils'
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
  pageKey: string
  roles?: string[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" />, pageKey: 'dashboard' },
  { label: 'Products', href: '/products', icon: <Package className="h-5 w-5" />, pageKey: 'products' },
  { label: 'My Customers', href: '/sales/customers', icon: <UsersRound className="h-5 w-5" />, pageKey: 'sales_customers', roles: ['OUTSIDE_SALES', 'INSIDE_SALES'] },
  { label: 'Create Order', href: '/sales/create', icon: <ShoppingCart className="h-5 w-5" />, pageKey: 'sales_create', roles: ['OUTSIDE_SALES'] },
  { label: 'My Orders', href: '/sales/my-orders', icon: <ListOrdered className="h-5 w-5" />, pageKey: 'sales_my_orders', roles: ['OUTSIDE_SALES'] },
  { label: 'All Orders', href: '/sales/all-orders', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'sales_all_orders', roles: ['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER'] },
]

const adminItems: NavItem[] = [
  { label: 'Users', href: '/admin/users', icon: <Users className="h-5 w-5" />, pageKey: 'admin_users', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Products', href: '/admin/products', icon: <Package className="h-5 w-5" />, pageKey: 'admin_products', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Customers', href: '/admin/customers', icon: <UsersRound className="h-5 w-5" />, pageKey: 'admin_customers', roles: ['IT_ADMIN', 'INSIDE_SALES'] },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'admin_audit_logs', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Settings', href: '/admin/settings', icon: <Settings className="h-5 w-5" />, pageKey: 'admin_settings', roles: ['IT_ADMIN', 'DEVELOPER'] },
  { label: 'Role Permissions', href: '/admin/role-permissions', icon: <Shield className="h-5 w-5" />, pageKey: 'admin_role_permissions', roles: ['IT_ADMIN', 'DEVELOPER'] },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth()
  const { data: rolePermissions } = useRolePermissions()

  const getPageVisible = (pageKey: string): boolean => {
    if (!rolePermissions || !user) return true

    const userRoleData = rolePermissions.find((rp) => rp.role === user.role)
    if (!userRoleData || userRoleData.pages.length === 0) return true

    const pagePerm = userRoleData.pages.find((p) => p.page_key === pageKey)
    if (!pagePerm) return true

    return pagePerm.is_visible
  }

  const canSeeItem = (item: NavItem) => {
    if (item.roles && !item.roles.includes(user?.role || '')) return false
    if (!getPageVisible(item.pageKey)) return false
    return true
  }

  return (
    <>
      <aside className="hidden w-64 flex-shrink-0 border-r bg-white lg:block">
        <div className="flex h-14 items-center border-b px-4">
          <h1 className="text-lg font-bold text-primary">OBM Helper</h1>
        </div>
        <nav className="space-y-1 p-2">
          {navItems.filter(canSeeItem).map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === '/'}
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
    </>
  )
}
