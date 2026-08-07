import { useParams, useNavigate } from 'react-router-dom'
import { useProduct, useDeleteProductImage, useSetPrimaryImage } from '@/hooks/useProducts'
import FileUpload from '@/components/FileUpload'
import { useUploadProductImage } from '@/hooks/useProducts'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmDialog from '@/components/ConfirmDialog'
import { ArrowLeft, Trash2, Star } from 'lucide-react'
import { getUploadUrl } from '@/api/client'
import { useState } from 'react'

export default function ProductImages() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [deleteImageId, setDeleteImageId] = useState<number | null>(null)

  const { data: product, isLoading } = useProduct(Number(id))
  const uploadImage = useUploadProductImage()
  const deleteImage = useDeleteProductImage()
  const setPrimary = useSetPrimaryImage()

  const handleUpload = async (file: File) => {
    try {
      await uploadImage.mutateAsync({ id: Number(id), file })
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to upload image')
    }
  }

  const handleDelete = async () => {
    if (deleteImageId) {
      await deleteImage.mutateAsync({ productId: Number(id), imageId: deleteImageId })
      setDeleteImageId(null)
    }
  }

  const handleSetPrimary = async (imageId: number) => {
    await setPrimary.mutateAsync({ productId: Number(id), imageId })
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
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold">Product Images</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {product?.name} ({product?.obm_item_code || product?.item_code})
        </p>

        <div className="mb-6">
          <FileUpload onFileSelect={handleUpload} />
          {uploadImage.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">Uploading...</p>
          )}
        </div>

        {product?.images && product.images.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {product.images.map((image) => (
              <div
                key={image.id}
                className="relative overflow-hidden rounded-lg border"
              >
                <img
                  src={getUploadUrl(image.file_path)}
                  alt={image.original_filename}
                  className="aspect-square w-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 transition-colors hover:bg-black/20">
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    <button
                      onClick={() => handleSetPrimary(image.id)}
                      disabled={image.is_primary}
                      className={`rounded-full p-1.5 ${
                        image.is_primary
                          ? 'bg-yellow-400 text-white'
                          : 'bg-white/80 text-gray-600 hover:bg-white'
                      }`}
                      title={image.is_primary ? 'Primary image' : 'Set as primary'}
                    >
                      <Star className="h-3 w-3" fill={image.is_primary ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => setDeleteImageId(image.id)}
                      className="rounded-full bg-white/80 p-1.5 text-gray-600 hover:bg-white hover:text-destructive"
                      title="Delete image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {image.is_primary && (
                  <div className="absolute left-2 top-2 rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-medium text-white">
                    Primary
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No images uploaded yet
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteImageId}
        onOpenChange={(open) => !open && setDeleteImageId(null)}
        title="Delete Image"
        description="Are you sure you want to delete this image?"
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteImage.isPending}
      />
    </div>
  )
}
