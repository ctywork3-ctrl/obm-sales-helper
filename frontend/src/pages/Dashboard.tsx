import { useAuth } from '@/hooks/useAuth'
import { useSalesOrders } from '@/hooks/useSalesOrders'
import { Package, ShoppingCart, Clock, CheckCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const { user } = useAuth()
  const isSales = user?.role === 'OUTSIDE_SALES' || user?.role === 'INSIDE_SALES'
  const { data: ordersData } = useSalesOrders(
    isSales ? { per_page: 5 } : undefined
  )

  const stats = [
    {
      label: 'Orders',
      value: ordersData?.total || 0,
      icon: <ShoppingCart className="h-5 w-5" />,
      href: user?.role === 'OUTSIDE_SALES' ? '/sales/my-orders' : '/sales/all-orders',
    },
    {
      label: 'Products',
      value: '-',
      icon: <Package className="h-5 w-5" />,
      href: '/products',
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
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
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                {stat.icon}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {ordersData?.items && ordersData.items.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Recent Orders</h2>
          <div className="space-y-3">
            {ordersData.items.map((order) => (
              <Link
                key={order.id}
                to={`/sales/orders/${order.id}`}
                className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium">{order.order_number}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.customer?.name || 'N/A'} - {new Date(order.created_at).toLocaleDateString()}
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
