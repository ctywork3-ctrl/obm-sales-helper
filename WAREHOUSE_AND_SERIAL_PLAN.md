# Warehouse, Serial Numbers & Warranty — Design + Rollout Plan

**App:** OBM Sales Helper (season tackle **v1** — `F:\season takle webapp\backend` + `frontend`)
**Status:** Phases 1–5 built and verified, plus the CSV PO importer and the public warranty
page. See **"Still to come"** at the bottom — that section is the current source of truth
for what is and is not done, and it is kept up to date.
**Date:** 16 September 2026 (status refreshed 18 September 2026)

---

## 1. The problem you described

> 他们通常进口鱼竿这类后，然后要 store 他们点货什么？里面其实 warehouse stock 的感觉有点乱。

Fair — it *was* messy, and here is exactly why:

| Symptom | Root cause |
|---|---|
| No single answer to "how much stock do we have?" | Stock was spread over 6 unrelated pages (Scanner / Goods Received / Received History / Adjustments / PO / Units) with no hub |
| No idea who was supposed to count an incoming delivery | The PO said *what* was coming but never *who* was counting it, or whether it had been counted |
| Warranty claims were guesswork | No serial numbers existed at all, so a returned rod could not be traced to a sale, a customer or a date |
| Locations were free text | "Rack A", "rack a", "Rack-A" were three different places, so nothing was reportable |
| Counting on a phone was painful | A half-finished count could leave stock half-moved |

## 2. The model

The whole design rests on one separation of concerns:

> **The PO is a promise. The task is a person counting. The receipt is the truth.**

```
  Other accounting software          OBM Sales Helper (this app)
  ─────────────────────────          ───────────────────────────────────────────
   issues PO  ─────────────────►  PurchaseOrder  (SENT)
                                        │
                                        │  Purchase Manager issues a task
                                        ▼
                                  ReceivingTask            ← assigned to a worker
                                  (ASSIGNED → IN_PROGRESS)   with due date + priority
                                        │
                                        │  Worker opens it on their phone
                                        ▼
                                  Scan each barcode
                                  one scan = one ProductUnit
                                  (serial + barcode + warranty clock)
                                        │
                                        │  "Complete & post stock"
                                        ▼
                                  InventoryReceipt (GRN, POSTED)
                                  → stock moves, units become sellable
                                        │
                                        ▼
                                  ProductUnit: AVAILABLE
                                        │
                     sold on a sales order → SOLD + warranty_start/end + customer_id
                                        │
                                        ▼
                                  WarrantyClaim ← scan the serial, know instantly
```

### Why the task is a separate object

If you let the PO double as the counting document you get the classic bug: stock moves the moment someone touches a quantity field. Because the task is separate:

* **Nothing moves until completion.** Units are created with status `PENDING`; `stock_qty` for a serialized product counts only `AVAILABLE` units, so a half-finished count is invisible to sales.
* **The scan log is append-only.** Every scan is recorded even when rejected (`OK` / `DUPLICATE` / `WRONG_PRODUCT` / `UNKNOWN`), because "the supplier short-shipped us" and "the worker scanned it twice" are different conversations.
* **Shortfalls need a signature.** Completing a task whose count ≠ expected returns `409 COUNT_MISMATCH` listing the differences. The worker must explicitly accept the difference, and that reason is stored on the task and in the audit log.

### Serial numbers and warranty

`ProductUnit` is one physical rod/reel. It carries:

| Field | Purpose |
|---|---|
| `serial_number`, `barcode`, `manufacturer_serial` | Scannable identity (any of the three can be scanned) |
| `status` | `PENDING` → `AVAILABLE` → `RESERVED` → `SOLD` / `RETURNED` / `DAMAGED` / `QUARANTINED` |
| `warranty_months` | Snapshotted from the product at receiving time, so changing a product's term later does not rewrite history |
| `warranty_start` / `warranty_end` | Started when the order is marked *keyed to OBM* (the point of no return) |
| `customer_id`, `order_id` | The trace back to who bought it |
| `location_id` | Which rack it is on |

**Warranty lookup:** type or scan a serial → product, customer, sales order, current location, days of cover remaining, and every claim ever raised on that unit. That is the capability the OBM system never had.

### The "messy stock" fix

`Stock Overview` (`/app/warehouse`) is now the single hub:

* Per product: on-hand quantity, whether it is **Bulk** or **Serialized**, and for serialized goods a live breakdown of `available / reserved / sold` plus which locations the units sit in.
* Low-stock filter, discontinued-products toggle, and recent stock movements.
* It reports when the list is capped (`showing 500 of 812`) instead of silently truncating.

Locations are now a controlled list (`StockLocations`, `/app/warehouse/locations`) grouped by zone: Showroom, Warehouse, Rack, Returns, Damaged, Transit.

## 3. What is live now

### Inventory hub (new nav section)
| Screen | Path | Who |
|---|---|---|
| Stock Overview | `/app/warehouse` | Store keeper, Purchase Mgr, Ops Mgr, Manager, Director, IT |
| Receiving Tasks | `/app/warehouse/tasks` | same |
| Task detail (phone scanning) | `/app/warehouse/tasks/:id` | same |
| Locations | `/app/warehouse/locations` | same |
| Warranty Lookup | `/app/warehouse/warranty` | same |
| Scan Item / Goods Received / Fix Stock Count / Received History | existing paths | store keeper, ops mgr, manager, IT |

### Sales order
* **Discounts** — per line (`%` or `RM`) *and* order level (`%` or `RM`), with a reason that prints on the A4 document. A discount above the threshold (`Settings → discount_approval_threshold_percent`, default 10%) is flagged on submit and the reviewer's approval is recorded.
* **A4 printing** — *Print / Save as PDF (A4)* on the order detail and review screens. Live preview, template picker, zoom, then the browser's print dialog. Serial numbers and warranty expiry print automatically for tracked goods.
* **Report Design Centre** (`/app/admin/report-designer`) — design the A4 layout once: drag-free block list with up/down reordering, show/hide, and a field picker per block. Blocks: company header, title, document details, customer/delivery, items table, discount summary, serial numbers, totals, bank details, terms, signatures. Templates are stored as JSON (`report_templates`), so a new block type needs no migration. Set a default per document type; the preview uses your most recent real order, not a mock-up.
* **Reports Center** — Sales Summary, Inventory and Commissions now each print to A4.

### Users and roles
| Username | Role | Password |
|---|---|---|
| `purchasemanager01` | PURCHASE_MANAGER | `password123` *(was `manager01`, same password — the hash was never touched)* |
| `director` | DIRECTOR | `password123` |
| `operationsmanager01` | OPERATIONS_MANAGER | `password123` |

Permission shape:

| | Director | Operations Mgr | Purchase Mgr |
|---|---|---|---|
| See all orders / approve / approve discounts | ✔ | ✔ | view only |
| Create sales orders | – | ✔ | – |
| Issue receiving tasks | – | ✔ | ✔ |
| Execute receiving (scan on phone) | – | ✔ | ✔ |
| Manage products & cost | – | ✔ | ✔ |
| Manage stock locations / adjustments | – | ✔ | – |
| Manage users / settings | read users only | – | – |
| Reports / Report Design | ✔ | ✔ | view reports |

Also fixed: **inside sales can now create orders** (they key orders in on behalf of the field team, but previously only field sales held `sales_order.create`).

## 4. Bugs found and fixed

| # | Bug | Impact |
|---|---|---|
| 1 | `PUT /api/sales-orders/{id}` read `body.reason`, a field that does not exist | Every full draft edit raised `AttributeError` **after** mutating the order, and fired a bogus "Order Rejected" notification |
| 2 | `.env` pointed `DATABASE_URL` at `salesapp`; real data lives in `obm_sales` | Running with `--env-file` silently used an almost-empty database |
| 3 | `product_units` status update compared against the already-updated value | `sold_at` was never cleared when a unit came back into stock |
| 4 | Editing a user's role silently did nothing (`UserUpdate` had no `role`) | The role dropdown was decorative |
| 5 | `stock_qty` not recomputed when a product switched to SERIALIZED | Stale bulk figure (e.g. 36) vs 6 real units on the shelf — every stock screen lied |
| 6 | Warehouse read endpoints guarded by `products.view` | Field sales could list receiving tasks and the warehouse layout |
| 7 | `TypeError: can't subtract offset-naive and offset-aware datetimes` | Aware datetimes written into naive `sales_orders` columns — order submit returned 500 |
| 8 | Lazy relationship access in async code (`MissingGreenlet`) | Creating a receiving task from a PO returned 500 |
| 9 | Stock overview silently truncated at 200 rows | Products just vanished from the list with no indication |

## 5. Verification

```
cd "F:\season takle webapp\backend"
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m pytest -q
# 104 passed

"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" tests\integration_v2_check.py
# 77 passed, 0 failed   (needs the backend running on the port in BASE)
```

The integration check exercises the real flow end to end: discount maths on a real order (gross 500 → line disc 60 → net 440 → order disc 22 → total 418), the previously-crashing PUT, A4 print data, submit→approve→keyed, PO→task→3 serial scans→duplicate rejection→completion, stock movement, PO completion, warranty lookup, a warranty claim, the 409 shortfall gate, stock overview, and every role gate.

Frontend: `tsc --noEmit` clean, `vite build` succeeds (2000 modules).

## 6. Applying the migration

Idempotent — safe to re-run.

```
cd "F:\season takle webapp\backend"
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" migrate_v2.py
```

It adds the new columns/tables, backfills existing rows, repairs serialized stock counts, renames `manager01` → `purchasemanager01`, creates `director` and `operationsmanager01`, and seeds stock locations, report templates and the new settings.

## 7. Phase 2 — recommended next

Ordered by value for money:

1. **Install the app on the phone (PWA).** The scanning screen is already phone-first, but it still needs a browser. A web manifest + service worker makes it an icon on the home screen and lets the scan screen survive a dropped connection (queue scans locally, flush on reconnect). *This is the single biggest usability win for the store keeper.*
2. **Print serial barcode labels at receiving.** The `BarcodeLabels` page exists; wire it to the units created by a task so a worker can label each rod as it is counted, then scan that label for warranty forever after.
3. **Stock-take sessions.** A task type that is not tied to a PO: pick a location, expected = system quantity, worker scans, variances become an adjustment document. Reuses the whole scanning flow.
4. **Transfers between locations.** Move units Showroom ↔ Warehouse ↔ Returns with a two-sided confirm, so `units_by_location` stays trustworthy.
5. **Warranty claim workflow completion.** Claims can be opened and resolved; add the replacement-unit linkage UI and a printable claim slip.
6. **Supplier scorecard.** Because every shortfall is now recorded with a reason, you can rank suppliers on short-ship rate and reject rate.
7. **Serial capture at the counter (walk-in sales).** Currently serials are allocated when the order is marked keyed to OBM. For walk-in trade, scan the specific unit at the moment of sale so the customer gets *that* rod's serial on the receipt.

## 8. Deliberate non-goals

* **No server-side PDF.** Printing uses the browser's own dialog (which gives "Save as PDF" for free). It works on iPad Safari, needs no extra service on the F: drive, and keeps the printout identical to the preview.
* **No drag-and-drop in the designer.** Up/down buttons are unambiguous on a tablet and never mis-drop a block.
* **Stock only moves on an explicit completion.** No endpoint quietly adjusts stock as a side effect.

---

# Update — PO→task, QR labels, one-screen receiving (built)

Everything below is **live and verified** (148 unit tests, 167 integration checks).

## The flow now, end to end

```
  Purchase manager                    Warehouse
  ────────────────                    ─────────
  Create PO (manual, in-app)
        │  Send to warehouse
        ▼
  "Issue receiving task"  ──────►  Notification on their phone
   • assign to a worker                    │
   • priority / due date                   ▼
   • store-at location              Open the task — ONE screen
   • optional: split across         • scan each item (camera on by default)
     workers, one task each         • the line auto-advances when complete
        │                           • one button: Complete & post stock
        │                                   │
        │                                   ▼
        │                          Stock posts. Serials become sellable.
        │                          Labels printable straight from the task.
        │                                   │
        ▼                                   ▼
  If the count did not match → a discrepancy appears in
  "Count differences" with the exact short/over per product,
  and the purchase manager is notified to chase the supplier.
```

## What changed

**PO → task is now the obvious path.** `PurchaseOrderDetail` used to send you to the
old bulk-receipt screen, which posted stock *without* scanning, without serials and
without a task — quietly bypassing the entire design. It now opens an *Issue receiving
task* dialog. The old screen is still there, relabelled **"Advanced: post a receipt
without scanning"**, for the rare adjustment case.

**You can split one delivery across workers.** Default is one task for the whole PO.
Tick *Split across workers* and give each PO line its own assignee — useful when one
person is counting rods while another does reels.

**Double-counting is now impossible.** `quantity_received` on a PO only advances when a
task is *completed*, so between "task issued" and "task done" the PO still looks fully
outstanding. The app now subtracts whatever open tasks have already claimed. Try to
convert the same PO twice and you get a clear refusal instead of a duplicate task.

**A count difference no longer blocks the worker.** This is the change you asked about.
Previously the app refused to post unless someone typed a reason. Now:

1. The worker counts what is physically on the pallet and taps **Complete**.
2. Stock posts **at the counted figure** — inventory must match reality.
3. The difference is recorded per product as *short* or *over*.
4. The **purchase manager** is notified with the exact numbers, and it appears in
   **Count differences** (`/app/purchase-orders/discrepancies`) where they can mark it
   acknowledged → chased → resolved, with a note.

That is the normal practice: you post what actually arrived and raise the difference as
a short-ship claim against the supplier. The store keeper is not the right person to
decide a supplier dispute, so they are not asked to.

**The worker screen is now genuinely one page.** Removed the "Start counting" step
(scanning starts the task), merged three stacked panels into one list, added
auto-advance to the next unfinished item, camera on by default, and reduced the bottom
bar to one primary button with Cancel tucked into a ⋯ menu.

## QR labels

**The QR carries the plain serial number, not a link.** This is deliberate and
important: a sticker on a rod stays there for two years, and the current public URL
(Cloudflare quick tunnel) changes hostname every time it restarts. A printed dead link
would be worse than no link. Because the serial is stable, a "check warranty" page can
be added later and **every label already stuck on every rod keeps working.**

Each sticker carries: **QR** (the serial) · product name · item code · the serial as
text · the manufacturer serial · warranty term.

Two modes, switchable per print job:

| | Thermal label printer | A4 label sheet |
|---|---|---|
| Use | Rack and stock labels | Customer-facing / volume |
| Page | The label itself (default 50×30mm) | Grid on A4 (default 3×8, Avery L7159) |
| Setup | Label size + DPI | Columns, rows, label size, calibration offsets |

Open **Label options** on the label page to change size, switch QR ↔ barcode, choose QR
error correction, pick which fields print, and **Save as default**. You can also print
labels straight from a receiving task (`Print labels (N)` in the ⋯ menu) — and it works
*before* the task is completed, so the worker can label as they unpack.

### Hardware — what to buy in Malaysia

| Tier | Model | ~RM | Note |
|---|---|---|---|
| **Recommended** | Xprinter XP-420B (4-inch, 203 dpi, USB) | 200–260 | The de-facto Shopee/Lazada MY label printer. Handles 50×30mm through 100×150mm. |
| Cheaper | Xprinter XP-235B / XP-365B (2–3 inch) | 150–220 | Pick this if you standardise on 50mm-wide rolls — less wasted media. |
| Mid | Deli DL-888 | ~395 | Better build, same media. |
| Premium | Brother QL-800 | 798+ | Crispest small QR — but **proprietary DK rolls** cost far more per label. |

Label stock: direct-thermal rolls in 50×30, 40×30, 100×100 and 100×150mm are cheap and
everywhere online in Malaysia. For A4 sheets: **Avery L7159** (63.5×33.9mm, 3×8).

> **Media warning.** Direct thermal **fades in 12–24 months** in Malaysian heat, humidity
> and UV. That is fine for internal rack labels, but for a **2-year rod warranty sticker
> that lives in the sun and in the water**, use **thermal transfer (ribbon)** or
> **synthetic BOPP/polyester** stock. Do not buy a 1,000-label roll of cheap direct
> thermal for the rods.

**Before you commit to a roll:** print one label at 50×30mm and scan it with the actual
phone the store keeper will use.

## Warranty — the market, and why this design

I looked up how it is actually done. **Shimano SEA** runs the Malaysia warranty
programme: **rods 2 years, reels 1 year**. To claim, the customer must present:

1. a valid **warranty sticker on the rod** + the warranty card, within period
2. the **original dated sales receipt**
3. the customer portion of the card
4. **the dealer's portion, submitted within 14 days of purchase** (that is registration)
5. the complete rod

And critically: **rod breakage is not free** — a single-piece break costs 40% of SRP, a
multi-piece 25% for one section or 40% for two or more. Only non-breakage faults are
free. (Ninjx, a Malaysian rod brand, just runs claims over WhatsApp; a tackle-specific
warranty SaaS, WRMS, is built on "scan the tag, file the claim".)

The universal failure in that model is **the customer losing the receipt**, so a
perfectly good rod gets refused. Your advantage is that you print and stick the label
yourself, so:

> The label on the rod **is** the warranty card. The sale in this app **is** the receipt.
> The serial number links them.

CS scans the sticker → purchase date, customer, invoice, warranty end, and every past
claim on that exact rod. No paper, no lost receipt, no missed 14-day deadline.

**Rods now default to a 24-month warranty** (`migrate_v3.py` corrected 9 existing
products). The 12-month default remains for reels and accessories.

## Applying the migration

```
cd "F:/season takle webapp/backend"
"C:/Users/chiam/AppData/Local/Programs/Python/Python313/python.exe" migrate_v3.py
```

Idempotent. Adds the PO provenance columns, the discrepancy table and columns, the
label settings, and corrects rod warranty terms.

## The OBM seam — what exists and what does not

**Exists and works:**
- `PurchaseOrder.source` (`MANUAL` / `OBM_IMPORT`), `external_reference`,
  `external_synced_at` — real columns, backfilled, and filterable in the PO list.
- `app/services/obm.py` with two functions: `get_obm_config()` (reads
  `obm_api_url` / `obm_api_key` / `enable_obm_sync`, which nothing used to read at all)
  and `import_purchase_orders()`. The importer is idempotent on
  `(source, external_reference)`, matches products by OBM item code → internal code →
  exact name, **refuses to rewrite a PO someone has already started receiving**, and
  returns a report of unmatched lines instead of throwing the whole sync away.
- `GET /api/purchase-orders/obm-status`, and the Settings page now shows it — so the
  OBM fields are no longer decorative.
- `enable_obm_sync` is editable in Settings.

**Does not exist:** the connector itself. **No network code was written**, deliberately.
Writing it against a guessed interface would be wasted work. It needs one decision from
you: **how can OBM hand over a purchase order?**
- Print the PO to PDF → the AI reader already exists (`services/ai.py`), so this is the
  fastest path and needs no new format work.
- Export Excel/CSV → needs a column-mapping importer (nothing like it exists today).
- An API or direct database access → the cleanest long term, but depends on what OBM
  actually exposes.

When you decide, the connector only has to produce a list of dicts and call
`import_purchase_orders()`.

## Installable on the phone, and it survives dead wifi

The whole point of the receiving screen is that a store keeper opens **one icon**
and starts scanning. That is now true: the app installs to the home screen as
**OBM Helper** (with shortcuts straight to *Tasks*, *Scan* and *Warranty*), opens
full screen with no address bar, and keeps working when the signal drops.

**Offline scan queue.** A scan that cannot reach the server is saved on the device
instead of failing, and uploads automatically when the connection returns — with
an **Upload now** button and a visible count if you would rather not wait. Three
rules it follows, all verified by tests:

- **A scan is never silently lost.** An entry is only removed once the server has
  actually answered — accepting it, or refusing it for a real reason (a duplicate
  serial). A network failure keeps it queued.
- **Order is preserved.** Queued scans replay oldest-first and stop at the first
  network failure, so a serial can never land after a later one.
- **Completion is blocked while scans are pending.** You cannot post stock while
  the device is still holding unscanned serials — that would post a count you know
  is incomplete.

The service worker **never caches `/api/`**. Stock quantities are always live; a
cached quantity is worse than an error, because someone would count against it and
post the wrong stock. It only caches the app shell, so the screen opens offline.

> **Phone requirement:** offline support and the camera both need a secure context —
> HTTPS or localhost. That is what `start-secure-lan.bat` is for. Over plain HTTP on
> a LAN IP the app still works, but without offline queueing or the camera.

## Stock takes — finding the mess instead of arguing about it

The warehouse problem was never "we don't know the number". It is "the number is
wrong and nobody can say by how much or why". A stock take makes that concrete.
**Stock Takes** is in the Inventory menu.

**Three ways to count:**

| Scope | Use |
|---|---|
| **One location** | Rack, showroom or returns bin — a quick spot check |
| **Whole warehouse** | Every active product — the periodic full count |
| **One product** | Chase a single suspicious line |

> A **location** count covers serialized goods only. Bulk stock (lures, hooks, swivels)
> has no location breakdown in this system, so its "expected" figure for one location
> would be a whole-company number in disguise. The app says so rather than producing a
> number that looks authoritative and isn't.

**What happens when you count:**

1. Starting a session **freezes what the system currently believes**. A sale happening
   mid-count cannot quietly move the baseline and make the variance disappear.
2. The counter scans rods (or types quantities for bulk) on the same one-screen phone
   layout as receiving — including the **offline queue**, so a dead spot mid-count
   doesn't lose anything.
3. A line reads **"not counted"** until it has a real figure. Uncounted is not the same
   as counted-zero, and an uncounted line is left alone when the session posts.
4. Posting shows every difference and **requires a reason**. Writing inventory off
   without one is how stock problems stay unfixable.

**How the two inventory models post — this matters:**

- **Bulk** — the number *is* the stock, so the variance goes through the stock ledger
  and the number moves with it.
- **Serialized** — `stock_qty` is *derived* from AVAILABLE units. So a variance is
  applied by marking the specific missing rods as **MISSING** and recomputing, never by
  a quantity deduction (that would double-count the loss). The ledger row is then
  written from the actual before/after difference, so it can never disagree with stock.

The result: a missing rod is **named by serial number**, not just recorded as a number
that dropped by one — which is what makes it findable. Every posted difference also
creates a normal **adjustment document** (`ADJ-…`) you can look up in the adjustment
history, and rods scanned during a location count have their location updated, which is
how a misplaced rod gets found.

## Stock transfers — moving stock without losing track of it

**Transfers** is in the Inventory menu. It closes a real gap: `location_id` was
**not editable after receiving**, so a rod received into "Rack A" could never be moved
to the showroom except by a stock take. That is why `units_by_location` drifted.

**A transfer never changes a quantity.** It only changes where a unit is. That
invariant is the whole reason it is a separate document from a stock adjustment — if a
transfer could move the number, *"we lost two rods"* and *"we moved two rods"* would
look identical in the ledger and the loss would never be found.

**Two-sided confirm, and the phase is not a choice the user makes:**

| Status | What you scan | What it does |
|---|---|---|
| `DRAFT` | **Scan out** of the source | Claims the unit to the transfer. Does **not** move it — it has not arrived anywhere |
| `IN_TRANSIT` | **Scan in** at the destination | **This is the scan that relocates the unit** |
| `COMPLETED` | — | Anything never scanned in stays at the source |

So a trolley that never reaches the showroom shows up as **"1 in flight"** rather than
silently teleporting stock. Closing a transfer with units still in flight is refused
unless you say what happened — and those units stay recorded where they physically are,
released so they can be moved again later.

Two more deliberate rules:

- **Only serialized goods can be transferred.** Bulk stock (lures, hooks) has no
  location, so the API refuses it outright rather than fudging a number.
- **A sold or reserved rod cannot be moved.** It is already spoken for, and moving it
  would break a promise made to a customer.

Scanning the same rod out twice, or onto two open transfers at once, is refused. A
**location mismatch** is reported but not blocked — the system is often the thing that
is wrong, and the operator is holding the rod. The receiving scan is what sets the truth.

## The UI is now verified in a real browser, not just compiled

Typecheck and `vite build` catch a lot, but they cannot catch a React runtime error — a
bad hook order, a null dereference in a render path. Those only appear when a page
actually renders. `backend/smoke_frontend.py` logs in, walks **12 pages and 5 detail
screens**, records every console error and uncaught exception, screenshots each, and
**decodes the QR off the rendered label with OpenCV** to prove a phone can scan it.

Two real bugs it caught that nothing else would have:

1. **The QR overflowed its label.** The `qrcode` library hardcodes
   `width="256" height="256"` on the root SVG element, which blew out of a 21mm box and
   spilled over the text beside it. Every label would have printed wrong. Fixed by
   forcing the SVG to `width="100%"` and let the intact `viewBox` scale it — which also
   keeps it sharp in print.
2. **A cancelled receiving task rendered as a blank page** with no explanation. The task
   header now carries a status badge, and a cancelled or completed task says so in words.

It also exposed a trap in the app itself: **logging in revokes every other session for
that user**, so any script that logs in a second time silently signs the browser out.
The smoke check therefore seeds its test records *before* the browser logs in.

Run it with the backend on :8001 and the frontend on :3000:

```
cd "F://season takle webapp//backend"
"C://Users//chiam//AppData//Local//Programs//Python//Python313//python.exe" smoke_frontend.py
```

Screenshots land in `smoke-screenshots/`. It cancels the records it creates, so it can be
run repeatedly without turning the database into a graveyard of test data.

## Still to come

**Status as of 18 September 2026** — three of the four items below were listed as open and
have since been built and verified. They are kept here with their status so this list stops
being read as "not done":

1. **A public "check warranty" page.** ✅ **Built.** `/warranty` (and `/warranty/<serial>`
   for a QR deep link) reads `/api/public/warranty/check/<serial>`, which is
   **unauthenticated** and returns only the product name, brand and warranty status. The
   customer's name, phone, sales-order number, cost and warehouse location are **not sent
   to the browser at all**, and `tests/test_public_warranty.py` asserts those fields stay
   absent. Prefix rate-limited (20/min) because the serial is in the URL.

   The original deferral reason was right and the design honoured it: the QR on a printed
   label carries the **plain serial, not a URL**, so **every label already printed works
   with this page and none need reprinting.**

   *Outstanding:* it is reachable at `http://<host>/warranty`. Pointing a permanent
   hostname at it is one DNS route — the owner already has `hipercom.com.my` on the named
   tunnel `fd3382b4`, e.g.
   `cloudflared tunnel route dns fd3382b4 season.hipercom.com.my`.
2. **PWA install.** ✅ **Built.** `public/manifest.webmanifest` + `public/sw.js` are served
   and the service worker registers; the smoke test asserts both. Offline write queue is
   covered by `npm run check:offline` (39 checks).
3. **Stock-take sessions** and **transfers between locations.** ✅ **Built.**
   `/app/warehouse/stock-takes` (+ session screen) and `/app/warehouse/transfers`
   (+ detail), both walked by the smoke test.
4. **Supplier identity.** ✅ **Built.** `Supplier` is a master row with a unique
   normalized name (`migrate_v6.py` backfilled and linked the existing documents), the
   receiving-discrepancy queue groups on it, and there is a Suppliers screen. This
   unblocks a supplier scorecard.
   *Outstanding:* the Suppliers page shows outstanding units but not the chase notes, and
   there is no way to merge two suppliers discovered to be the same company.

### Added since this plan was written

* **CSV purchase-order import.** `/app/purchase-orders/import` with a preview-then-commit
  flow (`commit=false` by default), feeding the same `import_purchase_orders()` seam a
  future OBM connector will use. Re-importing the same file updates rather than
  duplicating. This is what makes the open question *"how does OBM hand over POs?"*
  non-blocking — CSV is a format any accounting package can produce today.
* **Supplier linking on import.** An unrecognised vendor name imports **unlinked** rather
  than auto-creating a supplier (an import is not the place to invent master data); the
  preview names the vendors that need creating, and re-importing after creating them
  links the existing orders.

