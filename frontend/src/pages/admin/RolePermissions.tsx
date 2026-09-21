import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import client from '@/api/client'
import LoadingSpinner from '@/components/LoadingSpinner'
import { getRoleDisplayName } from '@/lib/utils'
import { Shield, Save, RotateCcw } from 'lucide-react'

interface RolePermission {
  id: number
  role: string
  page_key: string
  label: string
  is_visible: boolean
}

interface RolePermissionsByRole {
  role: string
  pages: RolePermission[]
}

export default function RolePermissions() {
  const { user } = useAuth()
  const [data, setData] = useState<RolePermissionsByRole[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchPermissions()
  }, [])

  const fetchPermissions = async () => {
    try {
      const res = await client.get<RolePermissionsByRole[]>('/role-permissions')
      setData(res.data)
    } catch (err) {
      console.error('Failed to load permissions', err)
    } finally {
      setIsLoading(false)
    }
  }

  const togglePermission = (role: string, pageKey: string) => {
    setData((prev) =>
      prev.map((rp) => {
        if (rp.role !== role) return rp
        return {
          ...rp,
          pages: rp.pages.map((p) =>
            p.page_key === pageKey ? { ...p, is_visible: !p.is_visible } : p
          ),
        }
      })
    )
  }

  const savePermissions = async (role: string) => {
    setIsSaving(true)
    setMessage('')
    try {
      const roleData = data.find((r) => r.role === role)
      if (!roleData) return

      await client.put(`/role-permissions/${role}`, roleData.pages.map((p) => ({
        role: p.role,
        page_key: p.page_key,
        label: p.label,
        is_visible: p.is_visible,
      })))
      setMessage(`Permissions saved for ${getRoleDisplayName(role)}`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('Failed to save permissions')
    } finally {
      setIsSaving(false)
    }
  }

  const resetToDefaults = async () => {
    if (!window.confirm('Reset ALL role page permissions to the recommended defaults? Unsaved changes will be lost.')) return
    setIsSaving(true)
    setMessage('')
    try {
      await client.post('/role-permissions/reset-defaults')
      await fetchPermissions()
      setMessage('Permissions reset to defaults')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('Failed to reset permissions')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (user?.role !== 'IT_ADMIN' && user?.role !== 'DEVELOPER') {
    return (
      <div className="py-12 text-center text-muted-foreground">
        You don't have permission to access this page.
      </div>
    )
  }

  const allPageKeys = data.length > 0 ? data[0].pages.map((p) => p.page_key) : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Menu Access</h1>
          <p className="text-muted-foreground">
            Tick the pages each role can see in the menu.
          </p>
        </div>
        <button
          onClick={resetToDefaults}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </button>
      </div>

      {message && (
        <div className={`rounded-md p-3 text-sm ${
          message.includes('Failed') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
        }`}>
          {message}
        </div>
      )}

      <div className="grid gap-6">
        {data.map((roleData) => (
          <div key={roleData.role} className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">{getRoleDisplayName(roleData.role)}</h2>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {roleData.role}
                </span>
              </div>
              <button
                onClick={() => savePermissions(roleData.role)}
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {roleData.pages.map((page) => (
                <label
                  key={page.page_key}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                    page.is_visible
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-200 bg-gray-50 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={page.is_visible}
                    onChange={() => togglePermission(roleData.role, page.page_key)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">{page.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
