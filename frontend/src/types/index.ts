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
  images: ProductImage[];
  created_at: string;
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
  currency: string;
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
  discount_amount: number;
  line_total: number;
  notes: string;
}

export interface AuditLog {
  id: number;
  created_at: string;
  request_id: string;
  actor_type: string;
  actor_user_id: number;
  actor?: User;
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
  per_page: number;
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
