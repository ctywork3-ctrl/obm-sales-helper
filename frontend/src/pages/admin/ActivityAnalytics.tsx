import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { activityApi, AnalyticsData } from '@/api/activity'
import LoadingSpinner from '@/components/LoadingSpinner'
import { TrendingUp, Users, Activity, Clock } from 'lucide-react'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b']

function SimpleBarChart({ data, xKey, yKey, height = 220 }: { data: any[]; xKey: string; yKey: string; height?: number }) {
  if (!data.length) return <div className="text-gray-400 text-sm">No data</div>
  const max = Math.max(...data.map((d) => d[yKey]))
  const barW = Math.min(40, Math.floor(600 / data.length) - 4)
  const chartH = height - 30
  const chartW = data.length * (barW + 4) + 40

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(chartW, 200)} height={height + 10}>
        {data.map((d, i) => {
          const barH = max > 0 ? (d[yKey] / max) * chartH : 0
          const x = 30 + i * (barW + 4)
          const y = chartH - barH + 5
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={COLORS[i % COLORS.length]} rx={3} />
              <text x={x + barW / 2} y={chartH + 18} textAnchor="middle" fontSize={9} fill="#6b7280">
                {typeof d[xKey] === 'string' && d[xKey].length > 5 ? d[xKey].slice(5) : d[xKey]}
              </text>
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#374151">
                {d[yKey]}
              </text>
            </g>
          )
        })}
        <line x1={28} y1={5} x2={28} y2={chartH + 5} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={28} y1={chartH + 5} x2={chartW} y2={chartH + 5} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  )
}

function SimpleLineChart({ data, xKey, yKey, height = 220 }: { data: any[]; xKey: string; yKey: string; height?: number }) {
  if (!data.length) return <div className="text-gray-400 text-sm">No data</div>
  const max = Math.max(...data.map((d) => d[yKey]), 1)
  const chartH = height - 40
  const chartW = 600
  const stepX = chartW / Math.max(data.length - 1, 1)

  const points = data.map((d, i) => ({
    x: 30 + i * stepX,
    y: chartH - (d[yKey] / max) * chartH + 5,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = `${pathD} L ${points[points.length - 1].x} ${chartH + 5} L ${points[0].x} ${chartH + 5} Z`

  return (
    <div className="overflow-x-auto">
      <svg width={chartW + 40} height={height}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#lineGrad)" />
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={30 + i * stepX} y={chartH + 20} textAnchor="middle" fontSize={8} fill="#6b7280">
            {typeof d[xKey] === 'string' && d[xKey].length > 5 ? d[xKey].slice(5) : d[xKey]}
          </text>
        ))}
        <line x1={28} y1={5} x2={28} y2={chartH + 5} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={28} y1={chartH + 5} x2={chartW + 30} y2={chartH + 5} stroke="#e5e7eb" strokeWidth={1} />
      </svg>
    </div>
  )
}

function SimplePieChart({ data, height = 220 }: { data: { name: string; count: number }[]; height?: number }) {
  if (!data.length) return <div className="text-gray-400 text-sm">No data</div>
  const total = data.reduce((s, d) => s + d.count, 0)
  const cx = 100, cy = 100, r = 80
  let cumAngle = -Math.PI / 2

  const slices = data.map((d) => {
    const angle = (d.count / total) * Math.PI * 2
    const startAngle = cumAngle
    const endAngle = cumAngle + angle
    cumAngle = endAngle

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const large = angle > Math.PI ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    const pct = ((d.count / total) * 100).toFixed(0)
    const midAngle = startAngle + angle / 2
    const labelR = r * 0.65
    const lx = cx + labelR * Math.cos(midAngle)
    const ly = cy + labelR * Math.sin(midAngle)

    return { path, name: d.name, pct, lx, ly, count: d.count }
  })

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={200} height={height > 200 ? 200 : height}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={COLORS[i % COLORS.length]} stroke="white" strokeWidth={2} />
        ))}
      </svg>
      <div className="flex flex-col gap-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-gray-700">{s.name}</span>
            <span className="text-gray-400">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HorizontalBarChart({ data, height = 220 }: { data: { name: string; count: number }[]; height?: number }) {
  if (!data.length) return <div className="text-gray-400 text-sm">No data</div>
  const max = Math.max(...data.map((d) => d.count), 1)
  const barH = 28
  const chartW = 300

  return (
    <div className="overflow-y-auto" style={{ maxHeight: height }}>
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className="w-24 text-xs text-gray-600 truncate flex-shrink-0" title={d.name}>{d.name}</span>
          <div className="flex-1 relative h-5 bg-gray-100 rounded">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${(d.count / max) * 100}%`,
                backgroundColor: COLORS[i % COLORS.length],
                minWidth: 2,
              }}
            />
          </div>
          <span className="w-10 text-right text-xs font-medium">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function ActivityAnalytics() {
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['activity-analytics', days],
    queryFn: () => activityApi.analytics({ days }).then((res) => res.data),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!data) {
    return <div className="py-12 text-center text-gray-500">No data available</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Activity Analytics</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Events</p>
              <p className="text-xl font-bold">{data.total_events}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-green-100 p-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Per Day (avg)</p>
              <p className="text-xl font-bold">
                {data.events_per_day.length > 0
                  ? Math.round(data.total_events / data.events_per_day.length)
                  : 0}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-purple-100 p-2">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Active Users</p>
              <p className="text-xl font-bold">{data.by_actor.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-orange-100 p-2">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Peak Hour</p>
              <p className="text-xl font-bold">
                {data.peak_hours.length > 0
                  ? `${data.peak_hours.reduce((a, b) => a.count > b.count ? a : b).hour}:00`
                  : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Events Over Time</h2>
          <SimpleLineChart data={data.events_per_day} xKey="date" yKey="count" />
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">By Action Type</h2>
          <SimplePieChart data={data.by_action.map((a) => ({ name: a.prefix, count: a.count }))} />
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Top Actors</h2>
          <HorizontalBarChart data={data.by_actor.slice(0, 8).map((a) => ({ name: a.name, count: a.count }))} />
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Activity by Hour</h2>
          <SimpleBarChart data={data.peak_hours} xKey="hour" yKey="count" />
        </div>
      </div>

      {/* Entity Breakdown */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Entity Breakdown</h2>
        <div className="flex flex-wrap gap-3">
          {data.by_entity.map((item, index) => (
            <div key={item.type} className="flex items-center gap-2 rounded-lg border px-4 py-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <span className="text-sm font-medium capitalize">{item.type.replace('_', ' ')}</span>
              <span className="text-sm text-gray-500">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
