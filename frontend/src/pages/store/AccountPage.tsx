import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useStore } from '@/contexts/StoreContext'
import { storeAuthApi } from '@/api/store'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { User, MapPin, Package } from 'lucide-react'

export default function AccountPage() {
  const { customer, logout } = useStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('profile')
  const [form, setForm] = useState({
    full_name: customer?.full_name || '',
    phone: customer?.phone || '',
  })

  const updateMutation = useMutation({
    mutationFn: storeAuthApi.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-profile'] })
    },
  })

  if (!customer) {
    return <Navigate to="/login?redirect=account" replace />
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User className="h-4 w-4" /> },
    { id: 'orders', label: 'My Orders', icon: <Package className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Account</h1>

      <div className="flex gap-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className="rounded-xl border bg-white p-6 shadow-sm max-w-lg">
          <h2 className="text-lg font-semibold mb-4">Profile Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={customer.email}
                disabled
                className="w-full rounded-lg border bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Full Name</label>
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full rounded-lg border px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-lg border px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <div className="border-t mt-6 pt-6">
            <button
              onClick={async () => {
                await logout()
                navigate('/shop')
              }}
              className="rounded-lg border border-red-200 px-6 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="text-center py-12">
          <p className="text-gray-500">View your order history</p>
          <button
            onClick={() => navigate('/account/orders')}
            className="mt-4 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            View Orders
          </button>
        </div>
      )}
    </div>
  )
}
