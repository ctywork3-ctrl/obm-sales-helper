import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page: number
  pages: number
  onPageChange: (page: number) => void
  className?: string
}

export default function Pagination({ page, pages, onPageChange, className }: PaginationProps) {
  if (pages <= 1) return null

  const getPageNumbers = () => {
    const delta = 2
    const range = []
    const rangeWithDots = []

    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= page - delta && i <= page + delta)) {
        range.push(i)
      }
    }

    let prev = 0
    for (const i of range) {
      if (prev) {
        if (i - prev === 2) {
          rangeWithDots.push(prev + 1)
        } else if (i - prev !== 1) {
          rangeWithDots.push('...')
        }
      }
      rangeWithDots.push(i)
      prev = i
    }

    return rangeWithDots
  }

  return (
    <nav className={cn('flex items-center justify-center gap-1', className)}>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {getPageNumbers().map((pageNum, idx) =>
        pageNum === '...' ? (
          <span key={`dots-${idx}`} className="px-2 text-muted-foreground">
            ...
          </span>
        ) : (
          <button
            key={pageNum}
            onClick={() => onPageChange(pageNum as number)}
            className={cn(
              'inline-flex h-9 min-w-[36px] items-center justify-center rounded-md px-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground',
              page === pageNum && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
            )}
          >
            {pageNum}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pages}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  )
}
