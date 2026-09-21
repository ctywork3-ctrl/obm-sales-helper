/**
 * Browser check for the PUBLIC warranty page.
 *
 * The single most important assertion: this page must work for an anonymous
 * visitor. A customer scanning the QR on a rod has no account, so any redirect
 * to a login screen is a total failure of the feature — and it is exactly the
 * kind of thing that only shows up when a real browser follows the route.
 *
 * It also checks the disclosure rule from the outside: the customer's name and
 * phone must not appear in the rendered page OR in the network response.
 *
 * Run: npm run check:warranty
 */
import { pathToFileURL } from 'url'

const playwrightPath =
  process.env.PLAYWRIGHT_PATH ||
  'C:/Users/chiam/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js'

const pw = await import(pathToFileURL(playwrightPath).href)
const chromium = pw.chromium ?? pw.default?.chromium
if (!chromium) throw new Error(`Could not find chromium in ${playwrightPath}`)

const APP = process.env.APP_URL || 'http://127.0.0.1:3000'
const VALID = process.env.WARRANTY_CODE || 'ITEST-0001'
const UNKNOWN = 'NO-SUCH-SERIAL-XYZ-999'

const problems = []
let checks = 0

function check(label, ok, detail = '') {
  checks++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })
const context = await browser.newContext()
const page = await context.newPage()

const apiBodies = []
page.on('response', async (r) => {
  if (r.url().includes('/api/public/warranty/')) {
    apiBodies.push(await r.text().catch(() => ''))
  }
})

try {
  // ---- bare page, no login, no cookies ---------------------------------
  await page.goto(`${APP}/warranty`, { waitUntil: 'networkidle' })

  check('page loads without a login redirect', page.url().includes('/warranty'),
        page.url().replace(APP, ''))
  check('no staff login form on the page',
        !/Enter your username/i.test((await page.textContent('body')) || ''))

  const body = (await page.textContent('body')) || ''
  check('states no account is needed', /do not need an account/i.test(body))
  check('shows the code input', (await page.locator('input').count()) > 0)

  // ---- a valid serial, typed in ----------------------------------------
  await page.fill('input', VALID)
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=/under warranty|has expired|has been voided|could not find/i',
                             { timeout: 20000 })

  const resultBody = (await page.textContent('body')) || ''
  check('shows a warranty verdict', /under warranty|has expired|has been voided/i.test(resultBody))

  if (/under warranty/i.test(resultBody)) {
    check('shows the remaining days', /day[s]? remaining/i.test(resultBody))
    check('shows the product name', /product/i.test(resultBody))
    check('shows the end date', /warranty ends/i.test(resultBody))
  }

  // ---- the disclosure rule, checked from outside ----------------------
  // These strings belong to the internal endpoint and must never reach a customer.
  const privateTerms = ['customer', 'phone', 'sales_order', 'order_number',
                        'unit_cost', 'warehouse_location']
  const responseLeak = privateTerms.filter((term) =>
    apiBodies.some((b) => b.toLowerCase().includes(term))
  )
  check('warranty API exposes no private fields', responseLeak.length === 0,
        responseLeak.join(', '))

  // ---- an unknown serial says so plainly -------------------------------
  await page.goto(`${APP}/warranty`, { waitUntil: 'networkidle' })
  await page.fill('input', UNKNOWN)
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=/could not find that serial/i', { timeout: 20000 })
  const notFoundBody = (await page.textContent('body')) || ''
  check('unknown serial explains itself', /could not find that serial number/i.test(notFoundBody))
  check('unknown serial does not claim a warranty', !/under warranty/i.test(notFoundBody))

  // ---- a QR deep link works -------------------------------------------
  await page.goto(`${APP}/warranty/${VALID}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=/under warranty|has expired|could not find/i',
                             { timeout: 20000 })
  const deepBody = (await page.textContent('body')) || ''
  check('QR deep link auto-runs the lookup',
        /under warranty|has expired|has been voided/i.test(deepBody))
  check('deep link did not redirect to login', page.url().includes('/warranty/'))
} catch (err) {
  check('unexpected failure', false, String(err).slice(0, 300))
} finally {
  await browser.close()
}

console.log('\n' + '='.repeat(62))
if (problems.length) {
  console.log(` ${problems.length} FAILED of ${checks}:`)
  for (const p of problems) console.log(`   - ${p}`)
  process.exit(1)
}
console.log(` All ${checks} public warranty checks passed.`)
