import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import BarcodeCamera from '@/components/BarcodeCamera'
import { cn, formatDate, formatDateShort } from '@/lib/utils'
import {
  BadgeCheck,
  CalendarClock,
  MapPin,
  Package,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  User,
  Wrench,
} from 'lucide-react'

/**
 * Warranty trail. Scan one serial number and see the whole story: what it is,
 * who bought it, when, where it is, and whether the warranty still covers it.
 *
 * This is the capability the old OBM system never had — a customer walks in
 * with a broken rod, you scan the serial, and you know instantly whether it
 * is a warranty job or a paid repair.
 */
export default function WarrantyLookup() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [claimIssue, setClaimIssue] = useState('')
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [message, setMessage] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['warranty-lookup', submitted],
    queryFn: () => warehouseApi.warrantyLookup(submitted).then((res) => res.data),
    enabled: !!submitted,
  })

  const { data: claims } = useQuery({
    queryKey: ['warranty-claims'],
    queryFn: () => warehouseApi.listClaims().then((res) => res.data),
  })

  const openClaim = useMutation({
    mutationFn: () => warehouseApi.createClaim({ code: submitted, issue: claimIssue }),
    onSuccess: (response) => {
      setMessage(response.data.message)
      setClaimIssue('')
      setShowClaimForm(false)
      queryClient.invalidateQueries({ queryKey: ['warranty-lookup', submitted] })
      queryClient.invalidateQueries({ queryKey: ['warranty-claims'] })
    },
    onError: (err: any) =>
      setMessage(err?.response?.data?.detail || 'Could not open the claim'),
  })

  const unit = data?.unit
  const warrantyActive = unit?.warranty_active
  const daysLeft = unit?.warranty_days_left

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Warranty Lookup</h1>
          <p className="text-sm text-muted-foreground">
            Scan or type a serial number to trace an item's sale, location and warranty cover.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSubmitted(code.trim())
                setMessage('')
              }
            }}
            placeholder="Serial number or barcode"
            className="h-12 flex-1 rounded-md border-2 px-3 font-mono text-sm"
            autoComplete="off"
          />
          <button
            onClick={() => {
              setSubmitted(code.trim())
              setMessage('')
            }}
            disabled={!code.trim()}
            className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            Look up
          </button>
        </div>
        <div className="mt-3">
          <BarcodeCamera
            onScan={(scanned) => {
              setCode(scanned)
              setSubmitted(scanned)
              setMessage('')
            }}
          />
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">{message}</div>
      )}

      {isLoading || isFetching ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : submitted && data && !data.found ? (
        <div className="rounded-lg border bg-white p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <p className="font-semibold">No record for "{submitted}"</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This serial has never been received into the system. If it is a genuine product, check the
            serial was captured when the goods arrived.
          </p>
        </div>
      ) : data?.found && unit ? (
        <>
          {/* Verdict banner */}
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg border p-4',
              warrantyActive
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            {warrantyActive ? (
              <BadgeCheck className="h-8 w-8 flex-shrink-0 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-8 w-8 flex-shrink-0 text-amber-600" />
            )}
            <div>
              <p className={cn('font-semibold', warrantyActive ? 'text-emerald-900' : 'text-amber-900')}>
                {warrantyActive
                  ? `Under warranty — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`
                  : unit.warranty_end
                    ? 'Warranty has expired'
                    : 'No warranty recorded for this unit'}
              </p>
              <p className="text-sm text-emerald-800/80">
                {unit.warranty_start ? `Cover from ${formatDateShort(unit.warranty_start)}` : 'Start date not set'}
                {unit.warranty_end ? ` to ${formatDateShort(unit.warranty_end)}` : ''}
                {unit.warranty_months ? ` · ${unit.warranty_months} months` : ''}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Item */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Package className="h-4 w-4 text-primary" /> Item
              </h2>
              <dl className="space-y-2 text-sm">
                <Row label="Product" value={data.product?.name} />
                <Row label="Code" value={data.product?.obm_item_code || data.product?.item_code} mono />
                <Row label="Serial" value={unit.serial_number} mono />
                <Row label="Status" value={unit.status} />
                <Row label="Condition" value={unit.condition} />
                <Row label="Batch" value={unit.batch_number} />
              </dl>
            </div>

            {/* Trace */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Store className="h-4 w-4 text-primary" /> Trace
              </h2>
              <dl className="space-y-2 text-sm">
                <Row
                  label="Location"
                  value={unit.location_name || unit.warehouse_location}
                  icon={<MapPin className="h-3.5 w-3.5" />}
                />
                <Row label="Received" value={unit.received_at ? formatDate(unit.received_at) : undefined} />
                <Row label="Sold" value={unit.sold_at ? formatDate(unit.sold_at) : undefined} />
                <Row
                  label="Customer"
                  value={data.customer ? `${data.customer.name} (${data.customer.code})` : undefined}
                  icon={<User className="h-3.5 w-3.5" />}
                />
                <Row
                  label="Sales order"
                  value={
                    data.sales_order_number && unit.order_id ? (
                      <Link to={`/app/sales/orders/${unit.order_id}`} className="text-primary underline">
                        {data.sales_order_number}
                      </Link>
                    ) : undefined
                  }
                />
              </dl>
            </div>
          </div>

          {/* Claims */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Wrench className="h-4 w-4 text-primary" /> Claims on this unit
              </h2>
              <button
                onClick={() => setShowClaimForm((open) => !open)}
                className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
              >
                {showClaimForm ? 'Cancel' : 'Open a claim'}
              </button>
            </div>

            {showClaimForm && (
              <div className="mb-4 rounded-md border border-blue-100 bg-blue-50/50 p-3">
                <label className="block text-sm font-medium">What is wrong with it?</label>
                <textarea
                  value={claimIssue}
                  onChange={(event) => setClaimIssue(event.target.value)}
                  rows={2}
                  placeholder="e.g. Tip section snapped on second use, guides intact"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
                <button
                  onClick={() => openClaim.mutate()}
                  disabled={!claimIssue.trim() || openClaim.isPending}
                  className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {openClaim.isPending ? 'Opening...' : 'Open claim'}
                </button>
              </div>
            )}

            {data.claims && data.claims.length > 0 ? (
              <div className="space-y-2">
                {data.claims.map((claim) => (
                  <div key={claim.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{claim.claim_number}</span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          claim.status === 'OPEN'
                            ? 'bg-amber-100 text-amber-800'
                            : claim.status === 'CLOSED' || claim.status === 'REPLACED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {claim.status}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{claim.issue}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {claim.in_warranty_at_claim ? 'In warranty when raised' : 'Outside warranty when raised'}
                      {claim.created_at ? ` · ${formatDateShort(claim.created_at)}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No claims on this unit.</p>
            )}
          </div>
        </>
      ) : null}

      {/* Recent claims across all units */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <CalendarClock className="h-4 w-4 text-primary" /> Recent warranty claims
        </h2>
        {claims?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Claim</th>
                  <th className="pb-2 font-medium">Serial</th>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Raised</th>
                </tr>
              </thead>
              <tbody>
                {(claims as any[]).map((claim) => (
                  <tr key={claim.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{claim.claim_number}</td>
                    <td className="py-2 font-mono text-xs">{claim.serial_number}</td>
                    <td className="py-2 text-gray-600">{claim.product_name}</td>
                    <td className="py-2 text-gray-600">{claim.customer_name || '—'}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{claim.status}</span>
                    </td>
                    <td className="py-2 text-gray-500">
                      {claim.created_at ? formatDateShort(claim.created_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">No warranty claims recorded yet.</p>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  icon,
}: {
  label: string
  value?: React.ReactNode
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-1.5 last:border-0">
      <dt className="flex items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={cn('text-right font-medium', mono && 'font-mono text-xs')}>{value || '—'}</dd>
    </div>
  )
}
