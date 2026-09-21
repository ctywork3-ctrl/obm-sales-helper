import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { orderTemplatesApi, OrderTemplate } from '@/api/templates'
import { getApiErrorMessage } from '@/lib/apiError'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { Plus, Trash2, Copy, FileText } from 'lucide-react'

export default function OrderTemplatesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const { data: templates, isLoading } = useQuery({
    queryKey: ['order-templates'],
    queryFn: () => orderTemplatesApi.list().then((res) => res.data),
  })

  const createMutation = useMutation({
    mutationFn: orderTemplatesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-templates'] })
      setShowCreate(false)
      setNewName('')
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to create template')),
  })

  const deleteMutation = useMutation({
    mutationFn: orderTemplatesApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order-templates'] }),
  })

  const handleCreate = () => {
    if (!newName.trim()) return
    setError('')
    createMutation.mutate({
      name: newName.trim(),
      items: [],
    })
  }

  const handleApplyTemplate = (template: OrderTemplate) => {
    const itemParams = template.items
      .map((item) => `product_id=${item.product_id}&qty=${item.quantity}`)
      .join('&')
    navigate(`/app/sales/create?template=${template.id}&${itemParams}`)
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order Templates</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">Create Template</h3>
          {error && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          <div className="flex gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Template name (e.g. 'Weekly Restock')"
              className="flex-1 rounded-md border px-3 py-2 text-sm"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setError('') }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Template created empty. Apply it from Create Order page to add products.
          </p>
        </div>
      )}

      {!templates?.length ? (
        <div className="py-12 text-center text-gray-500">
          <FileText className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p>No templates yet. Create one to save frequently ordered product bundles.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onApply={handleApplyTemplate}
              onDelete={() => deleteMutation.mutate(template.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateCard({ template, onApply, onDelete }: {
  template: OrderTemplate
  onApply: (t: OrderTemplate) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{template.name}</h3>
          <p className="text-sm text-gray-500">{template.item_count} items</p>
        </div>
        <button
          onClick={onDelete}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
          title="Delete template"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {template.items.length > 0 && (
        <div className="mb-3 space-y-1">
          {template.items.slice(0, 3).map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm text-gray-600">
              <span className="truncate">{item.product_name || item.product_code}</span>
              <span className="ml-2 flex-shrink-0">×{item.quantity}</span>
            </div>
          ))}
          {template.items.length > 3 && (
            <p className="text-xs text-gray-400">+{template.items.length - 3} more items</p>
          )}
        </div>
      )}

      <button
        onClick={() => onApply(template)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <Copy className="h-4 w-4" />
        Use Template
      </button>
    </div>
  )
}
