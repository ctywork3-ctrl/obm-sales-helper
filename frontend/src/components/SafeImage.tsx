import { useState } from 'react'
import { ImageOff } from 'lucide-react'

interface SafeImageProps {
  src?: string | null
  alt: string
  className?: string
  fallbackClassName?: string
}

export default function SafeImage({ src, alt, className = '', fallbackClassName = '' }: SafeImageProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-400 ${fallbackClassName || className}`}>
        <ImageOff className="h-5 w-5" aria-label="Image unavailable" />
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
}
