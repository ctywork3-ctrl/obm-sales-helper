/**
 * The 401 interceptor must still do its actual job.
 *
 * The warranty work narrowed the redirect rule so public pages survive a 401.
 * That fix is only correct if the staff case still works: an expired session on
 * /app/... must land on the staff login, not sit on a broken page.
 *
 * Run: npm run check:auth-redirect
 */
import { pathToFileURL } from 'url'

const pw = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_PATH ||
      'C:/Users/chiam/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js'
  ).href
)
const chromium = pw.chromium ?? pw.default?.chromium
const APP = process.env.APP_URL || 'http://127.0.0.1:3000'

const problems = []
let checks = 0
function check(label, ok, detail = '') {
  checks++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })

try {
  // No cookies at all -> /app must bounce to the staff login.
  const anon = await browser.newPage()
  await anon.goto(`${APP}/app/purchase-orders`, { waitUntil: 'networkidle' })
  await anon.waitForTimeout(2000)
  check('anonymous /app redirects to the staff login',
        anon.url().includes('/app/login'), anon.url().replace(APP, ''))
  await anon.close()

  // A stale cookie that the server rejects -> same result.
  const stale = await browser.newContext()
  await stale.addCookies([
    { name: 'access_token', value: 'garbage', domain: '127.0.0.1', path: '/' },
  ])
  const stalePage = await stale.newPage()
  await stalePage.goto(`${APP}/app/purchase-orders`, { waitUntil: 'networkidle' })
  await stalePage.waitForTimeout(2000)
  check('stale session redirects to the staff login',
        stalePage.url().includes('/app/login'), stalePage.url().replace(APP, ''))
  await stale.close()

  // And the public pages must NOT be dragged along.
  const pub = await browser.newPage()
  await pub.goto(`${APP}/warranty`, { waitUntil: 'networkidle' })
  await pub.waitForTimeout(1500)
  check('public warranty page is untouched by a 401',
        pub.url().includes('/warranty'), pub.url().replace(APP, ''))
  await pub.close()
} catch (err) {
  check('unexpected failure', false, String(err).slice(0, 250))
} finally {
  await browser.close()
}

console.log('\n' + '='.repeat(62))
if (problems.length) {
  console.log(` ${problems.length} FAILED of ${checks}:`)
  for (const p of problems) console.log(`   - ${p}`)
  process.exit(1)
}
console.log(` All ${checks} auth-redirect checks passed.`)
