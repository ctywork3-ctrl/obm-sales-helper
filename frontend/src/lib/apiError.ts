export function getApiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as any)?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: any) => (typeof d === 'string' ? d : d?.msg))
      .filter((m: any) => typeof m === 'string' && m.trim())
    if (msgs.length) return msgs.join('; ')
  }
  const message = (err as any)?.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  return fallback
}

export function normalizeRedirect(raw: string | null, fallback: string): string {
  if (!raw) return fallback
  const cleaned = raw.replace(/^\/+/, '')
  return cleaned || fallback
}
