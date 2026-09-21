/**
 * Checks the offline scan queue's guarantees.
 *
 * Run with:  node scripts/check-offline-queue.mjs
 *
 * There is no frontend test runner in this project, and adding one for a single
 * module is not worth the dependency. Instead this uses esbuild (already
 * present via Vite) to compile the TypeScript on the fly and exercises it
 * against a fake localStorage.
 *
 * The queue is the one piece of the offline story where a bug silently loses a
 * store keeper's work, so it is worth proving rather than assuming.
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '..', 'src', 'lib', 'offlineQueue.ts')
const outFile = path.join(os.tmpdir(), `offlineQueue.${Date.now()}.mjs`)

await build({
  entryPoints: [source],
  outfile: outFile,
  format: 'esm',
  bundle: false,
  target: 'es2020',
  logLevel: 'silent',
})

// Minimal localStorage so the module's `window.localStorage` access works.
class FakeStorage {
  constructor() { this.map = new Map() }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, String(value)) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear() }
}

globalThis.window = { localStorage: new FakeStorage() }

const queue = await import(`file://${outFile.replace(/\\/g, '/')}`)
const {
  enqueue, readQueue, queueLength, removeEntries, clearQueue,
  flushQueue, ScanRejected, makeScanId,
} = queue

let passed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL  ${label}  ${detail}`)
  }
}

console.log('='.repeat(60))
console.log(' Offline scan queue')
console.log('='.repeat(60))

console.log('\n[1] Enqueue and persistence')
clearQueue()
const first = enqueue({ taskId: 7, taskLineId: 70, code: 'ROD-001' })
check('enqueue returns an entry', first !== null && first.code === 'ROD-001')
check('entry is persisted', queueLength() === 1, String(queueLength()))
check('entry carries a queuedAt timestamp', typeof first.queuedAt === 'string' && first.queuedAt.length > 10)

console.log('\n[2] Duplicate suppression')
const duplicate = enqueue({ taskId: 7, taskLineId: 70, code: 'ROD-001' })
check('same code on the same task is not queued twice', duplicate === null)
check('queue still holds one entry', queueLength() === 1, String(queueLength()))

const otherTask = enqueue({ taskId: 8, taskLineId: 80, code: 'ROD-001' })
check('same code on a different task is allowed', otherTask !== null)
check('queue now holds two entries', queueLength() === 2, String(queueLength()))

console.log('\n[3] Order is preserved (oldest first)')
clearQueue()
for (const code of ['A-1', 'A-2', 'A-3']) enqueue({ taskId: 1, taskLineId: 10, code })
const order = readQueue().map((entry) => entry.code)
check('readQueue returns insertion order', JSON.stringify(order) === JSON.stringify(['A-1', 'A-2', 'A-3']), JSON.stringify(order))

console.log('\n[4] Flush sends everything and empties the queue')
const sentOrder = []
const ok = await flushQueue(async (entry) => {
  sentOrder.push(entry.code)
  return { message: `${entry.code} ok` }
})
check('all three were sent', ok.sent === 3, String(ok.sent))
check('none rejected', ok.rejected === 0, String(ok.rejected))
check('nothing left queued', ok.remaining === 0, String(ok.remaining))
check('sent oldest-first', JSON.stringify(sentOrder) === JSON.stringify(['A-1', 'A-2', 'A-3']), JSON.stringify(sentOrder))
check('queue is empty afterwards', queueLength() === 0, String(queueLength()))

console.log('\n[5] A network failure keeps the entry (never lose a scan)')
clearQueue()
enqueue({ taskId: 1, taskLineId: 10, code: 'NET-1' })
const networkFail = await flushQueue(async () => {
  throw new Error('Network Error')   // no ScanRejected => treated as unreachable
})
check('nothing reported as sent', networkFail.sent === 0, String(networkFail.sent))
check('entry is still queued', networkFail.remaining === 1, String(networkFail.remaining))
check('entry survives in storage', queueLength() === 1, String(queueLength()))

console.log('\n[6] A server rejection drops the entry (retrying would never work)')
clearQueue()
enqueue({ taskId: 1, taskLineId: 10, code: 'DUP-1' })
const rejected = await flushQueue(async () => {
  throw new ScanRejected('Serial already registered')
})
check('counted as rejected', rejected.rejected === 1, String(rejected.rejected))
check('removed from the queue', rejected.remaining === 0, String(rejected.remaining))
check('the reason is surfaced to the worker',
  rejected.messages.some((m) => m.includes('already registered')),
  JSON.stringify(rejected.messages))

console.log('\n[7] A mid-flush network drop stops and preserves the remainder')
clearQueue()
for (const code of ['M-1', 'M-2', 'M-3']) enqueue({ taskId: 1, taskLineId: 10, code })
let attempts = 0
const partial = await flushQueue(async () => {
  attempts += 1
  if (attempts === 2) throw new Error('Network Error')
  return {}
})
check('only the first one got through', partial.sent === 1, String(partial.sent))
check('the remaining two stay queued', partial.remaining === 2, String(partial.remaining))
check('the retry stopped rather than hammering',
  JSON.stringify(readQueue().map((e) => e.code)) === JSON.stringify(['M-2', 'M-3']),
  JSON.stringify(readQueue().map((e) => e.code)))

console.log('\n[8] Flushing one task leaves other tasks alone')
clearQueue()
enqueue({ taskId: 1, taskLineId: 10, code: 'T1-A' })
enqueue({ taskId: 2, taskLineId: 20, code: 'T2-A' })
const scoped = await flushQueue(async () => ({}), 1)
check('only task 1 was flushed', scoped.sent === 1, String(scoped.sent))
check('task 1 queue is empty', queueLength(1) === 0, String(queueLength(1)))
check('task 2 queue is untouched', queueLength(2) === 1, String(queueLength(2)))
check('the other task entry is intact',
  readQueue().some((e) => e.code === 'T2-A'), JSON.stringify(readQueue().map((e) => e.code)))

console.log('\n[9] Corrupt storage does not break scanning')
clearQueue()
globalThis.window.localStorage.setItem('obm.pendingScans.v1', '{not json')
check('unparseable storage reads as an empty queue', queueLength() === 0, String(queueLength()))
globalThis.window.localStorage.setItem(
  'obm.pendingScans.v1',
  JSON.stringify([{ id: 'x', code: 'OK-1', taskId: 1, taskLineId: 2 }, { nope: true }, null]),
)
check('malformed entries are filtered out', queueLength() === 1, String(queueLength()))

console.log('\n[10] Removing entries by id')
clearQueue()
const a = enqueue({ taskId: 1, taskLineId: 10, code: 'R-1' })
const b = enqueue({ taskId: 1, taskLineId: 10, code: 'R-2' })
removeEntries([a.id])
check('only the targeted entry is removed',
  queueLength() === 1 && readQueue()[0].id === b.id,
  JSON.stringify(readQueue().map((e) => e.code)))
removeEntries([])
check('removing nothing is a no-op', queueLength() === 1, String(queueLength()))

console.log('\n[11] Ids are unique')
const ids = new Set(Array.from({ length: 200 }, () => makeScanId()))
check('200 generated ids are unique', ids.size === 200, String(ids.size))

console.log('\n[12] A scan phase is carried and deduped separately')
clearQueue()
const dispatchScan = enqueue({ taskId: 5, taskLineId: 0, code: 'TR-1', phase: 'DISPATCH' })
check('phase is stored on the entry', dispatchScan?.phase === 'DISPATCH', String(dispatchScan?.phase))
check('the same code can also queue for RECEIVE',
  enqueue({ taskId: 5, taskLineId: 0, code: 'TR-1', phase: 'RECEIVE' }) !== null)
check('both phases are queued', queueLength() === 2, String(queueLength()))
check('the same code and phase is not queued twice',
  enqueue({ taskId: 5, taskLineId: 0, code: 'TR-1', phase: 'DISPATCH' }) === null)
check('still only two entries', queueLength() === 2, String(queueLength()))

const phases = readQueue().map((entry) => entry.phase)
check('both phases survive a reload', JSON.stringify(phases) === JSON.stringify(['DISPATCH', 'RECEIVE']),
  JSON.stringify(phases))

const seenPhases = []
await flushQueue(async (entry) => {
  seenPhases.push(entry.phase)
  return {}
})
check('the phase reaches the sender', JSON.stringify(seenPhases) === JSON.stringify(['DISPATCH', 'RECEIVE']),
  JSON.stringify(seenPhases))

clearQueue()
enqueue({ taskId: 6, taskLineId: 0, code: 'NO-PHASE' })
check('a scan without a phase still works', queueLength() === 1 && readQueue()[0].phase === undefined,
  JSON.stringify(readQueue()[0]))

clearQueue()
fs.rmSync(outFile, { force: true })

console.log('\n' + '='.repeat(60))
console.log(` ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log(' Failures:')
  for (const failure of failures) console.log(`   - ${failure}`)
}
console.log('='.repeat(60))

process.exit(failures.length ? 1 : 0)
