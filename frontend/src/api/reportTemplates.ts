import client from './client'
import type {
  ReportTemplate,
  ReportTemplateCatalog,
  SalesOrderPrintData,
} from '@/types'

export const reportTemplatesApi = {
  catalog: () => client.get<ReportTemplateCatalog>('/report-templates/catalog'),

  list: (docType?: string) =>
    client.get<ReportTemplate[]>('/report-templates', { params: { doc_type: docType } }),

  get: (id: number) => client.get<ReportTemplate>(`/report-templates/${id}`),

  defaultFor: (docType: string) =>
    client.get<ReportTemplate>(`/report-templates/default/${docType}`),

  create: (data: {
    name: string
    doc_type: string
    config: unknown
    is_default?: boolean
    notes?: string
  }) => client.post<ReportTemplate>('/report-templates', data),

  update: (id: number, data: Record<string, unknown>) =>
    client.put<ReportTemplate>(`/report-templates/${id}`, data),

  duplicate: (id: number) => client.post<ReportTemplate>(`/report-templates/${id}/duplicate`),

  setDefault: (id: number) => client.post(`/report-templates/${id}/set-default`),

  resetDefaults: () => client.post('/report-templates/reset-defaults'),

  remove: (id: number) => client.delete(`/report-templates/${id}`),

  salesOrderPrintData: (orderId: number, templateId?: number) =>
    client.get<SalesOrderPrintData>(`/report-templates/print-data/sales-order/${orderId}`, {
      params: { template_id: templateId },
    }),
}
