import { ArrowLeft, ChevronRight } from 'lucide-react'

interface WorkflowHeaderProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  backLabel?: string
  onBack: () => void
  status?: string
  actions?: React.ReactNode
}

export default function WorkflowHeader({
  title,
  subtitle,
  icon,
  backLabel = 'Back',
  onBack,
  status,
  actions,
}: WorkflowHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="mt-0.5 inline-flex h-10 items-center gap-1 rounded-lg border bg-white px-3 text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
          aria-label={backLabel}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{backLabel}</span>
        </button>
        {icon && (
          <div className="hidden h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
            {icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {status && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{status}</span>}
          </div>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 sm:pt-1">{actions}</div>}
    </div>
  )
}
