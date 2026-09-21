import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reportTemplatesApi } from '@/api/reportTemplates'
import { salesOrdersApi } from '@/api/salesOrders'
import A4Document from '@/components/A4Document'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn } from '@/lib/utils'
import { paperDimensions } from '@/lib/print'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  LayoutTemplate,
  Palette,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from 'lucide-react'
import type { ReportBlock, ReportTemplateConfig, SalesOrderPrintData } from '@/types'

const ZOOM_STEPS = [0.45, 0.6, 0.75, 1]

/**
 * Report Design Centre.
 *
 * Design an A4 layout once, then every sales order, invoice or delivery order
 * prints the same way — no more hand-made templates in Word. The layout is a
 * list of blocks; each block exposes a field picker so the user controls what
 * appears without touching code.
 */
export default function ReportDesigner() {
  const queryClient = useQueryClient()
  const [docType, setDocType] = useState('SALES_ORDER')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<ReportTemplateConfig | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.6)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const { data: catalog } = useQuery({
    queryKey: ['report-catalog'],
    queryFn: () => reportTemplatesApi.catalog().then((res) => res.data),
  })

  const { data: templates, isLoading: loadingTemplates } = useQuery({
    queryKey: ['report-templates', docType],
    queryFn: () => reportTemplatesApi.list(docType).then((res) => res.data),
  })

  // A real order makes the preview honest rather than a mock-up.
  const { data: recentOrders } = useQuery({
    queryKey: ['sales-orders', 'designer-sample'],
    queryFn: () => salesOrdersApi.list({ page_size: 1 }).then((res) => res.data),
  })

  const sampleOrderId = recentOrders?.items?.[0]?.id

  const { data: printData } = useQuery({
    queryKey: ['sales-order-print-data', 'designer', sampleOrderId],
    queryFn: () => reportTemplatesApi.salesOrderPrintData(sampleOrderId!).then((res) => res.data),
    enabled: !!sampleOrderId,
  })

  // Load the selected (or default) template into the editor.
  const { data: loadedTemplate } = useQuery({
    queryKey: ['report-template', templateId],
    queryFn: () => reportTemplatesApi.get(templateId!).then((res) => res.data),
    enabled: !!templateId,
  })

  useEffect(() => {
    if (loadedTemplate) {
      setName(loadedTemplate.name)
      setConfig(loadedTemplate.config || null)
      setSelectedBlockId(loadedTemplate.config?.blocks?.[0]?.id ?? null)
      setDirty(false)
    }
  }, [loadedTemplate])

  // Default to the first template for this doc type.
  useEffect(() => {
    if (loadingTemplates || !templates) return
    if (templates.length === 0) {
      const fallback = catalog?.default_configs?.[docType]
      if (fallback) {
        setTemplateId(null)
        setName(`Custom ${docType.replace(/_/g, ' ')} (A4)`)
        setConfig(structuredClone(fallback))
        setSelectedBlockId(fallback.blocks[0]?.id ?? null)
      }
      return
    }
    if (templateId === null || !templates.some((t) => t.id === templateId)) {
      const preferred = templates.find((t) => t.is_default) || templates[0]
      if (preferred?.id) setTemplateId(preferred.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, docType, loadingTemplates, catalog])

  const blocks = config?.blocks || []
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) || null

  const previewData: SalesOrderPrintData | null = useMemo(() => {
    if (printData && config) {
      return { ...printData, template: { ...printData.template, config } }
    }
    if (!config) return null
    return { ...sampleData(), template: { ...sampleData().template, config } }
  }, [printData, config])

  const dims = paperDimensions({
    size: config?.paper.size,
    orientation: config?.paper.orientation,
    marginMm: config?.paper.margin_mm,
  })

  // --- mutations ---------------------------------------------------------

  const save = useMutation({
    mutationFn: () => {
      const payload = { name, doc_type: docType, config }
      return templateId
        ? reportTemplatesApi.update(templateId, payload)
        : reportTemplatesApi.create({ ...payload, config: config! })
    },
    onSuccess: (response) => {
      setMessage(`Saved "${response.data.name}"`)
      setError('')
      setDirty(false)
      if (!templateId && response.data.id) setTemplateId(response.data.id)
      queryClient.invalidateQueries({ queryKey: ['report-templates'] })
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not save the layout'),
  })

  const setDefault = useMutation({
    mutationFn: () => reportTemplatesApi.setDefault(templateId!),
    onSuccess: () => {
      setMessage('Set as the default layout for this document type')
      queryClient.invalidateQueries({ queryKey: ['report-templates'] })
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not set the default'),
  })

  const duplicate = useMutation({
    mutationFn: () => reportTemplatesApi.duplicate(templateId!),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] })
      if (response.data.id) setTemplateId(response.data.id)
      setMessage('Copied — edit the copy freely')
    },
  })

  const remove = useMutation({
    mutationFn: () => reportTemplatesApi.remove(templateId!),
    onSuccess: () => {
      setTemplateId(null)
      setMessage('Layout removed')
      queryClient.invalidateQueries({ queryKey: ['report-templates'] })
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not remove the layout'),
  })

  const resetDefaults = useMutation({
    mutationFn: () => reportTemplatesApi.resetDefaults(),
    onSuccess: (response) => {
      setMessage(response.data.message)
      queryClient.invalidateQueries({ queryKey: ['report-templates'] })
      setTemplateId(null)
    },
  })

  // --- editing helpers ---------------------------------------------------

  const updateConfig = (patch: Partial<ReportTemplateConfig>) => {
    setConfig((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }

  const updateBlock = (blockId: string, patch: Partial<ReportBlock>) => {
    setConfig((current) => {
      if (!current) return current
      return {
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === blockId ? { ...block, ...patch } : block,
        ),
      }
    })
    setDirty(true)
  }

  const moveBlock = (index: number, direction: -1 | 1) => {
    setConfig((current) => {
      if (!current) return current
      const next = [...current.blocks]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, blocks: next }
    })
    setDirty(true)
  }

  const addBlock = (type: string) => {
    const spec = catalog?.block_catalog[type]
    if (!spec || !config) return
    const id = `${type}-${Date.now().toString(36)}`
    const block: ReportBlock = {
      id,
      type,
      visible: true,
      title: spec.label,
      fields: [...spec.default_fields],
    }
    setConfig({ ...config, blocks: [...config.blocks, block] })
    setSelectedBlockId(id)
    setDirty(true)
  }

  const removeBlock = (blockId: string) => {
    setConfig((current) =>
      current ? { ...current, blocks: current.blocks.filter((block) => block.id !== blockId) } : current,
    )
    setDirty(true)
  }

  const toggleField = (blockId: string, field: string) => {
    const block = blocks.find((item) => item.id === blockId)
    if (!block) return
    const fields = block.fields.includes(field)
      ? block.fields.filter((item) => item !== field)
      : [...block.fields, field]
    updateBlock(blockId, { fields })
  }

  const canManage = true

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Palette className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Report Design Centre</h1>
            <p className="text-sm text-muted-foreground">
              Design the A4 layout once — every sales order, invoice or delivery order prints this way.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => resetDefaults.mutate()}
            disabled={resetDefaults.isPending}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" />
            Restore built-ins
          </button>
          {templateId && (
            <button
              onClick={() => duplicate.mutate()}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Copy className="h-4 w-4" />
              Duplicate
            </button>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !config || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {save.isPending ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {message && <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {/* Template bar */}
      <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-sm font-medium">Document type</label>
          <select
            value={docType}
            onChange={(event) => {
              setDocType(event.target.value)
              setTemplateId(null)
              setMessage('')
            }}
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
          >
            {(catalog?.doc_types || []).map((entry) => (
              <option key={entry.key} value={entry.key}>{entry.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Layout</label>
          <select
            value={templateId ?? ''}
            onChange={(event) => {
              setTemplateId(event.target.value ? Number(event.target.value) : null)
              setMessage('')
            }}
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="">New layout (unsaved)</option>
            {(templates || []).map((template) => (
              <option key={template.id ?? 0} value={template.id ?? ''}>
                {template.name}{template.is_default ? ' ★ default' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Layout name</label>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setDirty(true)
            }}
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
          />
        </div>
        <div className="flex items-end gap-2">
          {templateId && (
            <button
              onClick={() => setDefault.mutate()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              <Star className="h-4 w-4" />
              Set as default
            </button>
          )}
          {templateId && (
            <button
              onClick={() => remove.mutate()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-destructive px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      {loadingTemplates && !config ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
          {/* Editor column */}
          <div className="space-y-4">
            {/* Page settings */}
            {config && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 font-semibold">
                  <LayoutTemplate className="h-4 w-4 text-primary" /> Page & theme
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Paper</label>
                    <select
                      value={config.paper.size}
                      onChange={(event) =>
                        updateConfig({ paper: { ...config.paper, size: event.target.value } })
                      }
                      className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
                    >
                      {Object.keys(catalog?.paper_specs || { A4: {}, A5: {}, LETTER: {} }).map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Orientation</label>
                    <select
                      value={config.paper.orientation}
                      onChange={(event) =>
                        updateConfig({ paper: { ...config.paper, orientation: event.target.value } })
                      }
                      className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Margin (mm)</label>
                    <input
                      type="number"
                      min="5"
                      max="30"
                      value={config.paper.margin_mm}
                      onChange={(event) =>
                        updateConfig({ paper: { ...config.paper, margin_mm: Number(event.target.value) } })
                      }
                      className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Base font (pt)</label>
                    <input
                      type="number"
                      min="7"
                      max="16"
                      value={config.theme.font_size}
                      onChange={(event) =>
                        updateConfig({ theme: { ...config.theme, font_size: Number(event.target.value) } })
                      }
                      className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Accent colour</label>
                    <input
                      type="color"
                      value={config.theme.accent}
                      onChange={(event) =>
                        updateConfig({ theme: { ...config.theme, accent: event.target.value } })
                      }
                      className="mt-1 h-9 w-full rounded-md border px-1"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={config.options.zebra_rows}
                        onChange={(event) =>
                          updateConfig({ options: { ...config.options, zebra_rows: event.target.checked } })
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Striped rows
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Blocks */}
            {config && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Sections ({blocks.length})</h2>
                  <select
                    onChange={(event) => {
                      if (event.target.value) addBlock(event.target.value)
                      event.target.value = ''
                    }}
                    defaultValue=""
                    className="h-9 rounded-md border px-2 text-sm"
                  >
                    <option value="">+ Add section</option>
                    {Object.entries(catalog?.block_catalog || {}).map(([type, spec]) => (
                      <option key={type} value={type}>{spec.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {blocks.map((block, index) => (
                    <div
                      key={block.id}
                      className={cn(
                        'rounded-md border p-2',
                        selectedBlockId === block.id ? 'border-primary bg-primary/5' : 'border-gray-200',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedBlockId(block.id)}
                          className="flex-1 truncate text-left text-sm font-medium"
                        >
                          {block.title}
                        </button>
                        <button
                          onClick={() => updateBlock(block.id, { visible: !block.visible })}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100"
                          title={block.visible ? 'Hide' : 'Show'}
                        >
                          {block.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => moveBlock(index, -1)}
                          disabled={index === 0}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => moveBlock(index, 1)}
                          disabled={index === blocks.length - 1}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeBlock(block.id)}
                          className="rounded p-1 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Field picker */}
                      {selectedBlockId === block.id && catalog?.block_catalog[block.type] && (
                        <div className="mt-2 border-t pt-2">
                          <p className="mb-1 text-xs text-muted-foreground">
                            {catalog.block_catalog[block.type].description}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {catalog.block_catalog[block.type].fields.map((field) => {
                              const on = block.fields.includes(field.key)
                              return (
                                <button
                                  key={field.key}
                                  onClick={() => toggleField(block.id, field.key)}
                                  className={cn(
                                    'rounded-full border px-2 py-0.5 text-xs',
                                    on
                                      ? 'border-primary bg-primary/10 text-primary'
                                      : 'border-gray-200 text-gray-500 hover:bg-gray-50',
                                  )}
                                >
                                  {on ? '✓ ' : '+ '}
                                  {field.label}
                                </button>
                              )
                            })}
                          </div>
                          <input
                            value={block.title}
                            onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                            placeholder="Section heading"
                            className="mt-2 h-8 w-full rounded-md border px-2 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Preview column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-2 shadow-sm">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Printer className="h-4 w-4 text-primary" />
                Live A4 preview
                <span className="text-xs text-muted-foreground">
                  {config?.paper.size} · {dims.widthMm}×{dims.heightMm}mm
                </span>
              </span>
              <div className="flex items-center gap-1 rounded-md border">
                <button
                  onClick={() => setZoom((z) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)] ?? z)}
                  className="px-2 py-1 text-sm hover:bg-gray-100"
                >
                  −
                </button>
                <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)] ?? z)}
                  className="px-2 py-1 text-sm hover:bg-gray-100"
                >
                  +
                </button>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border bg-gray-200 p-4">
              {previewData && config ? (
                <div
                  className="mx-auto bg-white shadow-lg"
                  style={{
                    width: `${dims.widthMm * 3.7795 * zoom}px`,
                    height: `${dims.heightMm * 3.7795 * zoom}px`,
                    overflow: 'hidden',
                  }}
                >
                  <A4Document data={previewData} config={config} previewScale={zoom} />
                </div>
              ) : (
                <div className="flex justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {sampleOrderId
                ? 'Preview uses your most recent sales order, so what you see is what will print.'
                : 'No sales orders yet — showing sample data.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Fallback preview when the database has no orders yet. */
function sampleData(): SalesOrderPrintData {
  const now = new Date().toISOString()
  const item = {
    id: 1,
    product_id: 1,
    product_name: 'Stingray Spinning Rod 100M',
    product_code: 'OBM-R001',
    quantity: 2,
    unit_price: 189,
    gross: 378,
    discount_type: 'PERCENT',
    discount_value: 10,
    discount: 37.8,
    order_discount_share: 0,
    tax: 0,
    line_total: 340.2,
    notes: null,
  }
  return {
    template: {
      id: null,
      name: 'SALES ORDER',
      doc_type: 'SALES_ORDER',
      paper_size: 'A4',
      orientation: 'portrait',
      config: undefined as unknown as ReportTemplateConfig,
    },
    company: {
      company_name: 'OBM Sales',
      company_address: '12 Jalan Ipoh, 51200 Kuala Lumpur',
      company_phone: '03-2145 6789',
      company_email: 'sales@obm.com.my',
      company_reg_no: '202601234567',
      company_logo_url: '',
      company_bank_details: 'Maybank 5123 4567 8901 · OBM Sales Sdn Bhd',
      company_terms: 'Goods sold are not returnable after 7 days. Warranty covers manufacturing defects only.',
    },
    order: {
      id: 0,
      order_number: 'SO-SAMPLE-0001',
      status: 'APPROVED',
      order_date: now,
      created_at: now,
      submitted_at: now,
      reviewed_at: now,
      keyed_to_obm_at: null,
      currency: 'MYR',
      notes: 'Deliver before Friday.',
      obm_reference_number: 'OBM-88213',
      customer: {
        id: 1,
        name: 'Tackle Box fishing tackle',
        code: 'CUST-001',
        phone: '03-2145 6789',
        address: '12 Jalan Ipoh, 51200 Kuala Lumpur',
        email: 'info@tacklebox.com.my',
      },
      salesman: 'Ahmad Razak',
      delivery_address_snapshot: null,
      delivery_address: '12 Jalan Ipoh, 51200 Kuala Lumpur',
      contact_snapshot: null,
      totals: {
        gross_subtotal: 378,
        line_discount_total: 37.8,
        subtotal: 340.2,
        order_discount: 0,
        discount_total: 37.8,
        tax: 0,
        total: 340.2,
        discount_type: 'PERCENT',
        discount_value: 10,
        discount_reason: 'Loyalty customer, bulk order',
        discount_requires_approval: false,
      },
      items: [item],
    },
    discounts: [
      {
        product_name: item.product_name,
        product_code: item.product_code,
        quantity: item.quantity,
        gross: item.gross,
        discount: item.discount,
        net: item.gross - item.discount,
      },
    ],
    serials: [
      {
        product_id: 1,
        product_name: 'Stingray Spinning Rod 100M',
        serial_number: 'P0001-A1B2C3',
        barcode: 'P0001-A1B2C3',
        status: 'SOLD',
        warehouse_location: 'WH-RACK-A',
        warranty_months: 12,
        warranty_start: now,
        warranty_end: new Date(Date.now() + 365 * 864e5).toISOString(),
      },
    ],
    generated_at: now,
  }
}
