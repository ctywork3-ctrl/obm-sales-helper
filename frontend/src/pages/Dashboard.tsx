import { useAuth } from '@/hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { getDashboardStats, DashboardStats } from '@/api/dashboard'
import { Package, ShoppingCart, Clock, AlertTriangle, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'

export default function Dashboard() {
  const { user } = useAuth()
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
  })

  const statCards = [
    {
      label: 'Total Orders',
      value: stats?.total_orders || 0,
      icon: <ShoppingCart className="h-5 w-5" />,
      href: '/app/sales/all-orders',
      color: 'text-blue-600 bg-blue-100',
    },
    {
      label: 'Pending Orders',
      value: stats?.pending_orders || 0,
      icon: <Clock className="h-5 w-5" />,
      href: '/app/sales/all-orders?status=SUBMITTED',
      color: 'text-orange-600 bg-orange-100',
    },
    {
      label: 'Total Revenue',
      value: formatCurrency(stats?.total_revenue || 0, 'MYR'),
      icon: <DollarSign className="h-5 w-5" />,
      href: '/app/sales/all-orders?status=KEYED_TO_OBM',
      color: 'text-green-600 bg-green-100',
    },
    {
      label: 'Low Stock',
      value: stats?.low_stock_count || 0,
      icon: <AlertTriangle className="h-5 w-5" />,
      href: '/app/products',
      color: 'text-red-600 bg-red-100',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user?.full_name}</h1>
        <p className="text-muted-foreground">
          Here's what's happening today.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-white p-4 shadow-sm animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Link
              key={stat.label}
              to={stat.href}
              className="rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <div className={`rounded-full p-2 ${stat.color}`}>
                  {stat.icon}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {stats?.recent_orders && stats.recent_orders.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Recent Orders</h2>
          <div className="space-y-3">
            {stats.recent_orders.map((order) => (
              <Link
                key={order.id}
                to={`/app/sales/orders/${order.id}`}
                className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium">{order.order_number}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      order.status === 'DRAFT'
                        ? 'bg-gray-100 text-gray-800'
                        : order.status === 'SUBMITTED'
                        ? 'bg-blue-100 text-blue-800'
                        : order.status === 'KEYED_TO_OBM'
                        ? 'bg-green-100 text-green-800'
                        : order.status === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}