import client from './client'
import type { LabelPrintConfig, LabelPrintConfigResponse, LabelRow } from '@/types'

export const labelsApi = {
  getConfig: () =>
    client.get<LabelPrintConfigResponse>('/labels/config'),

  saveConfig: (config: LabelPrintConfig) =>
    client.put<{ config: LabelPrintConfig; message: string }>('/labels/config', { config }),

  /** Label-ready rows for a set of units, in the order given. */
  renderData: (unitIds: number[]) =>
    client.post<{ labels: LabelRow[]; count: number }>('/labels/render-data', { unit_ids: unitIds }),

  lookupUnit: (code: string) =>
    client.get<{ label: LabelRow }>('/labels/lookup-unit', { params: { code } }),
}
