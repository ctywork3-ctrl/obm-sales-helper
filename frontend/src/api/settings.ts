import client from './client'
import type { Setting } from '@/types'

export interface SettingsData {
  company_name?: string
  company_address?: string
  company_phone?: string
  company_email?: string
  default_currency?: string
  obm_api_url?: string
  obm_api_key?: string
  [key: string]: any
}

export const settingsApi = {
  get: () =>
    client<{ items: Setting[] }>('/settings'),

  getByKey: (key: string) =>
    client.get<Setting>(`/settings/${key}`),

  update: (key: string, value: any) =>
    client.patch<Setting>(`/settings/${key}`, { value_json: value }),

  bulkUpdate: (data: SettingsData) => {
    const payload = Object.entries(data).map(([key, value]) => ({
      key,
      value_json: { value },
    }))
    return client.patch('/settings', payload)
  },
}
