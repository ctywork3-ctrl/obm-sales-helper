/**
 * Offline scan queue.
 *
 * A store keeper counting a delivery in a warehouse corner with no signal must
 * not lose 30 scans because the wifi dropped. When a scan cannot reach the
 * server it is written to localStorage and replayed when the connection comes
 * back.
 *
 * Two rules matter:
 *
 *  - **Never silently drop a scan.** An entry is only removed once the server
 *    has actually responded to it, either accepting it or rejecting it for a
 *    real reason (a duplicate serial, say). A network failure keeps it.
 *
 *  - **Never reorder.** Entries flush oldest-first and the queue stops at the
 *    first network failure, so a serial cannot be applied after a later one.
 */

export interface PendingScan {
  /** Client-side id, so an entry can be removed without relying on the code. */
  id: string
  /** The document this scan belongs to: a receiving task, stock take or transfer. */
  taskId: number
  /** The target line, where the endpoint needs one. `0` when the server resolves it from the code. */
  taskLineId: number
  code: string
  /**
   * Optional sub-action, for documents where one scan endpoint does two jobs —
   * a stock transfer scans `DISPATCH` out of the source and `RECEIVE` into the
   * destination, and the two must not be confused when replaying.
   */
  phase?: string
  queuedAt: string
}

const STORAGE_KEY = 'obm.pendingScans.v1'

function storage(): Storage | null {
  try {
    // Private browsing throws on access in some browsers.
    return window.localStorage
  } catch {
    return null
  }
}

export function readQueue(): PendingScan[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive: a half-written or hand-edited entry must not break scanning.
    return parsed.filter(
      (entry): entry is PendingScan =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.code === 'string' &&
        Number.isFinite(entry.taskId) &&
        Number.isFinite(entry.taskLineId),
    )
  } catch {
    return []
  }
}

export function writeQueue(entries: PendingScan[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* quota or private mode — the scan is already lost, do not throw at the caller */
  }
}

export function makeScanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Queue a scan. Returns the entry, or `null` if the same code is already
 * queued for the same task — scanning the same rod twice offline should not
 * produce two uploads that the server would reject as a duplicate anyway.
 */
export function enqueue(scan: {
  taskId: number
  taskLineId: number
  code: string
  phase?: string
}): PendingScan | null {
  const entries = readQueue()
  const alreadyQueued = entries.some(
    (entry) =>
      entry.taskId === scan.taskId &&
      entry.code === scan.code &&
      (entry.phase || '') === (scan.phase || ''),
  )
  if (alreadyQueued) return null

  const entry: PendingScan = {
    id: makeScanId(),
    taskId: scan.taskId,
    taskLineId: scan.taskLineId,
    code: scan.code,
    queuedAt: new Date().toISOString(),
  }
  if (scan.phase) entry.phase = scan.phase
  writeQueue([...entries, entry])
  return entry
}

export function removeEntries(ids: string[]): void {
  if (ids.length === 0) return
  const remove = new Set(ids)
  writeQueue(readQueue().filter((entry) => !remove.has(entry.id)))
}

export function clearQueue(): void {
  writeQueue([])
}

export function queueLength(taskId?: number): number {
  const entries = readQueue()
  return taskId === undefined ? entries.length : entries.filter((e) => e.taskId === taskId).length
}

/** A scan the server actively refused (duplicate serial, wrong product). */
export class ScanRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanRejected'
  }
}

export interface FlushResult {
  sent: number
  rejected: number
  /** Entries still queued because the network was unreachable. */
  remaining: number
  /** Messages from scans the server refused, for showing to the worker. */
  messages: string[]
}

/**
 * Replay the queue oldest-first.
 *
 * `send` should throw `ScanRejected` when the server responded and refused the
 * scan (so the entry is dropped — retrying would never succeed), and any other
 * error when the request never got there (so the entry is kept).
 */
export async function flushQueue(
  send: (scan: PendingScan) => Promise<{ message?: string } | void>,
  taskId?: number,
): Promise<FlushResult> {
  const all = readQueue()
  const entries = taskId === undefined ? all : all.filter((entry) => entry.taskId === taskId)

  const result: FlushResult = { sent: 0, rejected: 0, remaining: entries.length, messages: [] }
  const finished: string[] = []

  for (const entry of entries) {
    try {
      const response = await send(entry)
      finished.push(entry.id)
      result.sent += 1
      const message = response && typeof response === 'object' ? response.message : undefined
      if (message) result.messages.push(message)
    } catch (error) {
      if (error instanceof ScanRejected) {
        finished.push(entry.id)
        result.rejected += 1
        result.messages.push(error.message)
        continue
      }
      // Network trouble: stop here to preserve order and keep the rest queued.
      break
    }
  }

  // Only the entries we actually settled are removed, so scans belonging to
  // other tasks are left exactly as they were. (Re-adding them here would
  // duplicate every other task's queue.)
  removeEntries(finished)
  result.remaining = queueLength(taskId)
  return result
}
