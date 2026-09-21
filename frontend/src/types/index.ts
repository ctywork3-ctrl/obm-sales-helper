export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at: string;
  last_login_at: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  obm_item_code: string;
  item_code: string;
  name: string;
  category: string;
  category_id?: number | null;
  brand: string;
  uom: string;
  description: string;
  selling_price: number;
  cost_price: number;
  stock_qty: number;
  stock_source: string;
  last_stock_sync_at: string;
  barcode: string;
  is_active: boolean;
  evidence_policy?: string | null;
  inventory_model?: string | null;
  warranty_months?: number | null;
  reorder_level?: number | null;
  images: ProductImage[];
  prices?: ProductPrice[];
  created_at: string;
}

export interface ProductPrice {
  id: number;
  product_id: number;
  currency: string;
  unit_price: number;
  min_qty?: number | null;
  is_active: boolean;
  created_at?: string | null;
}

export interface ProductImage {
  id: number;
  product_id: number;
  file_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  is_primary: boolean;
  created_at: string;
}

export interface Customer {
  id: number;
  obm_customer_code: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  is_active: boolean;
  salesman_id?: number | null;
  salesman_name?: string | null;
  created_at: string;
}

export interface SalesOrder {
  id: number;
  order_number: string;
  customer_id: number;
  customer?: Customer;
  salesman_id: number;
  salesman?: User;
  status: string;
  order_date: string;
  delivery_address: string;
  notes: string;
  total_amount: number;
  subtotal_amount?: number;
  gross_subtotal?: number;
  discount_type?: string;
  discount_value?: number;
  line_discount_total?: number;
  order_discount_amount?: number;
  discount_total?: number;
  discount_reason?: string;
  discount_requires_approval?: boolean;
  tax_amount?: number;
  currency: string;
  delivery_address_id?: number;
  contact_id?: number;
  delivery_address_snapshot?: string;
  contact_snapshot?: string;
  submitted_at: string;
  reviewed_by: number;
  reviewed_at: string;
  rejected_reason: string;
  obm_reference_number: string;
  keyed_to_obm_by: number;
  keyed_to_obm_at: string;
  items: SalesOrderItem[];
  created_at: string;
}

export interface SalesOrderItem {
  id: number;
  sales_order_id: number;
  product_id: number;
  product?: Product;
  product_code_snapshot: string;
  product_name_snapshot: string;
  quantity: number;
  unit_price: number;
  gross_amount?: number;
  discount_type?: string;
  discount_value?: number;
  discount_amount: number;
  order_discount_share?: number;
  line_total: number;
  tax_rate_snapshot?: number;
  tax_amount?: number;
  notes: string;
}

export type DiscountType = 'NONE' | 'PERCENT' | 'AMOUNT';

export interface DiscountPolicy {
  approval_threshold_percent: number;
  can_approve_discounts: boolean;
  max_percent: number;
}

export interface DiscountCheckResult {
  amount: number;
  discount_amount: number;
  net_amount: number;
  effective_percent: number;
  requires_approval: boolean;
  approval_threshold_percent: number;
}

// --- Warehouse / receiving ------------------------------------------------

export interface StockLocation {
  id: number;
  code: string;
  name: string;
  zone: string;
  parent_id?: number | null;
  address?: string | null;
  is_active: boolean;
  notes?: string | null;
}

export interface ReceivingTaskUnit {
  id: number;
  serial_number: string;
  barcode?: string | null;
  status: string;
  condition?: string;
  warehouse_location?: string | null;
  warranty_months?: number | null;
}

export interface ReceivingTaskLine {
  id: number;
  product_id: number;
  product_name: string | null;
  product_code: string | null;
  obm_item_code?: string | null;
  quantity_expected: number;
  quantity_scanned: number;
  quantity_rejected: number;
  quantity_outstanding: number;
  unit_cost?: number | null;
  tracking_mode: string;
  notes?: string | null;
  units: ReceivingTaskUnit[];
}

export interface ReceivingTaskScanLog {
  id: number;
  scanned_code: string;
  result: string;
  note?: string | null;
  created_at: string | null;
}

export interface ReceivingTask {
  id: number;
  task_number: string;
  purchase_order_id?: number | null;
  po_number?: string | null;
  supplier_name?: string | null;
  status: string;
  priority: string;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  assigned_by_name?: string | null;
  assigned_at?: string | null;
  due_date?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  instructions?: string | null;
  completion_notes?: string | null;
  inventory_receipt_id?: number | null;
  created_at: string | null;
  lines: ReceivingTaskLine[];
  total_expected: number;
  total_scanned: number;
  progress_percent: number;
  recent_scans?: ReceivingTaskScanLog[];
}

export interface StockOverviewItem {
  id: number;
  name: string;
  item_code: string;
  obm_item_code?: string | null;
  category?: string | null;
  brand?: string | null;
  uom?: string | null;
  inventory_model: string;
  stock_qty: number;
  selling_price: number;
  cost_price: number;
  is_low_stock: boolean;
  units_by_status: Record<string, number>;
  units_by_location: Record<string, number>;
  unit_count: number;
}

export interface StockOverview {
  items: StockOverviewItem[];
  total_products: number;
  matched_products?: number;
  truncated?: boolean;
  low_stock_count: number;
  serialized_count: number;
  total_units: number;
  low_stock_threshold: number;
  include_inactive?: boolean;
}

export interface WarrantyUnit {
  id: number;
  serial_number: string;
  barcode?: string | null;
  status: string;
  condition?: string;
  warehouse_location?: string | null;
  location_name?: string | null;
  batch_number?: string | null;
  received_at?: string | null;
  sold_at?: string | null;
  order_id?: number | null;
  warranty_months?: number | null;
  warranty_start?: string | null;
  warranty_end?: string | null;
  warranty_days_left?: number | null;
  warranty_active: boolean;
  warranty_void_reason?: string | null;
}

export interface WarrantyClaim {
  id: number;
  claim_number: string;
  issue: string;
  status: string;
  resolution?: string | null;
  in_warranty_at_claim?: boolean | null;
  created_at?: string | null;
}

export interface WarrantyLookupResult {
  found: boolean;
  code: string;
  unit?: WarrantyUnit;
  product?: {
    id: number;
    name: string;
    item_code: string;
    obm_item_code?: string | null;
    brand?: string | null;
    category?: string | null;
  };
  customer?: { id: number; name: string; code: string; phone: string } | null;
  sales_order_number?: string | null;
  claims?: WarrantyClaim[];
}

// --- Stock transfers -----------------------------------------------------

export interface StockTransferLine {
  id: number;
  product_id: number;
  product_name: string | null;
  product_code: string | null;
  tracking_mode: string;
  quantity_expected: number;
  quantity_dispatched: number;
  quantity_received: number;
  notes: string | null;
}

export interface StockTransfer {
  id: number;
  transfer_number: string;
  status: string;
  from_location_id: number;
  from_location_name: string | null;
  to_location_id: number;
  to_location_name: string | null;
  notes: string | null;
  instructions: string | null;
  completion_notes: string | null;
  total_units: number;
  dispatched_units: number;
  received_units: number;
  created_by_name: string | null;
  created_at: string | null;
  dispatched_by_name: string | null;
  dispatched_at: string | null;
  received_by_name: string | null;
  received_at: string | null;
  lines?: StockTransferLine[];
  report?: {
    lines: (StockTransferLine & { in_flight: number })[];
    in_flight_total: number;
  };
  in_flight?: { id: number; serial_number: string; product_id: number; product_name: string | null }[];
}

export interface TransferableProduct {
  product_id: number;
  product_name: string;
  product_code: string | null;
  available_here: number;
}

// --- Stock takes ---------------------------------------------------------

export interface StockTakeCountLine {
  id: number;
  product_id: number;
  product_name: string | null;
  product_code: string | null;
  tracking_mode: string;
  /** What the system believed when the session started. Frozen. */
  expected_qty: number;
  /** null means "not counted yet" — different from counted zero. */
  counted_qty: number | null;
  variance: number | null;
  notes: string | null;
  counted_at: string | null;
  adjustment_id: number | null;
}

export interface StockTakeSession {
  id: number;
  session_number: string;
  status: string;
  scope: string;
  location_id: number | null;
  location_name: string | null;
  product_id: number | null;
  notes: string | null;
  instructions: string | null;
  completion_notes: string | null;
  total_lines: number;
  counted_lines: number;
  variance_lines: number;
  net_variance: number;
  started_by_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  progress_percent: number;
  counts?: StockTakeCountLine[];
}

// --- Receiving discrepancies ---------------------------------------------

export interface ReceivingDiscrepancy {
  id: number;
  task_id: number;
  task_number: string | null;
  purchase_order_id: number | null;
  product_id: number;
  product_name: string | null;
  product_code: string | null;
  supplier_name: string | null;
  quantity_expected: number;
  quantity_scanned: number;
  difference: number;
  direction: 'SHORT' | 'OVER';
  status: string;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string | null;
}

export interface DiscrepancyList {
  items: ReceivingDiscrepancy[];
  total: number;
  open_count: number;
  by_supplier: { supplier_name: string; open: number; short: number; over: number }[];
}

// --- Labels --------------------------------------------------------------

export interface LabelPrintConfig {
  default_mode: 'THERMAL' | 'A4';
  symbology: 'QR' | 'CODE128';
  qr_ecc: 'L' | 'M' | 'Q' | 'H';
  thermal: { width_mm: number; height_mm: number; dpi: number };
  a4: {
    sheet: string;
    cols: number;
    rows: number;
    label_width_mm: number;
    label_height_mm: number;
    margin_top_mm: number;
    margin_left_mm: number;
    gap_x_mm: number;
    gap_y_mm: number;
  };
  fields: {
    product_name: boolean;
    item_code: boolean;
    warranty_months: boolean;
    manufacturer_serial: boolean;
    unit_code: boolean;
    location: boolean;
  };
}

export interface LabelPrintConfigResponse {
  config: LabelPrintConfig;
  defaults: LabelPrintConfig;
  field_keys: (keyof LabelPrintConfig['fields'])[];
}

export interface LabelRow {
  unit_id: number;
  code: string;
  barcode: string | null;
  unit_code: string | null;
  manufacturer_serial: string | null;
  status: string;
  product_name: string | null;
  item_code: string | null;
  brand: string | null;
  warranty_months: number | null;
  warranty_end: string | null;
  location: string | null;
  image_path: string | null;
}

// --- Report templates ----------------------------------------------------

export interface ReportBlockField {
  key: string;
  label: string;
}

export interface ReportBlockSpec {
  label: string;
  description: string;
  fields: ReportBlockField[];
  default_fields: string[];
}

export interface ReportBlock {
  id: string;
  type: string;
  visible: boolean;
  title: string;
  fields: string[];
}

export interface ReportTemplateConfig {
  version: number;
  doc_type: string;
  paper: { size: string; orientation: string; margin_mm: number };
  theme: { accent: string; font: string; font_size: number };
  options: { show_page_numbers: boolean; show_footer_line: boolean; zebra_rows: boolean };
  blocks: ReportBlock[];
}

export interface ReportTemplate {
  id: number | null;
  name: string;
  doc_type: string;
  paper_size: string;
  orientation: string;
  is_default: boolean;
  is_active: boolean;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  config?: ReportTemplateConfig;
}

export interface ReportTemplateCatalog {
  block_catalog: Record<string, ReportBlockSpec>;
  doc_types: { key: string; label: string; default_title: string }[];
  paper_specs: Record<string, { width_mm: number; height_mm: number }>;
  default_configs: Record<string, ReportTemplateConfig>;
}

export interface SalesOrderPrintData {
  template: {
    id: number | null;
    name: string;
    doc_type: string;
    paper_size: string;
    orientation: string;
    config: ReportTemplateConfig;
  };
  company: Record<string, string>;
  order: {
    id: number;
    order_number: string;
    status: string;
    order_date: string | null;
    created_at: string | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    keyed_to_obm_at: string | null;
    currency: string;
    notes: string | null;
    obm_reference_number: string | null;
    customer: {
      id: number;
      name: string;
      code: string;
      phone: string;
      address: string;
      email: string;
    } | null;
    salesman: string | null;
    delivery_address_snapshot: string | null;
    delivery_address: string | null;
    contact_snapshot: string | null;
    totals: {
      gross_subtotal: number;
      line_discount_total: number;
      subtotal: number;
      order_discount: number;
      discount_total: number;
      tax: number;
      total: number;
      discount_type: string;
      discount_value: number;
      discount_reason: string | null;
      discount_requires_approval: boolean;
    };
    items: {
      id: number;
      product_id: number | null;
      product_name: string | null;
      product_code: string | null;
      quantity: number;
      unit_price: number;
      gross: number;
      discount_type: string;
      discount_value: number;
      discount: number;
      order_discount_share: number;
      tax: number;
      line_total: number;
      notes: string | null;
    }[];
  };
  discounts: {
    product_name: string | null;
    product_code: string | null;
    quantity: number;
    gross: number;
    discount: number;
    net: number;
  }[];
  serials: {
    product_id: number;
    product_name: string | null;
    serial_number: string;
    barcode: string | null;
    status: string;
    warehouse_location: string | null;
    warranty_months: number | null;
    warranty_start: string | null;
    warranty_end: string | null;
  }[];
  generated_at: string;
}

export interface AuditLog {
  id: number;
  created_at: string;
  request_id: string;
  actor_type: string;
  actor_user_id: number;
  actor_name: string | null;
  actor_role_at_time: string;
  action: string;
  entity_type: string;
  entity_id: number;
  entity_label: string;
  old_values_json: Record<string, any>;
  new_values_json: Record<string, any>;
  ip_address: string;
  user_agent: string;
  result: string;
  error_message: string;
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  permissions: string[];
  must_change_password: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  message: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface Setting {
  id: number;
  key: string;
  value_json: any;
  updated_at: string;
}
