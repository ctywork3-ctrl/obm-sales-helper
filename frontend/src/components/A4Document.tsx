import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ReportTemplateConfig, SalesOrderPrintData } from '@/types'
import { amountInWords, formatCurrency, formatDateShort } from '@/lib/utils'
import { PAPER_SPECS, paperDimensions } from '@/lib/print'

/**
 * Renders one A4 page from a template config.
 *
 * Deliberately built from inline styles in pt/mm rather than Tailwind: this
 * markup has to survive the browser's print engine, and utility classes can
 * be dropped or reordered by the print stylesheet.
 */

interface A4DocumentProps {
  data: SalesOrderPrintData
  config: ReportTemplateConfig
  /** Scale for on-screen preview only; printing always uses 100%. */
  previewScale?: number
  className?: string
}

const ACCENT_FALLBACK = '#0f766e'

export default function A4Document({ data, config, previewScale = 1, className }: A4DocumentProps) {
  const { order, company, serials, discounts, template } = data
  const paper = config?.paper || { size: 'A4', orientation: 'portrait', margin_mm: 12 }
  const theme = config?.theme || { accent: ACCENT_FALLBACK, font: 'Helvetica', font_size: 10 }
  const options = config?.options || { show_page_numbers: true, show_footer_line: true, zebra_rows: true }
  const blocks = (config?.blocks || []).filter((block) => block.visible)

  const accent = theme.accent || ACCENT_FALLBACK
  const baseFont = theme.font_size || 10
  const { widthMm, heightMm } = paperDimensions({
    size: paper.size,
    orientation: paper.orientation,
    marginMm: paper.margin_mm,
  })

  const currency = order.currency || 'MYR'
  const money = (value: number) => formatCurrency(value || 0, currency)

  const pageStyle: React.CSSProperties = {
    width: `${widthMm}mm`,
    minHeight: `${heightMm}mm`,
    padding: `${paper.margin_mm}mm`,
    background: '#ffffff',
    color: '#111827',
    fontFamily: `${theme.font || 'Helvetica'}, Helvetica, Arial, sans-serif`,
    fontSize: `${baseFont}pt`,
    lineHeight: 1.4,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '4mm',
    transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
    transformOrigin: 'top left',
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div style={pageStyle} className="print-page">
        {blocks.map((block) => (
          <div key={block.id} className="print-avoid-break">
            {renderBlock(block.type, block, {
              order,
              company,
              serials,
              discounts,
              accent,
              money,
              zebra: options.zebra_rows,
              docTitle: template.name,
            })}
          </div>
        ))}

        <div style={{ marginTop: 'auto' }} />

        {options.show_footer_line && (
          <div
            style={{
              borderTop: `0.5pt solid ${accent}`,
              paddingTop: '2mm',
              fontSize: `${baseFont - 2}pt`,
              color: '#6b7280',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>
              {company.company_name || 'OBM Sales'} · {order.order_number}
            </span>
            <span>
              Printed {new Date(data.generated_at).toLocaleString('en-MY')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface RenderContext {
  order: SalesOrderPrintData['order']
  company: Record<string, string>
  serials: SalesOrderPrintData['serials']
  discounts: SalesOrderPrintData['discounts']
  accent: string
  money: (value: number) => string
  zebra: boolean
  docTitle: string
}

function renderBlock(
  type: string,
  block: { title: string; fields: string[] },
  ctx: RenderContext,
): ReactNode {
  switch (type) {
    case 'companyHeader':
      return <CompanyHeader block={block} ctx={ctx} />
    case 'docTitle':
      return <DocTitle block={block} ctx={ctx} />
    case 'docMeta':
      return <DocMeta block={block} ctx={ctx} />
    case 'billTo':
      return <BillTo block={block} ctx={ctx} />
    case 'itemsTable':
      return <ItemsTable block={block} ctx={ctx} />
    case 'discountSummary':
      return <DiscountSummary block={block} ctx={ctx} />
    case 'serialNumbers':
      return <SerialNumbers block={block} ctx={ctx} />
    case 'totals':
      return <Totals block={block} ctx={ctx} />
    case 'bankDetails':
      return <SimpleLines block={block} ctx={ctx} rows={[
        ['Bank / payment details', ctx.company.company_bank_details],
      ]} />
    case 'terms':
      return <SimpleLines block={block} ctx={ctx} rows={[
        ['Terms & conditions', ctx.company.company_terms],
        ['Warranty', warrantyNote(ctx)],
      ]} />
    case 'signatures':
      return <Signatures block={block} ctx={ctx} />
    default:
      return null
  }
}

function SectionTitle({ children, accent }: { children: ReactNode; accent: string }) {
  return (
    <div
      style={{
        fontSize: '8pt',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: accent,
        marginBottom: '1.5mm',
      }}
    >
      {children}
    </div>
  )
}

function warrantyNote(ctx: RenderContext): string {
  if (!ctx.serials.length) return ''
  const ends = ctx.serials
    .map((s) => s.warranty_end)
    .filter(Boolean)
    .sort() as string[]
  if (!ends.length) return ''
  return `Warranty applies from the date of sale. Latest expiry on this order: ${formatDateShort(ends[ends.length - 1])}.`
}

// --- blocks ---------------------------------------------------------------

function CompanyHeader({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { company, accent } = ctx
  const show = (key: string) => block.fields.includes(key)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5mm' }}>
      {show('company_logo') && company.company_logo_url && (
        <img
          src={company.company_logo_url}
          alt=""
          style={{ height: '18mm', width: 'auto', objectFit: 'contain' }}
        />
      )}
      <div style={{ flex: 1 }}>
        {show('company_name') && (
          <div style={{ fontSize: '16pt', fontWeight: 700, color: accent, lineHeight: 1.1 }}>
            {company.company_name || 'OBM Sales'}
          </div>
        )}
        <div style={{ fontSize: '8.5pt', color: '#4b5563', marginTop: '1mm' }}>
          {show('company_address') && company.company_address && (
            <div style={{ whiteSpace: 'pre-line' }}>{company.company_address}</div>
          )}
          <div>
            {show('company_phone') && company.company_phone && <span>Tel: {company.company_phone}</span>}
            {show('company_phone') && company.company_phone && show('company_email') && company.company_email && '  ·  '}
            {show('company_email') && company.company_email && <span>{company.company_email}</span>}
          </div>
          {show('company_reg_no') && company.company_reg_no && (
            <div>Reg. No: {company.company_reg_no}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DocTitle({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { order, accent } = ctx
  return (
    <div
      style={{
        borderTop: `1.5pt solid ${accent}`,
        borderBottom: `1.5pt solid ${accent}`,
        padding: '2mm 0',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '4mm',
      }}
    >
      {block.fields.includes('title_text') && (
        <span style={{ fontSize: '15pt', fontWeight: 700, letterSpacing: '0.06em' }}>
          {ctx.docTitle || 'SALES ORDER'}
        </span>
      )}
      {block.fields.includes('order_number') && (
        <span style={{ fontSize: '10pt', fontWeight: 600 }}>{order.order_number}</span>
      )}
    </div>
  )
}

function DocMeta({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { order } = ctx
  const rows: [string, string][] = []
  const add = (key: string, label: string, value?: string | null) => {
    if (block.fields.includes(key) && value) rows.push([label, value])
  }
  add('order_number', 'Order no.', order.order_number)
  add('order_date', 'Order date', order.order_date ? formatDateShort(order.order_date) : '')
  add('status', 'Status', order.status?.replace(/_/g, ' '))
  add('salesman', 'Salesperson', order.salesman)
  add('currency', 'Currency', order.currency)
  add('obm_reference_number', 'OBM reference', order.obm_reference_number)
  add('submitted_at', 'Submitted', order.submitted_at ? formatDateShort(order.submitted_at) : '')
  add('approved_at', 'Approved', order.reviewed_at ? formatDateShort(order.reviewed_at) : '')

  if (!rows.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1mm 6mm' }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '0.4pt dotted #d1d5db', paddingBottom: '0.8mm' }}>
          <span style={{ color: '#6b7280' }}>{label}</span>
          <span style={{ fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function BillTo({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { order, accent } = ctx
  const delivery = parseSnapshot(order.delivery_address_snapshot) || order.delivery_address
  const contact = parseSnapshot(order.contact_snapshot)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6mm' }}>
      <div>
        <SectionTitle accent={accent}>Customer</SectionTitle>
        {block.fields.includes('customer_name') && (
          <div style={{ fontWeight: 700 }}>{order.customer?.name || 'Walk-in customer'}</div>
        )}
        {block.fields.includes('customer_code') && order.customer?.code && (
          <div style={{ color: '#4b5563' }}>Code: {order.customer.code}</div>
        )}
        {block.fields.includes('customer_phone') && order.customer?.phone && order.customer.phone !== '-' && (
          <div style={{ color: '#4b5563' }}>Tel: {order.customer.phone}</div>
        )}
        {block.fields.includes('contact') && contact && (
          <div style={{ color: '#4b5563', marginTop: '1mm' }}>Attn: {contact}</div>
        )}
      </div>
      <div>
        <SectionTitle accent={accent}>Deliver to</SectionTitle>
        {block.fields.includes('delivery_address') && (
          <div style={{ whiteSpace: 'pre-line' }}>{delivery || order.customer?.address || '—'}</div>
        )}
        {block.fields.includes('notes') && order.notes && (
          <div style={{ marginTop: '1.5mm', color: '#4b5563' }}>
            <span style={{ fontWeight: 600 }}>Notes: </span>
            {order.notes}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemsTable({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { order, accent, money, zebra } = ctx
  const show = (key: string) => block.fields.includes(key)

  return (
    <div>
      <SectionTitle accent={accent}>Items</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
        <thead>
          <tr style={{ background: accent, color: '#fff' }}>
            {show('index') && <th style={thStyle('4%', 'left')}>#</th>}
            {show('product_code') && <th style={thStyle('13%', 'left')}>Code</th>}
            {show('product_name') && <th style={thStyle('auto', 'left')}>Description</th>}
            {show('quantity') && <th style={thStyle('8%', 'right')}>Qty</th>}
            {show('unit_price') && <th style={thStyle('12%', 'right')}>Unit price</th>}
            {show('discount') && <th style={thStyle('11%', 'right')}>Discount</th>}
            {show('discount_percent') && <th style={thStyle('8%', 'right')}>Disc %</th>}
            {show('tax') && <th style={thStyle('10%', 'right')}>Tax</th>}
            {show('line_total') && <th style={thStyle('13%', 'right')}>Amount</th>}
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => {
            const pct = item.gross ? (item.discount / item.gross) * 100 : 0
            return (
              <tr
                key={item.id}
                style={{
                  borderBottom: '0.4pt solid #e5e7eb',
                  background: zebra && index % 2 === 1 ? '#f9fafb' : undefined,
                }}
              >
                {show('index') && <td style={tdStyle('left')}>{index + 1}</td>}
                {show('product_code') && <td style={tdStyle('left')}>{item.product_code || '—'}</td>}
                {show('product_name') && (
                  <td style={tdStyle('left')}>
                    {item.product_name || '—'}
                    {item.notes && (
                      <div style={{ color: '#6b7280', fontSize: '7.5pt' }}>{item.notes}</div>
                    )}
                  </td>
                )}
                {show('quantity') && <td style={tdStyle('right')}>{item.quantity}</td>}
                {show('unit_price') && <td style={tdStyle('right')}>{money(item.unit_price)}</td>}
                {show('discount') && (
                  <td style={tdStyle('right')}>
                    {item.discount > 0 ? `- ${money(item.discount)}` : '—'}
                  </td>
                )}
                {show('discount_percent') && (
                  <td style={tdStyle('right')}>{item.discount > 0 ? `${pct.toFixed(1)}%` : '—'}</td>
                )}
                {show('tax') && <td style={tdStyle('right')}>{item.tax > 0 ? money(item.tax) : '—'}</td>}
                {show('line_total') && (
                  <td style={{ ...tdStyle('right'), fontWeight: 600 }}>{money(item.line_total)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DiscountSummary({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { discounts, order, accent, money } = ctx
  const show = (key: string) => block.fields.includes(key)

  if (!discounts.length && !order.totals.order_discount) return null

  return (
    <div>
      <SectionTitle accent={accent}>Discount summary</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            {show('product_name') && <th style={thStyle('auto', 'left')}>Product</th>}
            {show('product_code') && <th style={thStyle('14%', 'left')}>Code</th>}
            {show('quantity') && <th style={thStyle('8%', 'right')}>Qty</th>}
            {show('gross') && <th style={thStyle('13%', 'right')}>List</th>}
            {show('discount') && <th style={thStyle('13%', 'right')}>Discount</th>}
            {show('net') && <th style={thStyle('13%', 'right')}>Net</th>}
          </tr>
        </thead>
        <tbody>
          {discounts.map((row, index) => (
            <tr key={`${row.product_code}-${index}`} style={{ borderBottom: '0.4pt solid #e5e7eb' }}>
              {show('product_name') && <td style={tdStyle('left')}>{row.product_name}</td>}
              {show('product_code') && <td style={tdStyle('left')}>{row.product_code}</td>}
              {show('quantity') && <td style={tdStyle('right')}>{row.quantity}</td>}
              {show('gross') && <td style={tdStyle('right')}>{money(row.gross)}</td>}
              {show('discount') && (
                <td style={{ ...tdStyle('right'), color: '#b91c1c' }}>- {money(row.discount)}</td>
              )}
              {show('net') && <td style={tdStyle('right')}>{money(row.net)}</td>}
            </tr>
          ))}
          {order.totals.order_discount > 0 && (
            <tr style={{ borderBottom: '0.4pt solid #e5e7eb' }}>
              {show('product_name') && (
                <td style={{ ...tdStyle('left'), fontStyle: 'italic' }} colSpan={
                  [show('product_code'), show('quantity'), show('gross')].filter(Boolean).length + 1
                }>
                  Order-level discount
                  {order.totals.discount_type === 'PERCENT' ? ` (${order.totals.discount_value}%)` : ''}
                </td>
              )}
              {show('discount') && (
                <td style={{ ...tdStyle('right'), color: '#b91c1c' }}>- {money(order.totals.order_discount)}</td>
              )}
              {show('net') && <td style={tdStyle('right')}>—</td>}
            </tr>
          )}
        </tbody>
      </table>
      {show('discount_reason') && order.totals.discount_reason && (
        <div style={{ marginTop: '1.5mm', fontSize: '8pt', color: '#4b5563' }}>
          <span style={{ fontWeight: 600 }}>Reason: </span>
          {order.totals.discount_reason}
        </div>
      )}
      {order.totals.discount_requires_approval && (
        <div style={{ marginTop: '1mm', fontSize: '8pt', color: '#b45309' }}>
          Discount exceeded the approval threshold and required manager sign-off.
        </div>
      )}
    </div>
  )
}

function SerialNumbers({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { serials, accent } = ctx
  const show = (key: string) => block.fields.includes(key)
  if (!serials.length) return null

  return (
    <div>
      <SectionTitle accent={accent}>Serial numbers &amp; warranty</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            {show('product_name') && <th style={thStyle('auto', 'left')}>Product</th>}
            {show('serial_number') && <th style={thStyle('22%', 'left')}>Serial no.</th>}
            {show('warehouse_location') && <th style={thStyle('16%', 'left')}>Location</th>}
            {show('warranty_start') && <th style={thStyle('13%', 'left')}>From</th>}
            {show('warranty_end') && <th style={thStyle('13%', 'left')}>Warranty until</th>}
            {show('warranty_months') && <th style={thStyle('9%', 'right')}>Months</th>}
          </tr>
        </thead>
        <tbody>
          {serials.map((unit) => (
            <tr key={unit.serial_number} style={{ borderBottom: '0.4pt solid #e5e7eb' }}>
              {show('product_name') && <td style={tdStyle('left')}>{unit.product_name}</td>}
              {show('serial_number') && (
                <td style={{ ...tdStyle('left'), fontFamily: 'monospace' }}>{unit.serial_number}</td>
              )}
              {show('warehouse_location') && <td style={tdStyle('left')}>{unit.warehouse_location || '—'}</td>}
              {show('warranty_start') && (
                <td style={tdStyle('left')}>
                  {unit.warranty_start ? formatDateShort(unit.warranty_start) : '—'}
                </td>
              )}
              {show('warranty_end') && (
                <td style={tdStyle('left')}>
                  {unit.warranty_end ? formatDateShort(unit.warranty_end) : '—'}
                </td>
              )}
              {show('warranty_months') && (
                <td style={tdStyle('right')}>{unit.warranty_months ?? '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Totals({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { order, accent, money } = ctx
  const totals = order.totals
  const show = (key: string) => block.fields.includes(key)

  const rows: [string, string, boolean?][] = []
  if (show('gross_subtotal')) rows.push(['Gross subtotal', money(totals.gross_subtotal)])
  if (show('line_discount_total') && totals.line_discount_total > 0) {
    rows.push(['Line discounts', `- ${money(totals.line_discount_total)}`])
  }
  if (show('subtotal')) rows.push(['Net subtotal', money(totals.subtotal)])
  if (show('order_discount') && totals.order_discount > 0) {
    const suffix = totals.discount_type === 'PERCENT' ? ` (${totals.discount_value}%)` : ''
    rows.push([`Order discount${suffix}`, `- ${money(totals.order_discount)}`])
  }
  if (show('tax') && totals.tax > 0) rows.push(['Tax', money(totals.tax)])
  if (show('total')) rows.push(['Total due', money(totals.total), true])
  if (show('discount_saved') && totals.discount_total > 0) {
    rows.push(['Total discount given', money(totals.discount_total)])
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ minWidth: '70mm' }}>
        {rows.map(([label, value, strong]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: strong ? '1.5mm 0' : '0.8mm 0',
              borderTop: strong ? `1pt solid ${accent}` : undefined,
              fontWeight: strong ? 700 : 400,
              fontSize: strong ? '12pt' : undefined,
              color: strong ? accent : undefined,
            }}
          >
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
        {show('amount_in_words') && (
          <div style={{ marginTop: '2mm', fontSize: '8pt', fontStyle: 'italic', color: '#4b5563' }}>
            {amountInWords(totals.total, order.currency === 'MYR' ? 'RINGGIT MALAYSIA' : order.currency)}
          </div>
        )}
      </div>
    </div>
  )
}

function SimpleLines({
  block,
  ctx,
  rows,
}: {
  block: { fields: string[] }
  ctx: RenderContext
  rows: [string, string | undefined][]
}) {
  const { accent } = ctx
  const visible = rows.filter(([key, value]) => block.fields.includes(key) && value)
  if (!visible.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2mm' }}>
      {visible.map(([label, value]) => (
        <div key={label}>
          <SectionTitle accent={accent}>{label}</SectionTitle>
          <div style={{ whiteSpace: 'pre-line', color: '#374151' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function Signatures({ block, ctx }: { block: { fields: string[] }; ctx: RenderContext }) {
  const { accent, order } = ctx
  const slots: [string, string][] = []
  if (block.fields.includes('prepared_by')) slots.push(['Prepared by', order.salesman || ''])
  if (block.fields.includes('approved_by')) slots.push(['Approved by', ''])
  if (block.fields.includes('received_by')) slots.push(['Received by', ''])

  if (!slots.length) return null

  return (
    <div style={{ display: 'flex', gap: '8mm', marginTop: '6mm' }}>
      {slots.map(([label, name]) => (
        <div key={label} style={{ flex: 1 }}>
          <div style={{ borderBottom: `0.6pt solid ${accent}`, height: '14mm' }} />
          <div style={{ fontSize: '8pt', color: '#4b5563', marginTop: '1mm' }}>
            {label}
            {name ? ` · ${name}` : ''}
          </div>
          {block.fields.includes('date_line') && (
            <div style={{ fontSize: '8pt', color: '#9ca3af' }}>Date: ______________</div>
          )}
        </div>
      ))}
    </div>
  )
}

// --- style helpers --------------------------------------------------------

function thStyle(width: string, align: 'left' | 'right'): React.CSSProperties {
  return {
    width,
    textAlign: align,
    padding: '1.5mm 1.5mm',
    fontWeight: 600,
    fontSize: '8pt',
    border: 'none',
  }
}

function tdStyle(align: 'left' | 'right'): React.CSSProperties {
  return { textAlign: align, padding: '1.2mm 1.5mm', verticalAlign: 'top' }
}

/** Address/contact snapshots are JSON strings; fall back to the raw text. */
function parseSnapshot(value?: string | null): string {
  if (!value) return ''
  try {
    const data = JSON.parse(value)
    return [
      data.label,
      data.address_line1,
      data.address_line2,
      [data.postcode, data.city, data.state].filter(Boolean).join(' '),
      data.country,
      data.contact_name ? `Attn: ${data.contact_name}` : '',
      data.contact_phone ? `Tel: ${data.contact_phone}` : '',
      data.name ? `Attn: ${data.name}` : '',
      data.mobile ? `Mobile: ${data.mobile}` : '',
      data.email,
    ]
      .filter(Boolean)
      .join('\n')
  } catch {
    return value
  }
}

/**
 * Mounts children into a print-only container attached to <body>.
 *
 * The container is hidden on screen but revealed by the print stylesheet,
 * which also hides every other direct child of body — so the printed page is
 * exactly the document, with no app chrome.
 */
export function PrintPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const element = document.createElement('div')
    element.id = 'obm-print-root'
    element.style.display = 'none'
    document.body.appendChild(element)
    setHost(element)
    return () => {
      element.remove()
    }
  }, [])

  if (!host) return null
  return createPortal(children, host)
}

export { PAPER_SPECS }
