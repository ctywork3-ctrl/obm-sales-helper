import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { trackingApi, SalesmanLocation } from '@/api/tracking'
import LoadingSpinner from '@/components/LoadingSpinner'
import { MapPin, Clock, User, Smartphone, RefreshCw } from 'lucide-react'

function timeAgo(isoString: string | null): string {
  if (!isoString) return 'Never'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function statusColor(isOnline: boolean, lastSeen: string | null): string {
  if (isOnline) return 'bg-green-500'
  if (!lastSeen) return 'bg-gray-400'
  const diff = Date.now() - new Date(lastSeen).getTime()
  if (diff < 7200000) return 'bg-yellow-500'
  return 'bg-red-400'
}

function LeafletMap({ salesmen, trail, selectedId }: { salesmen: SalesmanLocation[]; trail: { latitude: number; longitude: number; source: string; created_at: string | null }[]; selectedId: number | null }) {
  const [MapComponent, setMapComponent] = useState<any>(null)

  useEffect(() => {
    const loadLeaflet = async () => {
      const L = await import('leaflet')
      await import('leaflet/dist/leaflet.css')

      const { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } = await import('react-leaflet')

      setMapComponent({ L, MapContainer, TileLayer, Marker, Popup, Polyline })
    }
    loadLeaflet()
  }, [])

  if (!MapComponent) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border-2 border-dashed bg-gray-50">
        <LoadingSpinner />
      </div>
    )
  }

  const { MapContainer, TileLayer, Marker, Popup, Polyline } = MapComponent
  const L = MapComponent.L

  const located = salesmen.filter((s) => s.latitude && s.longitude)
  const center: [number, number] = located.length
    ? [located[0].latitude!, located[0].longitude!]
    : [3.139, 101.6869] // KL default

  const trailPoints = trail
    .slice()
    .reverse()
    .map((point) => [point.latitude, point.longitude] as [number, number])

  return (
    <MapContainer center={center} zoom={11} style={{ height: '320px', width: '100%', borderRadius: '8px' }}>
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {trail.length > 1 && trailPoints.length > 1 && (
        <Polyline positions={trailPoints} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.6 }} />
      )}
      {located.map((s) => (
        <Marker
          key={s.user_id}
          position={[s.latitude!, s.longitude!]}
          icon={L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${s.is_online ? '#22c55e' : '#9ca3af'};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          })}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{s.full_name}</p>
              <p className="text-gray-500">{s.role.replace(/_/g, ' ')}</p>
              <p className="text-xs text-gray-400">{timeAgo(s.last_seen_at)} · {s.source?.replace(/_/g, ' ').toLowerCase() || '—'}</p>
              {s.accuracy && <p className="text-xs text-gray-400">±{Math.round(s.accuracy)}m accuracy</p>}
            </div>
          </Popup>
        </Marker>
      ))}
      {trail.map((point, index) => (
        point.source === 'CUSTOMER_CHECK_IN' && (
          <Marker
            key={`trail-${selectedId}-${point.created_at}-${index}`}
            position={[point.latitude, point.longitude]}
            icon={L.divIcon({
              className: 'custom-marker',
              html: `<div style="background:#f59e0b;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })}
          />
        )
      ))}
    </MapContainer>
  )
}

export default function SalesmanMap() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['salesmen-locations'],
    queryFn: () => trackingApi.getSalesmen().then((res) => res.data),
    refetchInterval: 30000,
  })
  const { data: visitsData } = useQuery({
    queryKey: ['customer-visits-today'],
    queryFn: () => trackingApi.getVisitsToday().then((res) => res.data),
    refetchInterval: 60000,
  })
  const { data: historyData } = useQuery({
    queryKey: ['salesman-history', selectedId],
    queryFn: () => trackingApi.getHistory(selectedId!, 24).then((res) => res.data),
    enabled: Boolean(selectedId),
  })

  const salesmen = data?.salesmen || []
  const visits = visitsData?.visits || []
  const trail = selectedId ? (historyData?.locations || []) : []
  const onlineCount = salesmen.filter((s) => s.is_online).length

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Salesman Locations</h1>
          <p className="text-sm text-gray-500">{onlineCount} online / {salesmen.length} total</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Leaflet Map */}
      <div className="rounded-lg border bg-white p-2 shadow-sm">
        <LeafletMap salesmen={salesmen} trail={trail} selectedId={selectedId} />
      </div>

      {/* Visits today */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Customer visits today</h2>
          <span className="text-sm text-gray-500">{visits.length} check-in{visits.length === 1 ? '' : 's'}</span>
        </div>
        <div className="divide-y">
          {visits.map((visit) => (
            <div key={visit.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <MapPin className="h-4 w-4 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{visit.customer_name}</p>
                <p className="truncate text-xs text-gray-500">Visited by {visit.salesman_name}</p>
              </div>
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3 w-3" />
                {timeAgo(visit.visited_at)}
              </span>
            </div>
          ))}
          {!visits.length && (
            <div className="p-6 text-center text-sm text-gray-500">
              No customer check-ins yet today. Salesmen check in automatically when they select a customer for an order.
            </div>
          )}
        </div>
      </div>

      {/* Salesman list */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">All Salesmen</h2>
          <p className="text-xs text-gray-500">Tap a salesman to show their 24-hour trail on the map.</p>
        </div>
        <div className="divide-y">
          {salesmen.map((s) => (
            <SalesmanRow key={s.user_id} salesman={s} selected={selectedId === s.user_id} onSelect={() => setSelectedId(selectedId === s.user_id ? null : s.user_id)} />
          ))}
          {!salesmen.length && (
            <div className="p-8 text-center text-gray-500">No salesmen found</div>
          )}
        </div>
      </div>
    </div>
  )
}

function SalesmanRow({ salesman, selected, onSelect }: { salesman: SalesmanLocation; selected: boolean; onSelect: () => void }) {
  const dotColor = statusColor(salesman.is_online, salesman.last_seen_at)

  return (
    <button type="button" onClick={onSelect} className={`flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 ${selected ? 'bg-blue-50' : ''}`}>
      <div className="relative">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <User className="h-5 w-5 text-gray-500" />
        </div>
        <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${dotColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{salesman.full_name}</p>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Smartphone className="h-3 w-3" />
            {salesman.role.replace(/_/g, ' ')}
          </span>
          {salesman.latitude && salesman.longitude && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {salesman.latitude.toFixed(4)}, {salesman.longitude.toFixed(4)}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <Clock className="h-3 w-3" />
          {timeAgo(salesman.last_seen_at)}
        </div>
        <p className="text-xs text-gray-400">
          {salesman.source?.replace(/_/g, ' ').toLowerCase() || '—'}
        </p>
      </div>
    </button>
  )
}
