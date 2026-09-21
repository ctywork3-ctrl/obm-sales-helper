# OBM SALES HELPER — COMPLETE SPECIFICATION & SCENARIO BRIEF
### (Handoff document for an AI developer — e.g. Qwen3.8-Max online — who CANNOT read this local machine. Everything it needs is in this file.)

**Prepared:** 21 September 2026 · **Location of the business:** Malaysia · **Currency:** MYR (RM), also SGD supported
**Reference deployment:** `http://localhost:26405/dashboard` (the current working webapp this spec describes)

---

## 1. WHO WE ARE & WHY THIS APP EXISTS

- We are a **fishing tackle trading company in Malaysia** (rods, reels, lures, lines, accessories). We **import goods** from suppliers abroad and also **self-produce** some items, warehouse them, and sell via **outside sales** (field salesmen visiting shops) and **inside sales** (office).
- The company runs **OBM accounting software** (Windows desktop accounting package). OBM is the **legal book of record** — invoices, POs, GL all live there.
- **Problems we are solving:**
  1. **OBM does not run on Apple mobile** (iPhone/iPad). Outside sales cannot open sales orders on the road. → This webapp (mobile-first, PWA, iPhone Safari) lets outside sales create orders; **inside sales then re-keys the approved order into OBM manually**. The webapp **never writes to OBM** (read-only integration only).
  2. **Warehouse inventory is a mess.** OBM has inventory but it is low-spec and painful for warehouse workers. When goods arrive from import (container deliveries) there is no good way to **register stock on arrival**. → Phone-based warehouse flow: scan barcodes with the phone camera, **take photos** of goods/packing list/damage as evidence, count deliveries, book stock in.
  3. **Warehouse stock vs. sellable product stock.** Warehouse inventory = **physical stock on shelves**. The **product manager** turns warehouse stock into **product inventory (the catalog sales sells from)** — item codes, prices, photos, warranty terms, and marking units as sellable. The app separates those two concerns but links them.

> **Key rule:** OBM stays. This app **complements** it. Flow: webapp (sales) → webapp (approve) → human re-keys into OBM → webapp marked "KEYED_TO_OBM" with the OBM reference number. OBM data (POs) flows **in** via a read-only Firebird connection or CSV.

---

## 2. TECH STACK (already in use — follow it)

- **Backend:** Python 3.13, FastAPI, SQLAlchemy (async), Alembic migrations, PostgreSQL, cookie sessions + CSRF token, bcrypt hashing, server-side audit logging. Dev port 8001.
- **Frontend:** React + TypeScript (Vite), mobile-first responsive, PWA (manifest + service worker, offline write queue), React Router. Dev port 3000; production via Docker/cloudflared tunnel (currently exposed on port 26405).
- **Barcode scanning:** phone camera via browser (`BarcodeDetector` where available, JS fallback library).
- **Images:** uploaded to server `uploads/` folder, referenced by DB rows.
- **OBM integration:** OBM stores data in a **Firebird 2.5** database. The app **reads it read-only** by driving `isql.exe` (32-bit client, so no Python driver) — never INSERT/UPDATE/DELETE into OBM. Fallback: CSV import/export.


---

## 3. ROLES (users & permissions)

| Role | What they do in this app |
|---|---|
| **DEVELOPER / IT_ADMIN** | Everything; system settings; user CRUD; role-permission matrix |
| **DIRECTOR** | Full visibility; all orders; warehouse hub; reports |
| **OPERATIONS_MANAGER / MANAGER** | All orders; warehouse; approve orders; reports |
| **PURCHASE_MANAGER** | Purchase orders (import from OBM/CSV), issue receiving tasks, suppliers |
| **STOCK_KEEPER (warehouse worker)** | Phone flows: scan, receive goods, adjustments, transfers, stock-takes, photos |
| **PRODUCT_MANAGER** | Create/maintain **products & catalog** (codes, prices, photos, warranty, commission rate, inventory model); convert warehouse stock into sellable product inventory |
| **OUTSIDE_SALES** | Create sales orders on phone; own customers; my orders; order templates; commission view |
| **INSIDE_SALES** | See all submitted orders; review/approve/reject; **key into OBM** and record OBM ref; comments; customers admin; reports |
| **CUSTOMER (storefront)** | Optional B2B e-commerce portal: login, browse, cart, checkout, order history |

Permission model: **page-key based**. Page keys include: `dashboard`, `products`, `sales_create`, `sales_my_orders`, `sales_all_orders`, `sales_customers`, `sales_templates`, `admin_users`, `admin_customers`, `admin_reports`, `admin_settings`, `warehouse_hub`, `warehouse_receiving_tasks`, `warehouse_scanner`, `warehouse_receiving`, `warehouse_adjustment`, `warehouse_receipts`, `warehouse_stock_takes`, `warehouse_transfers`, `warehouse_warranty`, `purchase_orders`. Admin ticks/unticks pages per role. **Every API endpoint must also enforce the permission server-side** (never trust the frontend).

---

## 4. DATA MODEL (core tables)

- **User:** username, full_name, email, phone, role, is_active, commission_rate, sales_target_monthly, must_change_password, failed_login_count, locked_until, last_login_at.
- **Customer:** code, obm_customer_code, name, phone, email, address, credit terms, is_active, owned-by salesman (outside sales see only their own).
- **Product (the catalog / "product inventory"):** item_code (unique), **obm_item_code** (links to OBM), name, brand, category, uom, barcode, description, commission_rate, **inventory_model = `BULK` | `SERIAL`**, evidence_policy, warranty_months (nullable → company default), reorder_level, is_active, images, prices (per currency MYR/SGD, min-qty tiers).
  - **BULK** products: an integer `stock_qty` (e.g. lures, line spools).
  - **SERIAL** products: every physical piece is a **ProductUnit** (e.g. rods, reels): serial_number, barcode, status (`PENDING → AVAILABLE → RESERVED → SOLD → RETURNED`), warranty_months/start/end (snapshotted at receiving), warranty_void_reason, sold order/customer, unit_cost, images, warehouse location.
- **Supplier:** normalized unique name, obm_supplier_code, contact, notes, is_active.
- **PurchaseOrder (+lines):** external_reference (= OBM `TRANSNO`, the upsert key), supplier, status (DRAFT/SENT/PARTIAL/RECEIVED/CLOSED), source (`MANUAL`/`OBM_IMPORT`/`CSV_IMPORT`), lines: product, qty ordered, unit cost, qty received, **obm_quantity_processed** (kept beside ours, never merged — a human resolves disagreement).
- **ReceivingTask (+lines, +append-only scan log):** "The PO is a promise. The task is a person counting. The receipt is the truth." Assigned to a worker, due date, priority, status ASSIGNED→IN_PROGRESS→COMPLETED/CANCELLED. Scan log records OK / DUPLICATE / WRONG_PRODUCT.
- **InventoryReceipt (GRN) (+lines, +images):** posted on task completion → stock actually moves, units become AVAILABLE. Idempotency key prevents double-submits on flaky mobile networks. Photos of packing list/goods/damage attached.
- **InventoryAdjustment / StockMovement:** every stock change is an append-only movement row (RECEIVING, SALE, ADJUSTMENT, TRANSFER, STOCK_TAKE, RETURN).
- **StockTake session (+lines):** count by location, blind-count option, variance report before posting.
- **Transfer (+lines):** move stock between locations with scan-to-confirm; one posted transaction, never half-moved.
- **StockLocation:** structured code (e.g. RACK-A-01), name, type. **Never free text.**
- **SalesOrder (+items):** order_number, customer, salesman, status (`DRAFT → SUBMITTED → APPROVED → KEYED_TO_OBM` / `REJECTED` / `CANCELLED`), currency (MYR default, SGD allowed), subtotal, discount, tax, total, commission_total, notes, delivery address, obm_reference_number, keyed_to_obm_by/at, evidence per product policy.
- **OrderTemplate:** saved carts for repeat orders.
- **OrderComment:** Odoo/Facebook-style chatter on each order so inside & outside sales discuss.
- **Notification:** per-user (order submitted/approved/rejected/keyed, task assigned, low stock, discrepancies); bell icon.
- **AuditLog:** WHO did WHAT to WHICH record, OLD vs NEW values, when, IP/device. Every write. Never deletable.
- **WarrantyClaim:** serial/QR lookup → unit → product, sale, customer, warranty window; in_warranty_at_claim; issue; resolution; status.
- **E-commerce (optional):** StoreCustomer, StoreProduct, Cart, StoreOrder, payments (e.g. HitPay reference), shipping.

---

## 5. ALL SCENARIOS TO IMPLEMENT (write these as user stories / e2e tests)

### A. Auth & users
1. Login with username+password (mobile-friendly). Rate-limit 5/min. Lock account after repeated failures.
2. First login with temp password → forced change-password screen.
3. Session expires → redirect to login. Logging in revokes other sessions for that user.
4. Admin CRUD users: create (temp password shown once), edit, deactivate (never hard-delete if referenced), reset password, set role, commission rate, monthly sales target.
5. Admin edits role→page permission matrix; enforced server-side on next request.
6. Audit every login, failed login, and user change.

### B. Products & product manager ("warehouse stock → product inventory")
7. Product manager creates a product: item code, OBM item code, name, brand, category, UoM, barcode, price (MYR/SGD), commission rate, warranty months, reorder level, **inventory model (BULK or SERIAL)**, photos (upload from phone).
8. Product manager **publishes** a product into the sellable catalog and can **unpublish** it; warehouse stock exists independently of catalog visibility.
9. Bulk import products from CSV (item_code, name, cost, price, barcode…). Preview-then-commit; report failing rows with reasons.
10. Price tiers (min qty → price). Price history kept (old orders keep their snapshotted price).
11. For SERIAL products the sellable stock = count of **AVAILABLE units**; for BULK it is `stock_qty`. Sales order creation must validate against the right one.
12. Low-stock alert below reorder level → notification to product/purchase manager.

### C. Purchasing & OBM import (read-only)
13. Purchase manager creates a PO manually or **imports from OBM** (Firebird read-only) or CSV. Preview first; upsert on `external_reference` (TRANSNO) so re-import updates instead of duplicating.
14. Unknown supplier on import → import unlinked and named in a "create these suppliers" list (never auto-invent master data). Re-import after creating them links the orders.
15. Import report must count **both** kinds of skips (orders OBM-side with nothing importable + lines matching no product) — reporting only one made orders "disappear".
16. OBM gotchas: blank Firebird dates → 1899-12-30 (treat pre-1900 as absent); bare `-` item code = "no product" (skip); zero-qty lines are allocation rows (drop); `isql` exits 0 even on SQL error (check stderr); `QTYPROCESSED` shown beside our `qty_received`, never auto-merged — a human decides.
17. Connection-status screen: shows Firebird version + how many POs visible, so a wrong path is obvious immediately.
18. **Hard rule with tests:** no INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/MERGE/EXECUTE can ever run against OBM.

### D. Warehouse: receiving goods (the phone flow — the core new feature)
19. Purchase manager issues a **ReceivingTask** from a PO: worker, due date, priority. (Warn if OBM already marks lines fully received.)
20. Worker opens the task **on phone**, scans each item's barcode with camera; each accepted scan = one ProductUnit (serial, barcode, warranty clock starts). Photos optional/required per product evidence policy.
21. Scan log append-only: OK / DUPLICATE / WRONG_PRODUCT all recorded. Rejected scans never create units.
22. **Nothing moves until "Complete & post stock."** Units sit at PENDING; sellable stock counts only AVAILABLE — a half-finished count is invisible to sales.
23. On completion → GRN (InventoryReceipt, POSTED) created with photos; stock_qty updated; movements logged; units flip to AVAILABLE; purchase manager notified.
24. Short/over/damaged delivery → **ReceivingDiscrepancy** per supplier, grouped by normalized Supplier row ("Mismatch Supplier" vs "Mismatch Supplier " must be one supplier), feeding a chase queue.
25. Idempotency key on receipt submission (mobile networks retry).
26. BULK products: worker keys a counted quantity + photos instead of scanning serials.

### E. Warehouse: living with the stock
27. Barcode scanner page: scan anything → what it is, where it is, status, warranty.
28. Register a new/unknown barcode on the spot (phone) → creates/links barcode to a product or unit.
29. Transfers between locations with scan-to-confirm; never leaves stock "half-moved".
30. Stock-take sessions per location: count on phone, blind-count option, variance report, then post adjustments (movements with reason STOCK_TAKE).
31. Adjustments (damage, loss, correction) require a reason, are audited, restricted to warehouse+ roles.
32. Locations are structured codes (rack/shelf/bin) with a picker; never free text.
33. Label printing: QR labels encoding the **plain serial** (not a URL) so every printed label keeps working.


### F. Sales: outside sales on iPhone/iPad
34. Outside sales logs in on phone, browses **published** products only (photos, prices, live sellable stock or "call to check"), adds to cart → creates a SalesOrder (DRAFT) → submits.
35. Customer selection restricted to their own customers; can create a customer on the go (name+phone minimum; flagged for inside-sales completion).
36. Order templates (saved carts) for repeat orders.
37. Evidence policy per product (e.g. warranty-claim products require a receipt photo upload before approval).
38. Commission auto-calculated per line (price × qty × applicable rate per business rule); snapshotted onto the order.
39. Offline tolerance: if network drops mid-order, queue the submission and retry (PWA offline write queue).

### G. Sales: inside sales & approval → OBM
40. Inside sales sees SUBMITTED orders, reviews, can edit lines (audited), **APPROVE**, or **REJECT (reason required → notifies salesman)**.
41. After keying into the OBM desktop app manually, inside sales clicks **"Mark keyed to OBM"** and enters the OBM document number. Status → KEYED_TO_OBM; salesman notified.
42. Chatter/comments on every order (like Odoo/Facebook); comment events notify the other party.
43. Full order timeline: created → submitted → edited → approved → keyed, each stamped user+time.
44. CSV export of orders (for the accountant / OBM reference) and a printable order view.

### H. Warranty
45. Selling a SERIAL product sets warranty_start/end + customer on the unit.
46. Public unauthenticated page `/warranty/<serial>` (QR deep link) returns **only** product name, brand, warranty status — customer name, phone, order number, cost, location must never be exposed (rate-limited 20/min, tested).
47. Staff warranty claim flow: scan serial → instant in/out-of-warranty answer + void reasons → log claim, issue, resolution, status.
48. Warranty void reasons (e.g. physical damage) recorded; clock snapshot at receiving so later product changes don't rewrite history.

### I. Notifications, audit, dashboards, reports
49. Bell notifications: order submitted/approved/rejected/keyed, receiving task assigned/completed, discrepancies, low stock, warranty claim created. Mark-read; paginated list.
50. Dashboard per role: sales KPIs (today/month totals, pending my approval, my commission), warehouse KPIs (tasks due, open discrepancies, low stock), admin KPIs (recent audit events).
51. Reports: sales by period/customer/product/salesman, commission report, tax totals, inventory valuation, stock movement history, receiving discrepancy by supplier. All CSV-exportable.
52. Audit log viewer (admin/director): filter by user/date/action/table; shows old vs new values. Immutable.

### J. Optional / extra features (build if time allows — you may add more)
53. B2B storefront: customers log in, browse, cart, checkout (HitPay payment reference), see order history.
54. AI chat assistant icon for outside sales ("what's the price of X", "what's my commission").
55. Supplier scorecard (on-time %, shortage counts) + supplier merge tool for duplicates.
56. Multi-language UI (English / Bahasa Malaysia / Chinese).
57. SST/tax profiles (Malaysia sales tax) applied at order time.
58. Web Push notifications in addition to the in-app bell.
59. Dark mode; install-as-PWA prompt on iPhone (Add to Home Screen instructions for staff).

---

## 6. CROSS-CUTTING RULES (non-negotiable)

1. **Never write to OBM.** Read-only Firebird via isql or CSV in. Tests must prove it.
2. **Every write is audited** (user, action, entity, old→new, timestamp, IP).
3. **Permissions enforced server-side on every endpoint**, not just hidden in the UI.
4. **Mobile-first**: every screen usable one-handed on a 375px-wide iPhone; big tap targets; camera scan; photo upload from camera.
5. **Money as Decimal (12,2)**, never float; currency per order (MYR default, SGD allowed); tolerate "RM88.50"/"$88.50" inputs by stripping symbols.
6. **Append-only stock movements**; stock never silently changes — always a movement row with reason.
7. **Idempotency** on all mobile-submitted writes (receipts, orders) via client-generated keys.
8. **Never hard-delete** referenced records; deactivate instead.
9. **Preview-then-commit** on all imports; verbose skip reporting; upsert on stable external keys.
10. **Photos as evidence** on receiving, adjustments, and per-product evidence policies; compress client-side before upload.
11. Timezone: business runs in Malaysia (GMT+8); store UTC, display local.
12. Provide seed data + seed-users script so a fresh install is testable immediately (developer/password123 in dev only).

---

## 7. DEFINITION OF DONE

- A fresh machine can run: setup → DB created+migrated+seeded → backend :8001, frontend :3000 (or one exposed port like :26405 via Docker/tunnel).
- Every scenario in §5 has at least one automated test (backend pytest) or a scripted smoke walk with screenshots.
- PWA offline-queue check passes (an `npm run check:offline`-style script).
- Tests prove: OBM integration is read-only; public warranty page leaks no private fields; permissions block unauthorised API calls; re-importing the same OBM/CSV data does not duplicate.
- The smoke test is re-runnable without polluting data (it cancels what it creates).

---

### HOW TO USE THIS DOCUMENT (for the AI developer)
Build the app described above. When a detail is ambiguous, prefer §5's scenario text and the rules in §6. Do not invent integrations beyond OBM read-only. Priority order: Auth/Roles → Products/catalog → Sales order lifecycle (submit/approve/keyed-to-OBM) → Warehouse receiving on phone (scan+photo) → Notifications/Comments/Audit → Warranty → Reports → E-commerce & extras.

- **Settings:** company name/logo/bank details/terms, default currency, default warranty months, max order items, label config.
