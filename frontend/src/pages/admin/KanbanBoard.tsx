import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminStoreOrdersApi, StoreOrderListItem } from '@/api/adminStoreOrders'
import { useNavigate } from 'react-router-dom'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import LoadingSpinner from '@/components/LoadingSpinner'
import { GripVertical, DollarSign, Clock, Truck, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

interface KanbanColumn {
  id: string
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: React.ReactNode
}

const columns: KanbanColumn[] = [
  { id: 'PENDING', label: 'Pending Payment', color: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200', icon: <Clock className="h-4 w-4" /> },
  { id: 'PAID', label: 'Paid', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', icon: <DollarSign className="h-4 w-4" /> },
  { id: 'PROCESSING', label: 'Processing', color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-200', icon: <AlertTriangle className="h-4 w-4" /> },
  { id: 'SHIPPED', label: 'Shipped', color: 'text-indigo-700', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200', icon: <Truck className="h-4 w-4" /> },
  { id: 'DELIVERED', label: 'Delivered', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200', icon: <CheckCircle className="h-4 w-4" /> },
  { id: 'CANCELLED', label: 'Cancelled', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', icon: <XCircle className="h-4 w-4" /> },
]

export default function KanbanBoard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [draggedOrder, setDraggedOrder] = useState<StoreOrderListItem | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-store-orders-kanban'],
    queryFn: () =>
      adminStoreOrdersApi.list({ page: 1, page_size: 200 }).then((res) => res.data),
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      adminStoreOrdersApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-store-orders-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['admin-store-orders'] })
    },
  })

  const orders = data?.items || []
  const columnOrders = useCallback((status: string) =>
    orders.filter((o) => o.status === status),
  [orders])

  const handleDragStart = (e: React.DragEvent, order: StoreOrderListItem) => {
    setDraggedOrder(order)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(order.id))
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnId)
  }

  const handleDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault()
    setDragOverColumn(null)
    if (draggedOrder && draggedOrder.status !== targetStatus) {
      updateStatusMutation.mutate({ id: draggedOrder.status === targetStatus ? draggedOrder.id : draggedOrder.id, status: targetStatus })
    }
    setDraggedOrder(null)
  }

  const handleDragEnd = () => {
    setDraggedOrder(null)
    setDragOverColumn(null)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order Kanban</h1>
        <button
          onClick={() => navigate('/app/admin/store-orders')}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          List View
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 180px)' }}>
        {columns.map((col) => {
          const colOrders = columnOrders(col.id)
          return (
            <div
              key={col.id}
              className={cn(
                'flex w-72 flex-shrink-0 flex-col rounded-lg border-2 transition-colors',
                dragOverColumn === col.id ? 'border-primary bg-primary/5' : 'border-transparent',
                col.bgColor
              )}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div className={cn('flex items-center gap-2 rounded-t-md border-b px-3 py-2', col.borderColor)}>
                <span className={col.color}>{col.icon}</span>
                <span className={cn('text-sm font-semibold', col.color)}>{col.label}</span>
                <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-medium', col.color, 'bg-white/80')}>
                  {colOrders.length}
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {colOrders.map((order) => (
                  <KanbanCard
                    key={order.id}
                    order={order}
                    isDragging={draggedOrder?.id === order.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onClick={() => navigate(`/app/admin/store-orders/${order.id}`)}
                  />
                ))}
                {colOrders.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-gray-400">
                    No orders
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({ order, isDragging, onDragStart, onDragEnd, onClick }: {
  order: StoreOrderListItem
  isDragging: boolean
  onDragStart: (e: React.DragEvent, order: StoreOrderListItem) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, order)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md border bg-white p-3 shadow-sm transition-all hover:shadow-md',
        isDragging ? 'opacity-40 scale-95' : ''
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-mono font-medium text-gray-800">{order.order_number}</span>
        <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-300" />
      </div>
      {order.customer && (
        <p className="mt-1 text-xs text-gray-500 truncate">{order.customer.full_name}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{formatCurrency(order.total_amount, order.currency)}</span>
        <span className="text-xs text-gray-400">{order.items?.length || 0} items</span>
      </div>
      {order.created_at && (
        <p className="mt-1 text-xs text-gray-400">{formatDate(order.created_at)}</p>
      )}
    </div>
  )
}
