import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useProduct } from '@/hooks/useProducts'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const { data: product, isLoading } = useProduct(Number(id))

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Product not found
      </div>
    )
  }

  const images = product.images || []
  const hasImages = images.length > 0

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="relative aspect-square overflow-hidden rounded-lg border bg-gray-100">
            {hasImages ? (
              <img
                src={getUploadUrl(images[currentImageIndex].file_path)}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No Image Available
              </div>
            )}

            {hasImages && images.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCurrentImageIndex((i) => (i === 0 ? images.length - 1 : i - 1))
                  }
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-sm hover:bg-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() =>
                    setCurrentImageIndex((i) => (i === images.length - 1 ? 0 : i + 1))
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-sm hover:bg-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {hasImages && images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setCurrentImageIndex(idx)}
                  className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border-2 ${
                    idx === currentImageIndex ? 'border-primary' : 'border-transparent'
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

        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <p className="mt-1 text-muted-foreground">
              {product.obm_item_code || product.item_code}
            </p>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Category</p>
                <p className="font-medium">{product.category || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Brand</p>
                <p className="font-medium">{product.brand || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">UOM</p>
                <p className="font-medium">{product.uom || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Barcode</p>
                <p className="font-medium">{product.barcode || '-'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h2 className="mb-2 text-lg font-semibold">Pricing & Stock</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Selling Price</p>
                <p className="text-xl font-bold text-primary">
                  {formatCurrency(product.selling_price)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stock Quantity</p>
                <p className="text-xl font-bold">{product.stock_qty}</p>
              </div>
            </div>
          </div>

          {product.description && (
            <div className="rounded-lg border bg-white p-4">
              <h2 className="mb-2 text-lg font-semibold">Description</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
