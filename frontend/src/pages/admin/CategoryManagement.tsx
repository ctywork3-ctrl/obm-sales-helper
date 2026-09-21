import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderTree, Plus } from 'lucide-react'
import { masterDataApi } from '@/api/masterData'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'

export default function CategoryManagement() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['master-data', 'categories'],
    queryFn: () => masterDataApi.categories().then((response) => response.data),
  })
  const create = useMutation({
    mutationFn: () => masterDataApi.createCategory({ name, description: description || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-data', 'categories'] })
      setName('')
      setDescription('')
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not create category')),
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader title="Product Categories" subtitle="Manager-controlled categories used by catalog products and receiving." icon={<FolderTree className="h-5 w-5" />} backLabel="Back to products" onBack={() => window.history.back()} />
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 font-semibold">Active categories</h2>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : categories.length === 0 ? <p className="text-sm text-muted-foreground">No categories yet.</p> : <div className="divide-y">{categories.map((category) => <div key={category.id} className="flex items-center justify-between py-3"><div><p className="font-medium">{category.name}</p><p className="text-xs text-muted-foreground">{category.description || category.slug}</p></div><span className="font-mono text-xs text-muted-foreground">#{category.id}</span></div>)}</div>}
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Create category</h2>
          <div className="space-y-3"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" className="w-full rounded-md border px-3 py-2 text-sm" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={3} className="w-full rounded-md border px-3 py-2 text-sm" /><button type="button" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />{create.isPending ? 'Creating...' : 'Create category'}</button></div>
        </div>
      </div>
    </div>
  )
}
