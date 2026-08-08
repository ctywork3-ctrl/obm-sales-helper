import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProducts, useDeleteProduct } from '@/hooks/useProducts'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { Plus, Pencil, Trash2, Image as ImageIcon } from 'lucide-react'

export default function ProductManagement() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const { data, isLoading } = useProducts({
    search: search || undefined,
    page,
    page_size: 10,
  })
  const deleteProduct = useDeleteProduct()

  const handleDelete = async () => {
    if (deleteId) {
      await deleteProduct.mutateAsync(deleteId)
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Product Management</h1>
        <div className="flex gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search products..."
            className="w-full sm:w-64"
          />
          <Link
            to="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No products found
        </div>
      ) : (
        <>
          <div className="sm:hidden space-y-3">
            {data.items.map((product) => (
              <div key={product.id} className="rounded-lg border bg-white p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                    {product.images?.[0] ? (
                      <img
                        src={getUploadUrl(product.images[0].file_path)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{product.brand}</p>
                    <p className="text-xs text-muted-foreground">{product.obm_item_code || product.item_code}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium flex-shrink-0 ${
                      product.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm border-t pt-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{product.category}</span>
                  <span className="font-semibold text-primary">{formatCurrency(product.selling_price)}</span>
                  <span className="text-muted-foreground">Stock: {product.stock_qty}</span>
                </div>
                <div className="flex items-center gap-3 pt-2 border-t">
                  <Link
                    to={`/admin/products/${product.id}/edit`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                  <Link
                    to={`/admin/products/${product.id}/images`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-accent"
                  >
                    <ImageIcon className="h-4 w-4" />
                    Images
                  </Link>
                  <button
                    onClick={() => {
                      setDeleteId(product.id)
                      setDeleteName(product.name)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-destructive hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium">Product</th>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Stock</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((product) => (
                  <tr key={product.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                          {product.images?.[0] ? (
                            <img
                              src={getUploadUrl(product.images[0].file_path)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.brand}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{product.obm_item_code || product.item_code}</td>
                    <td className="px-4 py-3">{product.category}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(product.selling_price)}</td>
                    <td className="px-4 py-3 text-right">{product.stock_qty}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          product.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {product.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/admin/products/${product.id}/edit`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <Link
                          to={`/admin/products/${product.id}/images`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => {
                            setDeleteId(product.id)
                            setDeleteName(product.name)
                          }}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm">
            Page {page} of {data.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={`Delete ${deleteName}`}
        description="Are you sure you want to delete this product? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteProduct.isPending}
      />
    </div>
  )
}
