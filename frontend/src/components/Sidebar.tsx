import { useState, useEffect } from 'react'
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
  PanelLeftClose,
  PanelLeftOpen,
  MapPin,
  BarChart3,
  Warehouse,
  ClipboardCheck,
  ScanLine,
  PackageCheck,
  SlidersHorizontal,
  History,
  MapPinned,
  ShieldCheck,
  Truck,
  Palette,
  Tags,
  PackageX,
  ArrowRightLeft,
  Building2,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  pageKey: string
  roles?: string[]
  tooltip: string
}

interface NavSection {
  title: string | null
  items: NavItem[]
}

// Roles that work with physical goods.
const WAREHOUSE_ROLES = [
  'STOCK_KEEPER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER',
  'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'DIRECTOR',
]
const BUYING_ROLES = ['PURCHASE_MANAGER', 'OPERATIONS_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER', 'DIRECTOR']
const OVERSIGHT_ROLES = ['DIRECTOR', 'OPERATIONS_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER']

const NAV_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { label: 'Dashboard', href: '/app', icon: <LayoutDashboard className="h-5 w-5" />, pageKey: 'dashboard', tooltip: 'Dashboard' },
      { label: 'Products', href: '/app/products', icon: <Package className="h-5 w-5" />, pageKey: 'products', tooltip: 'Products' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'My Customers', href: '/app/sales/customers', icon: <UsersRound className="h-5 w-5" />, pageKey: 'sales_customers', roles: ['OUTSIDE_SALES', 'INSIDE_SALES'], tooltip: 'My Customers' },
      { label: 'Create Order', href: '/app/sales/create', icon: <ShoppingCart className="h-5 w-5" />, pageKey: 'sales_create', roles: ['OUTSIDE_SALES'], tooltip: 'Create Order' },
      { label: 'My Orders', href: '/app/sales/my-orders', icon: <ListOrdered className="h-5 w-5" />, pageKey: 'sales_my_orders', roles: ['OUTSIDE_SALES'], tooltip: 'My Orders' },
      { label: 'Templates', href: '/app/sales/templates', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'sales_templates', roles: ['OUTSIDE_SALES'], tooltip: 'Order Templates' },
      { label: 'All Orders', href: '/app/sales/all-orders', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'sales_all_orders', roles: ['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER', 'MANAGER', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER'], tooltip: 'All Orders' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Stock Overview', href: '/app/warehouse', icon: <Warehouse className="h-5 w-5" />, pageKey: 'warehouse_hub', roles: WAREHOUSE_ROLES, tooltip: 'Stock Overview' },
      { label: 'Receiving Tasks', href: '/app/warehouse/tasks', icon: <ClipboardCheck className="h-5 w-5" />, pageKey: 'warehouse_receiving_tasks', roles: WAREHOUSE_ROLES, tooltip: 'Receiving Tasks' },
      { label: 'Scan Item', href: '/app/warehouse/scanner', icon: <ScanLine className="h-5 w-5" />, pageKey: 'warehouse_scanner', roles: WAREHOUSE_ROLES, tooltip: 'Scan Item' },
      { label: 'Goods Received', href: '/app/warehouse/receiving', icon: <PackageCheck className="h-5 w-5" />, pageKey: 'warehouse_receiving', roles: WAREHOUSE_ROLES, tooltip: 'Goods Received' },
      { label: 'Fix Stock Count', href: '/app/warehouse/adjustment', icon: <SlidersHorizontal className="h-5 w-5" />, pageKey: 'warehouse_adjustment', roles: WAREHOUSE_ROLES, tooltip: 'Fix Stock Count' },
      { label: 'Received History', href: '/app/warehouse/receipts', icon: <History className="h-5 w-5" />, pageKey: 'warehouse_receipts', roles: WAREHOUSE_ROLES, tooltip: 'Received History' },
      { label: 'Locations', href: '/app/warehouse/locations', icon: <MapPinned className="h-5 w-5" />, pageKey: 'warehouse_locations', roles: WAREHOUSE_ROLES, tooltip: 'Stock Locations' },
      { label: 'Labels', href: '/app/warehouse/labels', icon: <Tags className="h-5 w-5" />, pageKey: 'warehouse_labels', roles: WAREHOUSE_ROLES, tooltip: 'Print Labels' },
      { label: 'Stock Takes', href: '/app/warehouse/stock-takes', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'warehouse_stock_takes', roles: WAREHOUSE_ROLES, tooltip: 'Stock Takes' },
      { label: 'Transfers', href: '/app/warehouse/transfers', icon: <ArrowRightLeft className="h-5 w-5" />, pageKey: 'warehouse_transfers', roles: WAREHOUSE_ROLES, tooltip: 'Stock Transfers' },
      { label: 'Warranty', href: '/app/warehouse/warranty', icon: <ShieldCheck className="h-5 w-5" />, pageKey: 'warehouse_warranty', roles: WAREHOUSE_ROLES, tooltip: 'Warranty Lookup' },
    ],
  },
  {
    title: 'Purchasing',
    items: [
      { label: 'Supplier PO', href: '/app/purchase-orders', icon: <Truck className="h-5 w-5" />, pageKey: 'purchase_orders', roles: BUYING_ROLES, tooltip: 'Supplier Purchase Orders' },
      { label: 'Suppliers', href: '/app/purchase-orders/suppliers', icon: <Building2 className="h-5 w-5" />, pageKey: 'purchase_orders', roles: BUYING_ROLES, tooltip: 'Supplier Master Data' },
      { label: 'Count Differences', href: '/app/purchase-orders/discrepancies', icon: <PackageX className="h-5 w-5" />, pageKey: 'receiving_discrepancies', roles: ['PURCHASE_MANAGER', 'OPERATIONS_MANAGER', 'MANAGER', 'DIRECTOR', 'IT_ADMIN', 'DEVELOPER'], tooltip: 'Receiving Discrepancies' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users', href: '/app/admin/users', icon: <Users className="h-5 w-5" />, pageKey: 'admin_users', roles: ['IT_ADMIN', 'DEVELOPER'], tooltip: 'Users' },
      { label: 'Products', href: '/app/admin/products', icon: <Package className="h-5 w-5" />, pageKey: 'admin_products', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER'], tooltip: 'Product Mgmt' },
      { label: 'Categories', href: '/app/admin/categories', icon: <Package className="h-5 w-5" />, pageKey: 'admin_categories', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER'], tooltip: 'Categories' },
      { label: 'New Item Requests', href: '/app/admin/intake-requests', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'admin_intake_requests', roles: ['MANAGER', 'IT_ADMIN', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER'], tooltip: 'New Item Requests' },
      { label: 'Customers', href: '/app/admin/customers', icon: <UsersRound className="h-5 w-5" />, pageKey: 'admin_customers', roles: ['IT_ADMIN', 'INSIDE_SALES', 'OPERATIONS_MANAGER'], tooltip: 'Customers' },
      { label: 'Activity', href: '/app/admin/activity', icon: <ClipboardList className="h-5 w-5" />, pageKey: 'admin_audit_logs', roles: ['IT_ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER'], tooltip: 'Activity' },
      { label: 'Salesman Map', href: '/app/admin/salesman-map', icon: <MapPin className="h-5 w-5" />, pageKey: 'admin_audit_logs', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER'], tooltip: 'Salesman Map' },
      { label: 'Reports', href: '/app/admin/reports', icon: <BarChart3 className="h-5 w-5" />, pageKey: 'admin_reports', roles: ['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'INSIDE_SALES', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER'], tooltip: 'Reports' },
      { label: 'Report Design', href: '/app/admin/report-designer', icon: <Palette className="h-5 w-5" />, pageKey: 'admin_report_designer', roles: OVERSIGHT_ROLES, tooltip: 'Report Design Centre' },
      { label: 'Settings', href: '/app/admin/settings', icon: <Settings className="h-5 w-5" />, pageKey: 'admin_settings', roles: ['IT_ADMIN', 'DEVELOPER'], tooltip: 'Settings' },
      { label: 'Menu Access', href: '/app/admin/role-permissions', icon: <Shield className="h-5 w-5" />, pageKey: 'admin_role_permissions', roles: ['IT_ADMIN', 'DEVELOPER'], tooltip: 'Menu Access' },
    ],
  },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth()
  const { data: rolePermissions } = useRolePermissions()
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true'
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed))
  }, [collapsed])

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

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(canSeeItem),
  })).filter((section) => section.items.length > 0)

  const renderNav = (items: NavItem[], showLabel: boolean) =>
    items.map((item) => (
      <NavLink
        key={item.href}
        to={item.href}
        end={item.href === '/app'}
        title={showLabel ? undefined : item.tooltip}
        className={({ isActive }) =>
          cn(
            'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
            collapsed ? 'justify-center gap-0' : 'gap-3',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          )
        }
      >
        {item.icon}
        {showLabel && <span className="truncate">{item.label}</span>}
      </NavLink>
    ))

  const renderSections = (showLabel: boolean) =>
    visibleSections.map((section, index) => (
      <div key={section.title || `section-${index}`} className={section.title ? 'pt-4' : undefined}>
        {section.title && showLabel && (
          <p className="mb-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
            {section.title}
          </p>
        )}
        {section.title && !showLabel && <div className="mx-auto mb-2 h-px w-8 bg-gray-200" />}
        {renderNav(section.items, showLabel)}
      </div>
    ))

  return (
    <>
      {/* Full sidebar — hidden below lg, collapsible at lg+ */}
      <aside
        className={cn(
          'hidden flex-shrink-0 border-r bg-white transition-all duration-200 lg:flex lg:flex-col',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className={cn('flex h-14 items-center border-b', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
          {!collapsed && <h1 className="text-lg font-bold text-primary truncate">OBM Helper</h1>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">{renderSections(!collapsed)}</nav>
      </aside>

      {/* Tablet sidebar — icon only at md breakpoint */}
      <aside className="hidden w-16 flex-shrink-0 border-r bg-white md:flex md:flex-col lg:hidden">
        <div className="flex h-14 items-center justify-center border-b">
          <span className="text-lg font-bold text-primary">OB</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {visibleSections.map((section, index) => (
            <div key={section.title || `t-${index}`} className={section.title ? 'pt-4' : undefined}>
              {section.title && <div className="mx-auto mb-2 h-px w-8 bg-gray-200" />}
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.href === '/app'}
                  title={item.tooltip}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )
                  }
                >
                  {item.icon}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
