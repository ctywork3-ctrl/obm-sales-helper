import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { storeProductsApi, StoreProduct } from '@/api/store'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { SlidersHorizontal } from 'lucide-react'

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'name', label: 'Name A-Z' },
]

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)

  const search = searchParams.get('search') || ''
  const category = searchParams.get('category') || ''
  const sort = searchParams.get('sort') || 'newest'
  const page = parseInt(searchParams.get('page') || '1')

  const { data, isLoading } = useQuery({
    queryKey: ['store-products', search, category, sort, page],
    queryFn: () =>
      storeProductsApi.list({
        search: search || undefined,
        category: category || undefined,
        sort,
        page,
        page_size: 12,
      }).then((res) => res.data),
  })

  const { data: categories } = useQuery({
    queryKey: ['store-categories'],
    queryFn: () => storeProductsApi.categories().then((res) => res.data),
  })

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    if (key !== 'page') params.delete('page')
    setSearchParams(params)
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      {!search && !category && (
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-blue-800 p-8 text-white">
          <h1 className="text-3xl font-bold mb-2">Product Catalog</h1>
          <p className="text-blue-100">Browse current fishing tackle, pricing, and stock availability.</p>
        </div>
      )}

      {/* Filters bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>
          {category && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
              {category}
              <button onClick={() => updateParam('category', '')} className="ml-1 hover:text-blue-600">&times;</button>
            </span>
          )}
          {search && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
              Search: "{search}"
              <button onClick={() => updateParam('search', '')} className="ml-1 hover:text-gray-800">&times;</button>
            </span>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="font-semibold mb-3">Categories</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => updateParam('category', '')}
              className={`rounded-full px-3 py-1 text-sm ${
                !category ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {categories?.map((cat) => (
              <button
                key={cat.id}
                onClick={() => updateParam('category', cat.name)}
                className={`rounded-full px-3 py-1 text-sm ${
                  category === cat.name ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-16 text-center text-gray-500">
          No products found. Try adjusting your filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => updateParam('page', String(Math.max(1, page - 1)))}
            disabled={page === 1}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm">
            Page {page} of {data.pages}
          </span>
          <button
            onClick={() => updateParam('page', String(Math.min(data.pages, page + 1)))}
            disabled={page === data.pages}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function ProductCard({ product }: { product: StoreProduct }) {
  const imageUrl = product.image_url ? getUploadUrl(product.image_url) : null

  return (
    <div className="group rounded-xl border bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/catalog/${product.id}`}>
        <div className="aspect-square bg-gray-100 relative overflow-hidden">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              No Image
            </div>
          )}
          {product.stock_qty <= 0 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">Out of Stock</span>
            </div>
          )}
        </div>
      </Link>
      <div className="p-3">
        <Link to={`/catalog/${product.id}`}>
          <p className="text-xs text-gray-500 truncate">{product.brand || product.category}</p>
          <p className="font-medium text-sm line-clamp-2 mb-2 group-hover:text-blue-600">{product.name}</p>
        </Link>
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold text-blue-600">{formatCurrency(product.selling_price)}</span>
          <Link to={`/catalog/${product.id}`} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            View details
          </Link>
        </div>
      </div>
    </div>
  )
}
