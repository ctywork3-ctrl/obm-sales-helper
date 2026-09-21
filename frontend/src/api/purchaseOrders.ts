import client from './client'

export interface PurchaseOrderLine {
  id: number
  product_id: number
  product_name?: string | null
  product_code?: string | null
  evidence_policy?: string | null
  inventory_model?: string | null
  quantity_ordered: number
  quantity_received: number
  quantity_outstanding: number
  unit_cost?: number | null
  /**
   * What OBM records as already received, kept beside our own figure rather
   * than merged into it. A gap means goods arrived that nobody booked in here,
   * or a receipt that predates this system — a human decides which.
   */
  obm_quantity_processed?: number | null
}

export interface PurchaseOrderSummary {
  id: number
  po_number: string
  /**
   * The live link to supplier master data, or null when the vendor on the
   * document has no supplier record yet. Never guess from `supplier_name`:
   * the name is a snapshot and the id is the link — a PO that says "Shimano
   * SEA" is not automatically the supplier row of the same name.
   */
  supplier_id?: number | null
  supplier_name: string
  status: string
  expected_date?: string | null
  line_count: number
  total_ordered: number
  total_received: number
  total_outstanding: number
}

export interface PurchaseOrder extends PurchaseOrderSummary {
  notes?: string | null
  created_by: number
  created_at?: string | null
  lines: PurchaseOrderLine[]
  documents: {
    id: number
    original_filename?: string | null
    extraction_status: string
    created_at?: string | null
  }[]
}

export interface PurchaseOrderLineInput {
  product_id: number
  quantity_ordered: number
  unit_cost?: number
}

export interface OpenReceivingTask {
  id: number
  task_number: string
  status: string
  assigned_to?: number | null
  assigned_to_name?: string | null
  total_expected: number
  total_scanned: number
}

export interface ReceivingLinePreview {
  purchase_order_line_id: number
  product_id: number
  product_name?: string | null
  product_code?: string | null
  inventory_model?: string | null
  quantity_ordered: number
  quantity_received: number
  quantity_outstanding: number
  unit_cost?: number | null
  obm_quantity_processed?: number | null
  /** OBM says goods arrived that this app has no receipt for. */
  obm_disagrees?: boolean
  /** OBM considers the line fully delivered — there may be nothing to count. */
  obm_already_complete?: boolean
}

export interface ReceivingLinesResponse {
  po_number: string
  supplier_name: string
  lines: ReceivingLinePreview[]
  total_outstanding: number
  open_receiving_tasks: OpenReceivingTask[]
  obm_lines_with_figure?: number
  obm_disagreeing_lines?: number
  obm_complete_lines?: number
  /** Plain-language warning to show before issuing a task. Null when none. */
  obm_note?: string | null
}

export interface CreateReceivingTasksRequest {
  mode: 'WHOLE' | 'SPLIT'
  assigned_to?: number | null
  priority?: string
  due_date?: string
  location_id?: number | null
  instructions?: string
  assignments?: {
    assigned_to?: number | null
    priority?: string
    due_date?: string
    location_id?: number | null
    instructions?: string
    purchase_order_line_ids?: number[]
  }[]
}

export interface ImportPreviewRow {
  external_reference: string
  supplier_name: string
  expected_date?: string | null
  line_count: number
}

export interface ImportRowIssue {
  /** Spreadsheet row number, 1-based with the header on row 1. 0 means the
   *  problem belongs to a whole purchase order, not one line. */
  row: number
  reason: string
}

export interface ImportResult {
  filename?: string | null
  rows_read: number
  matched_columns: Record<string, string>
  /** Orders that would actually import — excludes any whose every row failed. */
  orders_found: number
  errors: ImportRowIssue[]
  warnings: ImportRowIssue[]
  /**
   * Distinct vendor names from the file that have no supplier master row.
   * Expected, not an error: the PO imports with the name and no link, and
   * these can be created deliberately afterwards.
   */
  unmatched_suppliers: string[]
  committed: boolean
  preview?: ImportPreviewRow[]
  created?: number
  updated?: number
  skipped?: { reason: string; reference?: string }[]
  message?: string
}

export interface ObmSkippedOrder {
  reference: string
  reason: string
  line_count: number
}

export interface ObmImportResult {
  source: string
  counts: { headers: number; importable: number; skipped: number }
  /** POs OBM held that had nothing importable (expense/allocation lines only). */
  skipped: ObmSkippedOrder[]
  committed: boolean
  orders_found: number
  preview?: ImportPreviewRow[]
  created?: number
  updated?: number
  unmatched_lines?: { reference: string; item_code?: string | null; name?: string | null }[]
  message?: string
}

export interface ObmStatus {
  configured: boolean
  enabled: boolean
  api_url: string
  /**
   * The direct Firebird link, reported separately from the saved settings.
   * "Configured but not reachable" is the common failure and needs its own
   * message, or the user goes looking for the wrong problem.
   */
  direct_configured: boolean
  direct_connected: boolean
  engine_version?: string | null
  purchase_order_count?: number | null
  import_available: boolean
  import_formats?: string[]
  message: string
}

export const purchaseOrdersApi = {
  list: (params?: { status?: string; search?: string }) =>
    client.get<PurchaseOrderSummary[]>('/purchase-orders', { params }),

  listOpen: () =>
    client.get<PurchaseOrder[]>('/purchase-orders/open'),

  get: (id: number) =>
    client.get<PurchaseOrder>(`/purchase-orders/${id}`),

  create: (data: { supplier_name: string; expected_date?: string; notes?: string; lines: PurchaseOrderLineInput[] }) =>
    client.post<PurchaseOrder>('/purchase-orders', data),

  send: (id: number) =>
    client.post<PurchaseOrder>(`/purchase-orders/${id}/send`),

  cancel: (id: number) =>
    client.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`),

  /** Outstanding quantities, with open receiving tasks already subtracted. */
  receivingLines: (id: number) =>
    client.get<ReceivingLinesResponse>(`/purchase-orders/${id}/receiving-lines`),

  /** Turn a PO into warehouse work — one task, or one per worker. */
  createReceivingTasks: (id: number, data: CreateReceivingTasksRequest) =>
    client.post<{ tasks: unknown[] }>(`/purchase-orders/${id}/receiving-tasks`, data),

  /** Whether OBM is configured, and whether it actually answers. */
  obmStatus: () => client.get<ObmStatus>('/purchase-orders/obm-status'),

  /**
   * Read purchase orders straight from OBM's database.
   *
   * Read-only against OBM - the accounting package is never written to. Only
   * this app's own database changes, and only when `commit` is true.
   */
  importFromObm: (options: {
    commit?: boolean
    limit?: number
    since?: string
    includeCancelled?: boolean
  } = {}) =>
    client.post<ObmImportResult>('/purchase-orders/import-obm', null, {
      params: {
        commit: options.commit ?? false,
        limit: options.limit ?? 50,
        since: options.since || undefined,
        include_cancelled: options.includeCancelled || undefined,
      },
    }),

  /**
   * Parse a CSV export of purchase orders.
   *
   * `commit` is false by default because importing master documents
   * sight-unseen is how a bad export quietly creates 40 wrong POs. Call it
   * once to show the user what would happen, then again with `commit: true`.
   *
   * Note: no `Content-Type` header here on purpose. The api client strips it
   * for FormData so axios can set the multipart boundary itself; setting it by
   * hand makes FastAPI reject the request with "Missing boundary in multipart."
   */
  importCsv: (file: File, commit = false) => {
    const form = new FormData()
    form.append('file', file)
    return client.post<ImportResult>('/purchase-orders/import-csv', form, {
      params: { commit },
    })
  },

  uploadDocument: (file: File, purchaseOrderId?: number) => {
    const form = new FormData()
    form.append('file', file)
    if (purchaseOrderId) form.append('purchase_order_id', String(purchaseOrderId))
    return client.post<{
      id: number
      original_filename?: string | null
      extraction_status: string
      supplier_name?: string
      po_number?: string
      lines: { item_code?: string; name?: string; quantity?: number; unit_price?: number | null }[]
      message: string
    }>('/purchase-orders/documents', form)
  },

  getExtraction: (documentId: number) =>
    client.get<{
      id: number
      extraction_status: string
      supplier_name?: string
      po_number?: string
      lines: { item_code?: string; name?: string; quantity?: number; unit_price?: number | null }[]
    }>(`/purchase-orders/documents/${documentId}/extraction`),
}
