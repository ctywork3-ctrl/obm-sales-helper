/**
 * Browser check for the CSV purchase-order import screen.
 *
 * Why a real browser: typecheck and a passing API test prove the pieces work,
 * not that the page renders. This logs in as a purchasing user, opens the
 * Import screen, attaches a CSV, walks the preview, commits, and then checks
 * the purchase-order list shows the result — including the "not linked" badge
 * for a vendor that has no supplier record.
 *
 * Run: node scripts/check-import-screen.mjs
 *
 * Playwright is resolved by absolute path because it lives in the managed Node
 * workspace, and NODE_PATH does not apply to ESM imports. The path must be a
 * file:// URL or Windows rejects the "c:" scheme. Override with
 * PLAYWRIGHT_PATH if it moves.
 */
import { pathToFileURL } from 'url'

const playwrightPath =
  process.env.PLAYWRIGHT_PATH ||
  'C:/Users/chiam/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js'

const pw = await import(pathToFileURL(playwrightPath).href)
// Playwright's entry is CommonJS, so the named exports may sit on `.default`.
const chromium = pw.chromium ?? pw.default?.chromium
if (!chromium) {
  throw new Error(`Could not find chromium in ${playwrightPath}`)
}
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_URL || 'http://127.0.0.1:3000'

const RUN = String(Date.now()).slice(-6)
const CSVPATH = join(mkdtempSync(join(tmpdir(), 'poimport-')), 'pos.csv')

writeFileSync(
  CSVPATH,
  'PO No,Supplier,Item Code,Description,Qty,Unit Price,Due Date,Remarks\n' +
    `BROWSER-${RUN},Browser Vendor ${RUN},OBM-R001,Stingray Rod 100M,4,RM88.50,15/10/2026,browser test\n` +
    `BROWSER-${RUN},Browser Vendor ${RUN},OBM-R002,Stingray Rod 200M,3,"1,250.00",15/10/2026,\n` +
    `BROWSER-BAD-${RUN},Ghost Vendor ${RUN},OBM-R003,Rod 500H,,RM210.00,20/10/2026,bad qty\n`,
  'utf-8'
)

const problems = []
let checks = 0

function check(label, ok, detail = '') {
  checks++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch({
  /*
   * Prefer the system Chrome. The bundled Chromium for this Playwright version
   * is not downloaded here, and using the real browser is a better test anyway
   * — it is what the user actually opens. Fall back to the default if needed.
   */
  channel: process.env.PW_CHANNEL || 'chrome',
})
const page = await browser.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`)
})

try {
  // ---- log in ---------------------------------------------------------
  // The purchasing demo account in this database is `purchasemanager01`.
  // (`purchase01` from the older notes does not exist here.)
  const username = process.env.APP_USER || 'purchasemanager01'
  await page.goto(`${APP}/app/login`, { waitUntil: 'networkidle' })
  await page.fill('#username', username)
  await page.fill('#password', process.env.APP_PASS || 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/app(?!\/login)/, { timeout: 25000 })
  check('logged in', true, username)

  // ---- open the import screen -----------------------------------------
  await page.goto(`${APP}/app/purchase-orders/import`, { waitUntil: 'networkidle' })
  // There are two h1s: the app shell's title and the page's own. Check the page
  // heading specifically, and confirm the screen's own copy is present — the
  // SPA shell alone would give a 200 for any path under /app.
  const headings = await page.$$eval('h1', (els) => els.map((e) => e.textContent.trim()))
  check(
    'import screen renders',
    headings.includes('Import Purchase Orders'),
    headings.join(' | ')
  )
  // It must NOT have been swallowed by the /:id route.
  const bodyText = await page.textContent('body')
  check(
    'not swallowed by the PO detail route',
    !/Purchase order not found|Not Found/i.test(bodyText || ''),
    ''
  )

  // ---- both sources are offered ---------------------------------------
  const sourceBody = (await page.textContent('body')) || ''
  check('offers OBM as a source', /From OBM/i.test(sourceBody))
  check('offers CSV as a source', /From a CSV export/i.test(sourceBody))
  check('says reading OBM never changes it', /never changes it|only ever reads/i.test(sourceBody))

  // ---- the OBM tab actually reads -------------------------------------
  // This is the feature that removes the export step, so it gets driven for
  // real rather than assumed from the API tests.
  await page.click('button:has-text("From OBM")')
  await page.waitForSelector('button:has-text("Read from OBM")', { timeout: 15000 })

  const obmPanel = (await page.textContent('body')) || ''
  if (/OBM is not linked/i.test(obmPanel)) {
    // Honest degradation: on a machine without OBM, the tab must say so and
    // point at the CSV route rather than offering a dead button.
    check('OBM tab explains it is not linked', true, 'not linked on this machine')
    check('OBM tab offers the CSV fallback', /import a CSV export/i.test(obmPanel))
  } else {
    check('OBM tab reports the connection', /Connected to OBM/i.test(obmPanel))

    await page.click('button:has-text("Read from OBM")')
    await page.waitForSelector('text=/Preview — nothing saved yet|Nothing to import/i', {
      timeout: 90000,
    })
    const obmResult = (await page.textContent('body')) || ''
    check('OBM read returns a preview', /Preview — nothing saved yet|Nothing to import/i.test(obmResult))
    check('OBM preview says how many were read', /read from OBM/i.test(obmResult))
    check('OBM preview promises no writes', /Nothing has been saved yet/i.test(obmResult))
  }

  // ---- switch to the CSV tab ------------------------------------------
  // OBM is the default source now, and the file input only exists inside the
  // CSV tab, so the tab has to be selected before uploading.
  await page.click('button:has-text("From a CSV export")')
  // The input is deliberately `hidden` (a button triggers it), so wait for it to
  // be attached, not visible.
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
  check(
    'CSV tab shows the upload prompt',
    /Choose the export/i.test((await page.textContent('body')) || ''),
    ''
  )

  // ---- attach the file ------------------------------------------------
  await page.setInputFiles('input[type="file"]', CSVPATH)

  // The preview appears once the parse returns.
  await page.waitForSelector('text=/Preview — nothing saved yet/i', { timeout: 20000 })
  check('preview rendered', true)

  const afterUpload = await page.textContent('body')

  check(
    'shows the importable order',
    afterUpload.includes(`BROWSER-${RUN}`),
    ''
  )
  check(
    'reports the bad-quantity row',
    /could not be used|quantity must be a positive number/i.test(afterUpload),
    ''
  )
  check(
    'names the order that will not import',
    afterUpload.includes(`BROWSER-BAD-${RUN}`),
    ''
  )
  check(
    'warns the vendor is not in the supplier list',
    /not in your supplier list/i.test(afterUpload),
    ''
  )
  check(
    'says nothing has been saved yet',
    /nothing saved yet/i.test(afterUpload),
    ''
  )

  // ---- commit --------------------------------------------------------
  const importButton = page.locator('button', { hasText: /^Import \d+ purchase order/i })
  check('import button is offered', (await importButton.count()) > 0, '')

  if ((await importButton.count()) > 0) {
    await importButton.first().click()
    await page.waitForSelector('text=/^Done$/i', { timeout: 20000 })
    const done = await page.textContent('body')
    check('commit reports success', /created|updated/i.test(done), '')
    check(
      'offers to view the purchase orders',
      /View purchase orders/i.test(done),
      ''
    )
  }

  // ---- the list shows it, flagged as unlinked -------------------------
  await page.goto(`${APP}/app/purchase-orders`, { waitUntil: 'networkidle' })
  await page.waitForSelector('table', { timeout: 20000 })
  const listText = await page.textContent('body')
  check(
    'imported PO appears in the list',
    new RegExp(`BROWSER-${RUN}`).test(listText || ''),
    ''
  )
  check(
    'unlinked vendor is visibly flagged',
    /not linked/i.test(listText || ''),
    ''
  )

  // ---- no runtime errors ---------------------------------------------
  // The app probes /auth/me before login and gets a 401 by design, so that is
  // noise. Anything else is a real problem.
  const realErrors = pageErrors.filter((e) => {
    if (/favicon|ResizeObserver|Download the React DevTools/i.test(e)) return false
    if (/Download the React DevTools/i.test(e)) return false
    if (/status of 401/i.test(e) || /Unauthorized/i.test(e)) return false
    if (/React Router Future Flag Warning/i.test(e)) return false
    return true
  })
  check('no runtime errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))
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
console.log(` All ${checks} browser checks passed.`)
