import client from './client'

export interface TaxProfile {
  id: number
  code: string
  name: string
  country: string
  currency: string
  tax_type: string
  rate: number
  price_includes_tax: boolean
}

export interface ProductCategory {
  id: number
  name: string
  slug: string
  description?: string | null
  parent_id?: number | null
  sort_order?: number
}

export interface Supplier {
  id: number
  code: string | null
  name: string
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  obm_supplier_code?: string | null
  is_active: boolean
}

export interface SupplierDiscrepancies {
  supplier: Supplier
  total: number
  open: number
  outstanding_units: number
  items: {
    id: number
    status: string
    direction: string
    quantity_expected: number
    quantity_scanned: number
    difference: number
    created_at: string
  }[]
}

export interface SupplierInput {
  name: string
  code?: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  obm_supplier_code?: string
}

export const masterDataApi = {
  taxProfiles: () => client.get<TaxProfile[]>('/master-data/tax-profiles'),
  brands: () => client.get<{ id: number; name: string; normalized_name: string }[]>('/master-data/brands'),
  categories: () => client.get<ProductCategory[]>('/master-data/categories'),
  createCategory: (data: { name: string; description?: string }) => client.post<ProductCategory>('/master-data/categories', data),

  // --- suppliers ---
  // `q` searches by name/code; the backend matches the normalized form too, so
  // any casing or spacing finds the one real vendor.
  suppliers: (params?: { q?: string; include_inactive?: boolean }) =>
    client.get<Supplier[]>('/master-data/suppliers', { params }),
  supplier: (id: number) => client.get<Supplier>(`/master-data/suppliers/${id}`),
  createSupplier: (data: SupplierInput) => client.post<Supplier>('/master-data/suppliers', data),
  updateSupplier: (id: number, data: Partial<SupplierInput> & { is_active?: boolean }) =>
    client.patch<Supplier>(`/master-data/suppliers/${id}`, data),
  supplierDiscrepancies: (id: number) =>
    client.get<SupplierDiscrepancies>(`/master-data/suppliers/${id}/discrepancies`),
}
