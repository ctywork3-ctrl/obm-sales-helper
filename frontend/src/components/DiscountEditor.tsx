import { AlertTriangle, Tag } from 'lucide-react'
import { computeDiscount, discountLabel, effectiveDiscountPercent, formatCurrency } from '@/lib/utils'

interface LineDiscountFieldProps {
  gross: number
  type: string
  value: number
  currency?: string
  onChange: (type: string, value: number) => void
}

/**
 * Compact per-line discount control: pick % or RM, type a number.
 *
 * The amount is computed here for instant feedback, but the server
 * recalculates everything on save — this is display only.
 */
export function LineDiscountField({ gross, type, value, currency = 'MYR', onChange }: LineDiscountFieldProps) {
  const discount = computeDiscount(gross, type, value)
  const active = type !== 'NONE'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <select
          value={type}
          onChange={(event) => {
            const next = event.target.value
            onChange(next, next === 'NONE' ? 0 : value || (next === 'PERCENT' ? 5 : 0))
          }}
          className="h-9 w-14 flex-shrink-0 rounded-md border px-1 text-xs"
          title="Discount type"
        >
          <option value="NONE">—</option>
          <option value="PERCENT">%</option>
          <option value="AMOUNT">RM</option>
        </select>
        <input
          type="number"
          min="0"
          step={type === 'PERCENT' ? '1' : '0.01'}
          value={active ? value : ''}
          disabled={!active}
          placeholder="0"
          onChange={(event) => onChange(type, Number(event.target.value))}
          className="h-9 w-full min-w-0 rounded-md border px-2 text-sm text-center disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      {active && (
        <span className={`text-xs ${discount > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
          − {formatCurrency(discount, currency)}
        </span>
      )}
    </div>
  )
}

interface OrderDiscountPanelProps {
  grossSubtotal: number
  type: string
  value: number
  reason: string
  currency?: string
  approvalThresholdPercent: number
  onChange: (patch: { type?: string; value?: number; reason?: string }) => void
}

/** Order-level discount: applied after all line discounts, with a reason. */
export function OrderDiscountPanel({
  grossSubtotal,
  type,
  value,
  reason,
  currency = 'MYR',
  approvalThresholdPercent,
  onChange,
}: OrderDiscountPanelProps) {
  const discount = computeDiscount(grossSubtotal, type, value)
  const percent = effectiveDiscountPercent(grossSubtotal, discount)
  const needsApproval = percent > approvalThresholdPercent

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Tag className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Order discount</h2>
        <span className="text-xs text-muted-foreground">
          Applied after line discounts, before tax
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium">Type</label>
          <select
            value={type}
            onChange={(event) => {
              const next = event.target.value
              onChange({ type: next, value: next === 'NONE' ? 0 : value || (next === 'PERCENT' ? 5 : 0) })
            }}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="NONE">No order discount</option>
            <option value="PERCENT">Percentage (%)</option>
            <option value="AMOUNT">Fixed amount (RM)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">
            {type === 'PERCENT' ? 'Percentage' : 'Amount'}
          </label>
          <input
            type="number"
            min="0"
            step={type === 'PERCENT' ? '0.5' : '0.01'}
            value={type === 'NONE' ? '' : value}
            disabled={type === 'NONE'}
            onChange={(event) => onChange({ value: Number(event.target.value) })}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Discount given</label>
          <div className="mt-1 flex h-10 items-center rounded-md border bg-gray-50 px-3 text-sm font-semibold text-red-600">
            {discount > 0 ? `− ${formatCurrency(discount, currency)}` : '—'}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-sm font-medium">Reason (shown on the printed order)</label>
        <input
          type="text"
          value={reason}
          onChange={(event) => onChange({ reason: event.target.value })}
          placeholder="e.g. Bulk purchase, clearance stock, loyalty customer"
          className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {needsApproval && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            This is a <strong>{percent}%</strong> discount, above the {approvalThresholdPercent}% threshold.
            The order will be flagged for manager approval when submitted.
          </span>
        </div>
      )}
    </div>
  )
}

interface DiscountTotalsProps {
  grossSubtotal: number
  lineDiscount: number
  orderDiscount: number
  tax: number
  total: number
  currency?: string
  itemCount: number
  taxRateLabel?: string
}

/** Read-only totals block mirroring exactly what the server will store. */
export function DiscountTotals({
  grossSubtotal,
  lineDiscount,
  orderDiscount,
  tax,
  total,
  currency = 'MYR',
  itemCount,
  taxRateLabel,
}: DiscountTotalsProps) {
  const discountTotal = lineDiscount + orderDiscount

  return (
    <div className="mt-4 border-t pt-4">
      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Gross ({itemCount} items)</span>
          <span>{formatCurrency(grossSubtotal, currency)}</span>
        </div>
        {lineDiscount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Line discounts</span>
            <span>− {formatCurrency(lineDiscount, currency)}</span>
          </div>
        )}
        {orderDiscount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Order discount</span>
            <span>− {formatCurrency(orderDiscount, currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-1">
          <span className="text-muted-foreground">Net subtotal</span>
          <span>{formatCurrency(grossSubtotal - discountTotal, currency)}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax{taxRateLabel ? ` (${taxRateLabel})` : ''}</span>
            <span>{formatCurrency(tax, currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 text-lg font-bold text-primary">
          <span>Total</span>
          <span>{formatCurrency(total, currency)}</span>
        </div>
        {discountTotal > 0 && (
          <div className="flex justify-between text-xs text-red-600">
            <span>Total discount</span>
            <span>
              {formatCurrency(discountTotal, currency)} ({discountLabel('PERCENT', effectiveDiscountPercent(grossSubtotal, discountTotal))})
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
