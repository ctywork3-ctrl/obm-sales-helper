import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Search, ShieldCheck, XCircle } from 'lucide-react'
import client from '@/api/client'

/**
 * Public warranty check — the page a customer lands on after scanning the QR
 * code printed on a rod's label.
 *
 * Deliberately outside `/app`, so it never hits `ProtectedRoute` and never
 * redirects a customer to a staff login. It reads from `/api/public/warranty/`
 * which is unauthenticated and returns ONLY the product name, brand and
 * warranty status. The customer's name, phone, order number and our cost are
 * not sent to the browser at all — see `backend/app/api/public_warranty.py`.
 *
 * The wording matters here. "Warranty expired" and "we could not find that
 * serial" are different messages for genuinely different situations, and a
 * customer holding a rod needs to know which one they are looking at.
 */

interface WarrantyResult {
  found: boolean
  code?: string
  product: { name: string; brand?: string | null } | null
  warranty: {
    active: boolean
    end_date: string | null
    days_left: number | null
    voided: boolean
  } | null
  has_claims: boolean
  claim_count: number
  message?: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function WarrantyCheckPage() {
  const { code: codeFromPath } = useParams<{ code?: string }>()
  const navigate = useNavigate()
  const [code, setCode] = useState(codeFromPath ?? '')
  const [result, setResult] = useState<WarrantyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const lookup = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setLoading(true)
    setError('')
    try {
      const res = await client.get<WarrantyResult>(
        `/public/warranty/check/${encodeURIComponent(trimmed)}`
      )
      setResult(res.data)
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 404) {
        // The endpoint is switched off (PUBLIC_WARRANTY_ENABLED). Say so
        // honestly rather than "we could not find that serial", which would
        // send the customer hunting for a code that was never the problem.
        setError(
          'Online warranty checking is not switched on. Please contact us with ' +
            'your serial number and we will look it up for you.'
        )
      } else if (status === 429) {
        setError('Too many checks just now. Please wait a minute and try again.')
      } else {
        setError('We could not check that code. Please try again.')
      }
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  // A QR code can point straight at /warranty/<serial>, so run it on load.
  useEffect(() => {
    if (codeFromPath) {
      setCode(codeFromPath)
      void lookup(codeFromPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromPath])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    // Put the code in the URL so the result can be shared or bookmarked.
    navigate(`/warranty/${encodeURIComponent(code.trim())}`, { replace: true })
    void lookup(code)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">Tackle Box</span>
          <span className="text-muted-foreground">· Warranty check</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Check your warranty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the serial number printed on the label, or scan the QR code on the
          product. You do not need an account.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="e.g. TB-000123"
            autoFocus={!codeFromPath}
            className="h-11 flex-1 rounded-md border px-3 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Checking...' : 'Check'}
          </button>
        </form>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
            <p className="text-sm text-amber-800">{error}</p>
          </div>
        )}

        {result && <WarrantyResultCard result={result} />}

        <p className="mt-8 text-xs text-muted-foreground">
          Something not right? Contact us with your serial number and we will help.
        </p>
      </main>
    </div>
  )
}

function WarrantyResultCard({ result }: { result: WarrantyResult }) {
  if (!result.found) {
    return (
      <div className="mt-6 rounded-lg border bg-white p-6 text-center">
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 font-medium">We could not find that serial number</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.message ??
            'Check the code on the label and try again, or contact us and we will look it up for you.'}
        </p>
      </div>
    )
  }

  const warranty = result.warranty
  const active = Boolean(warranty?.active)

  return (
    <div className="mt-6 overflow-hidden rounded-lg border bg-white">
      {/* The banner answers the customer's actual question in one line. */}
      <div
        className={
          active
            ? 'flex items-center gap-3 bg-emerald-50 px-6 py-4'
            : 'flex items-center gap-3 bg-red-50 px-6 py-4'
        }
      >
        {active ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        ) : (
          <AlertCircle className="h-6 w-6 text-red-600" />
        )}
        <div>
          <p
            className={
              active
                ? 'font-semibold text-emerald-900'
                : 'font-semibold text-red-900'
            }
          >
            {active
              ? 'This product is under warranty'
              : warranty?.voided
                ? 'The warranty on this product has been voided'
                : 'The warranty on this product has expired'}
          </p>
          {active && warranty?.days_left != null && (
            <p className="text-sm text-emerald-800">
              {warranty.days_left} day{warranty.days_left === 1 ? '' : 's'} remaining
            </p>
          )}
        </div>
      </div>

      <dl className="divide-y px-6">
        <Row label="Product" value={result.product?.name ?? '—'} />
        {result.product?.brand && <Row label="Brand" value={result.product.brand} />}
        <Row label="Serial number" value={result.code ?? '—'} mono />
        <Row label="Warranty ends" value={formatDate(warranty?.end_date)} />
        <Row
          label="Previous claims"
          value={
            result.has_claims
              ? `${result.claim_count} on record`
              : 'None'
          }
        />
      </dl>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm font-medium'}>{value}</dd>
    </div>
  )
}
