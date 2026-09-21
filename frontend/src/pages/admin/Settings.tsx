import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSettings, useBulkUpdateSettings } from '@/hooks/useSettings'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import LoadingSpinner from '@/components/LoadingSpinner'
import { Save } from 'lucide-react'

export default function Settings() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useBulkUpdateSettings()

  // Tells the user honestly whether the OBM link is configured — and that the
  // connector is not built, so those fields are not silently decorative.
  const { data: obmStatus } = useQuery({
    queryKey: ['obm-status'],
    queryFn: () => purchaseOrdersApi.obmStatus().then((res) => res.data),
  })

  const [formData, setFormData] = useState({
    company_name: '',
    company_address: '',
    company_phone: '',
    company_email: '',
    default_currency: 'MYR',
    obm_api_url: '',
    obm_api_key: '',
    enable_obm_sync: false,
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (settings) {
      const data: any = {}
      settings.forEach((s) => {
        // value_json is stored as { value: <raw> }; unwrap (recursively, in
        // case older saves nested it) so inputs always hold raw values.
        let v: any = (s as any).value_json
        while (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && Object.keys(v).length === 1) {
          v = (v as any).value
        }
        data[s.key] = v ?? ''
      })
      setFormData((prev) => ({ ...prev, ...data }))
    }
  }, [settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      await updateSettings.mutateAsync(formData)
      setSuccess('Settings saved successfully')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save settings')
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">
            {success}
          </div>
        )}

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Company Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Company Name</label>
              <input
                type="text"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Address</label>
              <textarea
                value={formData.company_address}
                onChange={(e) => setFormData({ ...formData, company_address: e.target.value })}
                rows={2}
                className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Phone</label>
                <input
                  type="tel"
                  value={formData.company_phone}
                  onChange={(e) => setFormData({ ...formData, company_phone: e.target.value })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={formData.company_email}
                  onChange={(e) => setFormData({ ...formData, company_email: e.target.value })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Default Currency</label>
              <select
                value={formData.default_currency}
                onChange={(e) => setFormData({ ...formData, default_currency: e.target.value })}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="MYR">MYR - Malaysian Ringgit</option>
                <option value="SGD">SGD - Singapore Dollar</option>
                <option value="USD">USD - US Dollar</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">OBM Integration</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {obmStatus?.message ||
              'These settings are saved but nothing reads them yet — automatic PO import from OBM is not built.'}
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium">API URL</label>
              <input
                type="url"
                value={formData.obm_api_url}
                onChange={(e) => setFormData({ ...formData, obm_api_url: e.target.value })}
                placeholder="https://api.obm.example.com"
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">API Key</label>
              <input
                type="password"
                value={formData.obm_api_key}
                onChange={(e) => setFormData({ ...formData, obm_api_key: e.target.value })}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.enable_obm_sync}
                onChange={(e) => setFormData({ ...formData, enable_obm_sync: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              Enable automatic sync when the OBM connector is built
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
