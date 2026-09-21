import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '@/api/reports'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { printHtml } from '@/lib/print'
import { BarChart3, Package, Printer, ShoppingCart, TrendingUp } from 'lucide-react'

interface PrintTableOptions {
  title: string
  subtitle?: string
  columns: string[]
  rows: (string | number)[][]
  summary?: { label: string; value: string }[]
  numericColumns?: number[]
}

/** Build a clean standalone A4 page and hand it to the browser's print dialog. */
function printReport({ title, subtitle, columns, rows, summary, numericColumns = [] }: PrintTableOptions) {
  const escape = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const head = columns.map((column) => `<th>${escape(column)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, index) =>
              `<td class="${numericColumns.includes(index) ? 'num' : ''}">${escape(cell)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')

  const summaryHtml = summary?.length
    ? `<div class="summary">${summary
        .map((entry) => `<div><span>${escape(entry.label)}</span><strong>${escape(entry.value)}</strong></div>`)
        .join('')}</div>`
    : ''

  const html = `
    <div class="doc">
      <div class="head">
        <div>
          <h1>${escape(title)}</h1>
          ${subtitle ? `<p class="sub">${escape(subtitle)}</p>` : ''}
        </div>
        <p class="stamp">Printed ${new Date().toLocaleString('en-MY')}</p>
      </div>
      ${summaryHtml}
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${columns.length}" class="empty">No data</td></tr>`}</tbody>
      </table>
    </div>
    <style>
      .doc { font-size: 9pt; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5pt solid #0f766e; padding-bottom: 3mm; margin-bottom: 4mm; }
      h1 { font-size: 15pt; margin: 0; color: #0f766e; letter-spacing: 0.04em; }
      .sub { margin: 1mm 0 0; color: #4b5563; }
      .stamp { margin: 0; font-size: 8pt; color: #6b7280; }
      .summary { display: flex; flex-wrap: wrap; gap: 6mm; margin-bottom: 4mm; }
      .summary div { border: 0.5pt solid #d1d5db; border-radius: 1mm; padding: 2mm 3mm; }
      .summary span { display: block; font-size: 8pt; color: #6b7280; }
      .summary strong { font-size: 11pt; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #0f766e; color: #fff; text-align: left; padding: 1.5mm; font-size: 8pt; }
      td { padding: 1.3mm 1.5mm; border-bottom: 0.4pt solid #e5e7eb; }
      td.num { text-align: right; }
      .empty { text-align: center; color: #9ca3af; padding: 6mm; }
      tbody tr:nth-child(even) { background: #f9fafb; }
    </style>
  `
  printHtml(html, { size: 'A4', orientation: 'portrait', marginMm: 12 })
}

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState<string>('sales')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const reports = [
    { id: 'sales', label: 'Sales Summary', icon: <ShoppingCart className="h-4 w-4" /> },
    { id: 'inventory', label: 'Inventory', icon: <Package className="h-4 w-4" /> },
    { id: 'commissions', label: 'Commissions', icon: <TrendingUp className="h-4 w-4" /> },
  ]

  const rangeLabel =
    dateFrom || dateTo
      ? `Period: ${dateFrom || 'start'} to ${dateTo || 'today'}`
      : 'Period: all dates'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reports Center</h1>
        <p className="text-sm text-muted-foreground">
          Every report prints to A4 — use "Save as PDF" in the print dialog to email a copy.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveReport(r.id)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              activeReport === r.id
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {r.icon}
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm" />
        </div>
      </div>

      {activeReport === 'sales' && <SalesReport dateFrom={dateFrom} dateTo={dateTo} rangeLabel={rangeLabel} />}
      {activeReport === 'inventory' && <InventoryReport rangeLabel={rangeLabel} />}
      {activeReport === 'commissions' && <CommissionReport dateFrom={dateFrom} dateTo={dateTo} rangeLabel={rangeLabel} />}
    </div>
  )
}

function PrintButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
    >
      <Printer className="h-4 w-4" />
      Print A4
    </button>
  )
}

function SalesReport({
  dateFrom,
  dateTo,
  rangeLabel,
}: {
  dateFrom: string
  dateTo: string
  rangeLabel: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-sales', dateFrom, dateTo],
    queryFn: () => reportsApi.salesSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined }).then((res) => res.data),
  })

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  if (!data) return null

  const handlePrint = () =>
    printReport({
      title: 'Sales Summary',
      subtitle: rangeLabel,
      columns: ['Order', 'Customer', 'Salesperson', 'Status', 'Amount', 'Commission'],
      numericColumns: [4, 5],
      summary: [
        { label: 'Total orders', value: String(data.summary.total_orders) },
        { label: 'Total revenue', value: formatCurrency(data.summary.total_amount, 'MYR') },
        { label: 'Total tax', value: formatCurrency(data.summary.total_tax, 'MYR') },
        { label: 'Total discount', value: formatCurrency(data.summary.total_discount ?? 0, 'MYR') },
        { label: 'Total commission', value: formatCurrency(data.summary.total_commission, 'MYR') },
      ],
      rows: data.orders.map((o: any) => [
        o.order_number,
        o.customer || '-',
        o.salesman || '-',
        o.status,
        formatCurrency(o.total_amount, o.currency || 'MYR'),
        formatCurrency(o.commission_total || 0, 'MYR'),
      ]),
    })

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PrintButton onClick={handlePrint} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total Orders" value={String(data.summary.total_orders)} icon={<ShoppingCart className="h-5 w-5" />} color="bg-blue-500" />
        <StatCard label="Total Revenue" value={formatCurrency(data.summary.total_amount, 'MYR')} icon={<TrendingUp className="h-5 w-5" />} color="bg-green-500" />
        <StatCard label="Total Tax" value={formatCurrency(data.summary.total_tax, 'MYR')} icon={<BarChart3 className="h-5 w-5" />} color="bg-orange-500" />
        <StatCard label="Total Commission" value={formatCurrency(data.summary.total_commission, 'MYR')} icon={<TrendingUp className="h-5 w-5" />} color="bg-purple-500" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">By Status</h3>
          <div className="space-y-2">
            {data.by_status.map((s: any) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{s.status}</span>
                <span className="font-medium">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">By Salesman</h3>
          <div className="space-y-2">
            {data.by_salesman.map((s: any) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{s.name}</span>
                <span className="font-medium">{s.count} orders — {formatCurrency(s.total, 'MYR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Orders</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Order</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Salesman</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o: any) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{o.order_number}</td>
                  <td className="py-2 text-gray-600">{o.customer}</td>
                  <td className="py-2 text-gray-600">{o.salesman}</td>
                  <td className="py-2"><StatusBadge status={o.status} /></td>
                  <td className="py-2 text-right">{formatCurrency(o.total_amount, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function InventoryReport({ rangeLabel }: { rangeLabel: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-inventory'],
    queryFn: () => reportsApi.inventory().then((res) => res.data),
  })

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  if (!data) return null

  const handlePrint = () =>
    printReport({
      title: 'Inventory Report',
      subtitle: `${rangeLabel} · ${data.total} products, ${data.low_stock_count} low stock`,
      columns: ['Product', 'SKU', 'Category', 'Stock', 'Price', 'Status'],
      numericColumns: [3, 4],
      rows: data.products.map((p: any) => [
        p.name,
        p.item_code,
        p.category || '-',
        p.stock_qty,
        formatCurrency(p.selling_price, 'MYR'),
        p.is_low_stock ? 'LOW' : 'OK',
      ]),
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>Total: {data.total}</span>
          <span className="text-red-600">Low Stock: {data.low_stock_count}</span>
        </div>
        <PrintButton onClick={handlePrint} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="p-3">Product</th>
              <th className="p-3">SKU</th>
              <th className="p-3">Category</th>
              <th className="p-3 text-right">Stock</th>
              <th className="p-3 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p: any) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-gray-500">{p.item_code}</td>
                <td className="p-3 text-gray-500">{p.category}</td>
                <td className={cn('p-3 text-right font-medium', p.is_low_stock ? 'text-red-600' : 'text-gray-700')}>
                  {p.stock_qty}
                </td>
                <td className="p-3 text-right">{formatCurrency(p.selling_price, 'MYR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CommissionReport({
  dateFrom,
  dateTo,
  rangeLabel,
}: {
  dateFrom: string
  dateTo: string
  rangeLabel: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports-commissions', dateFrom, dateTo],
    queryFn: () => reportsApi.commissions({ date_from: dateFrom || undefined, date_to: dateTo || undefined }).then((res) => res.data),
  })

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  if (!data) return null

  const handlePrint = () =>
    printReport({
      title: 'Commission Report',
      subtitle: `${rangeLabel} · KEYED orders only`,
      columns: ['Salesperson', 'Orders', 'Total Sales', 'Commission'],
      numericColumns: [1, 2, 3],
      summary: [{ label: 'Total commission', value: formatCurrency(data.total_commission, 'MYR') }],
      rows: data.commissions.map((c: any) => [
        c.name,
        c.order_count,
        formatCurrency(c.total_amount, 'MYR'),
        formatCurrency(c.total_commission, 'MYR'),
      ]),
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Commission (KEYED orders)</p>
          <p className="text-2xl font-bold">{formatCurrency(data.total_commission, 'MYR')}</p>
        </div>
        <PrintButton onClick={handlePrint} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="p-3">Salesman</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-right">Total Sales</th>
              <th className="p-3 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {data.commissions.map((c: any) => (
              <tr key={c.user_id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-right">{c.order_count}</td>
                <td className="p-3 text-right">{formatCurrency(c.total_amount, 'MYR')}</td>
                <td className="p-3 text-right font-semibold">{formatCurrency(c.total_commission, 'MYR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
        <div className={`rounded-full p-2 text-white ${color}`}>{icon}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    APPROVED: 'bg-green-100 text-green-700',
    KEYED_TO_OBM: 'bg-purple-100 text-purple-700',
    REJECTED: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-red-100 text-red-700',
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ')
}
