import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { storeProductsApi, StoreProduct } from '@/api/store'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { ArrowLeft, BriefcaseBusiness } from 'lucide-react'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [selectedImage, setSelectedImage] = useState(0)

  const { data: product, isLoading } = useQuery({
    queryKey: ['store-product', id],
    queryFn: () => storeProductsApi.get(Number(id)).then((res) => res.data),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="py-16 text-center text-gray-500">
        Product not found
        <div className="mt-4">
          <Link to="/catalog" className="text-blue-600 hover:underline">Back to Catalog</Link>
        </div>
      </div>
    )
  }

  const images = product.images || []

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Images */}
        <div className="space-y-4">
          <div className="aspect-square rounded-xl overflow-hidden bg-gray-100">
            {images[selectedImage] ? (
              <img
                src={getUploadUrl(images[selectedImage].file_path)}
                alt={product.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                No Image Available
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(idx)}
                  className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 ${
                    selectedImage === idx ? 'border-blue-600' : 'border-transparent'
                  }`}
                >
                  <img
                    src={getUploadUrl(img.file_path)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-6">
          <div>
            {product.brand && (
              <p className="text-sm text-blue-600 font-medium mb-1">{product.brand}</p>
            )}
            <h1 className="text-2xl font-bold">{product.name}</h1>
            {product.item_code && (
              <p className="text-sm text-gray-500 mt-1">SKU: {product.item_code}</p>
            )}
          </div>

          <div className="text-3xl font-bold text-blue-600">
            {formatCurrency(product.selling_price)}
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
              product.stock_qty > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {product.stock_qty > 0 ? `${product.stock_qty} in stock` : 'Out of Stock'}
            </span>
          </div>

          {product.description && (
            <div className="prose prose-sm text-gray-600">
              <p>{product.description}</p>
            </div>
          )}

          <div className="space-y-2 text-sm">
            {product.category && (
              <div className="flex gap-2">
                <span className="text-gray-500">Category:</span>
                <span>{product.category}</span>
              </div>
            )}
            {product.uom && (
              <div className="flex gap-2">
                <span className="text-gray-500">Unit:</span>
                <span>{product.uom}</span>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <Link to="/app/login" className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700">
              <BriefcaseBusiness className="h-5 w-5" />
              Staff: Create Sales Order
            </Link>
            <p className="mt-2 text-center text-xs text-gray-500">
              Staff can sign in to create an order for this product.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
