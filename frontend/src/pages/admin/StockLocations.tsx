import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn } from '@/lib/utils'
import { MapPinned, Plus, Save, X } from 'lucide-react'
import type { StockLocation } from '@/types'

const ZONES = ['SHOWROOM', 'WAREHOUSE', 'RACK', 'RETURNS', 'DAMAGED', 'TRANSIT']

const ZONE_STYLES: Record<string, string> = {
  SHOWROOM: 'bg-blue-100 text-blue-700',
  WAREHOUSE: 'bg-emerald-100 text-emerald-700',
  RACK: 'bg-violet-100 text-violet-700',
  RETURNS: 'bg-amber-100 text-amber-700',
  DAMAGED: 'bg-red-100 text-red-700',
  TRANSIT: 'bg-gray-100 text-gray-700',
}

/**
 * Where stock physically lives. Free-text locations on each unit made
 * reporting impossible ("Rack A", "rack a", "Rack-A" were three places), so
 * locations are now a controlled list.
 */
export default function StockLocations() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({ code: '', name: '', zone: 'WAREHOUSE', notes: '' })
  const [error, setError] = useState('')

  const { data: locations, isLoading } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => warehouseApi.listLocations(true).then((res) => res.data),
  })

  const createLocation = useMutation({
    mutationFn: () => warehouseApi.createLocation(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-locations'] })
      setDraft({ code: '', name: '', zone: 'WAREHOUSE', notes: '' })
      setShowForm(false)
      setError('')
    },
    onError: (err: any) =>
      setError(err?.response?.data?.detail || 'Could not create the location'),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      warehouseApi.updateLocation(id, { is_active: isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-locations'] }),
  })

  const grouped = (locations || []).reduce<Record<string, StockLocation[]>>((acc, location) => {
    acc[location.zone] = acc[location.zone] || []
    acc[location.zone].push(location)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <MapPinned className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Stock Locations</h1>
            <p className="text-sm text-muted-foreground">
              Showroom, racks, returns and damaged bins — where each item actually sits.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Cancel' : 'Add location'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {showForm && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">New location</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium">Code *</label>
              <input
                value={draft.code}
                onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
                placeholder="WH-RACK-C"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Name *</label>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Rack C - Lures"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Zone</label>
              <select
                value={draft.zone}
                onChange={(event) => setDraft({ ...draft, zone: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Notes</label>
              <input
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
          </div>
          <button
            onClick={() => createLocation.mutate()}
            disabled={!draft.code.trim() || !draft.name.trim() || createLocation.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {createLocation.isPending ? 'Saving...' : 'Save location'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([zone, items]) => (
            <div key={zone}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
                <span className={cn('rounded px-2 py-0.5 text-xs', ZONE_STYLES[zone] || 'bg-gray-100')}>
                  {zone}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((location) => (
                  <div
                    key={location.id}
                    className={cn(
                      'rounded-lg border bg-white p-4 shadow-sm',
                      !location.is_active && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{location.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{location.code}</p>
                        {location.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">{location.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggleActive.mutate({ id: location.id, isActive: !location.is_active })}
                        className="flex-shrink-0 text-xs text-primary underline"
                      >
                        {location.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!locations?.length && (
            <p className="py-12 text-center text-muted-foreground">No locations defined yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
