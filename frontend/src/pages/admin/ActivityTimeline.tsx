import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { activityApi, TimelineGroup, TimelineEvent } from '@/api/activity'
import { formatDate, formatDateShort } from '@/lib/utils'
import { ChevronDown, ChevronRight, User, Clock, CheckCircle, XCircle, Search } from 'lucide-react'
import LoadingSpinner from '@/components/LoadingSpinner'

const actionColors: Record<string, string> = {
  auth: 'bg-blue-500',
  users: 'bg-purple-500',
  products: 'bg-green-500',
  customers: 'bg-orange-500',
  sales_order: 'bg-indigo-500',
  store_order: 'bg-teal-500',
  settings: 'bg-gray-500',
}

const actionIcons: Record<string, string> = {
  auth: '🔐',
  users: '👤',
  products: '📦',
  customers: '🏪',
  sales_order: '🛒',
  store_order: '🛍️',
  settings: '⚙️',
}

export default function ActivityTimeline() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['activity-timeline', page, action, entityType],
    queryFn: () =>
      activityApi.timeline({
        page,
        page_size: 50,
        action: action || undefined,
        entity_type: entityType || undefined,
      }).then((res) => res.data),
  })

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const actionOptions = [
    { value: '', label: 'All Actions' },
    { value: 'auth', label: 'Auth' },
    { value: 'users', label: 'Users' },
    { value: 'products', label: 'Products' },
    { value: 'customers', label: 'Customers' },
    { value: 'sales_order', label: 'Sales Orders' },
    { value: 'store_order', label: 'Store Orders' },
  ]

  const entityOptions = [
    { value: '', label: 'All Entities' },
    { value: 'user', label: 'User' },
    { value: 'product', label: 'Product' },
    { value: 'customer', label: 'Customer' },
    { value: 'sales_order', label: 'Sales Order' },
    { value: 'store_order', label: 'Store Order' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Activity Timeline</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1) }}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {actionOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1) }}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {entityOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-gray-500">
          No activity found
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />

          <div className="space-y-4">
            {data.items.map((group) => (
              <TimelineGroupCard
                key={group.id}
                group={group}
                expanded={expandedGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm">
            Page {page} of {data.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function TimelineGroupCard({ group, expanded, onToggle }: {
  group: TimelineGroup
  expanded: boolean
  onToggle: () => void
}) {
  const mainEvent = group.events[0]
  const color = actionColors[mainEvent.action_prefix] || 'bg-gray-500'
  const icon = actionIcons[mainEvent.action_prefix] || '📋'

  return (
    <div className="relative pl-12">
      {/* Dot on timeline */}
      <div className={`absolute left-3.5 top-4 h-3 w-3 rounded-full ${color} ring-4 ring-white`} />

      <div className="rounded-lg border bg-white shadow-sm">
        {/* Header */}
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="text-lg">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">
                {group.entity_label || mainEvent.action}
              </span>
              {group.events.length > 1 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {group.events.length} events
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <User className="h-3 w-3" />
              <span>{group.actor_name}</span>
              <Clock className="h-3 w-3 ml-2" />
              <span>{formatDate(mainEvent.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mainEvent.result === 'SUCCESS' ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
          </div>
        </button>

        {/* Expanded events */}
        {expanded && group.events.length > 1 && (
          <div className="border-t px-4 pb-4">
            <div className="mt-3 space-y-2">
              {group.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: TimelineEvent }) {
  const color = actionColors[event.action_prefix] || 'bg-gray-500'

  return (
    <div className="flex items-start gap-3 rounded-md bg-gray-50 p-3">
      <div className={`mt-1 h-2 w-2 rounded-full ${color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{event.action}</span>
          <span className="text-xs text-gray-400">{formatDateShort(event.created_at)}</span>
        </div>
        {event.entity_label && (
          <p className="text-sm text-gray-500 truncate">{event.entity_label}</p>
        )}
        {event.new_values && typeof event.new_values === 'object' && Object.keys(event.new_values).length > 0 && (
          <pre className="mt-1 text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(event.new_values, null, 0).slice(0, 100)}
          </pre>
        )}
      </div>
      {event.result === 'SUCCESS' ? (
        <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
      ) : (
        <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
      )}
    </div>
  )
}
