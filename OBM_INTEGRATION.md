# OBM integration — how it actually works

**Written:** 21 September 2026
**Source of truth for this document:** the live OBM installation at `C:\OBMSB`,
read through its own Firebird database.

---

## 1. The short version

OBM stores everything in a **Firebird 2.5** database. Purchase orders live in two
tables — `PURCHASEORDER` (header) and `PURCHASEORDERITEM` (lines) — joined by
`PKEY` → `FORKEY`. Reading them needs no export, no CSV, no API: the app now
reads the database directly.

**This app only ever reads OBM.** It is the legal record of the business; nothing
here writes to it. `app/services/obm_firebird.py` refuses to run any statement
containing INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/MERGE/EXECUTE, and
`tests/test_obm_firebird.py` asserts that.

---

## 2. Connecting

| | |
|---|---|
| Engine | Firebird **2.5.6** |
| Server | Windows service `FirebirdServerDefaultInstance` |
| Client | `isql.exe` at `C:\Program Files (x86)\Firebird\Firebird_2_5\bin\isql.exe` |
| Login | `SYSDBA` / `masterkey` (OBM's stock default) |
| Databases | `C:\OBMSB\Data\*.fdb` |

### Why the app drives `isql.exe` instead of using a Python driver

**The client is 32-bit and Python is 64-bit.** The only `fbclient.dll` on the
machine sits in `Program Files (x86)` beside a 32-bit legacy application. A
Python driver (`fdb`, `firebird-driver`) would need a *matching* 64-bit client
installed and kept in step — a second thing to break.

Driving the `isql` OBM already ships needs nothing new, and it keeps working when
this moves to another OBM installation regardless of its Firebird build. OBM
shops integrate this way routinely.

The cost is parsing `isql`'s output, which mixes a banner and `SQL>` prompts into
stdout. That is handled by bracketing the rows in `<<<OBM-BEGIN>>>` /
`<<<OBM-END>>>` markers and rejecting any line whose column count is wrong, so
prompt noise can never be mistaken for data.

> **Verified:** `python -c "..."` against the real database returned
> `Connected to OBM (Firebird 2.5.6); 12 purchase order(s) on file.`

---

## 3. The purchase-order schema

### `PURCHASEORDER` — the header

| Column | Type | Meaning |
|---|---|---|
| `PKEY` | int | Primary key |
| `TRANSNO` | varchar(60) | **The document number** — e.g. `PO23/06/001` |
| `TXDATE` | timestamp | Document date |
| `VENDOR` | int | → `CREDITOR.PKEY` (the supplier) |
| `REFERENCE` | varchar(60) | The supplier's own reference, often blank |
| `CURRENCY` | int | → `CURRENCY.PKEY` |
| `RATE` | double | Exchange rate |
| `SALESMAN` | int | → the user who raised it |
| `REQUIREDDATE` | timestamp | Expected delivery |
| `TOTALAMT` | double | Document total |
| `STATUS` | varchar(4) | See status codes below |
| `REMARKS` | blob | Free text |
| `DISCAMT` / `DISCPERCENT` / `DISCDESC` / `TAXPERCENT` | | Discounts and tax |

**`TRANSNO` is what makes a re-import safe.** It becomes our
`external_reference`, which is the key `import_purchase_orders()` upserts on, so
reading OBM twice updates rather than duplicates.

### `PURCHASEORDERITEM` — the lines

| Column | Type | Meaning |
|---|---|---|
| `FORKEY` | int | → `PURCHASEORDER.PKEY` |
| `ITEMNO` | int | → `PRODUCT.PKEY` |
| `LINE` | varchar(40) | Line label |
| `QTY` | double | Quantity ordered |
| `UNITPRICE` | double | Unit cost |
| `QTYPROCESSED` | double | **Already received** |
| `QTYCANCELLED` | double | Cancelled quantity |
| `TAX` / `COST` / `PERCENT` | | Tax and cost allocation |
| `DELIVERDATE` | timestamp | Line-level delivery date |

**`QTYPROCESSED` is the field this app needs.** It is OBM's own record of how
much of a line has arrived, which is exactly what drives our receiving tasks.

### `PRODUCT` — the item master

Key columns: `PKEY`, `PRODUCTID` (the item code — this maps to our
`Product.obm_item_code`), `PRODUCTNAME`, `BRAND`, `CATEGORY`, `UNITOFMEASURE`,
`QTYINSTOCK`, `QTYONORDER`, `PURCHASE PRICE`, `SALEPRICE`, and notably
**`KEEPSERIALNUMBER`** — OBM already tracks serial numbers for some products,
which lines up with this app's `ProductUnit`.

### `CREDITOR` — the supplier master

OBM calls a supplier a **creditor**. Key columns: `PKEY`, `ACCTNO` (the account
code, e.g. `400-O002`), **`NAME`** (the supplier name — it sits far down the
column list, after `REFCRED1..6`), `CONTACT`, `PHONE1`, `ADDRESS`, `TERM`,
`CURRENTBALANCE`, `CURRENCY`.

`NAME` maps to our `Supplier.normalized_name` for matching, and `ACCTNO` to
`Supplier.obm_supplier_code`.

---

## 4. Status codes

Observed in real data: **`N`** (the overwhelming majority) and **`C`**.

`C` is treated as cancelled — the one document carrying it was a 2019 PO that
never proceeded. **This is inferred from the data, not from documentation.**
Confirm it against the tackle company's own OBM before relying on it. The reader
excludes `C` by default and has an `include_cancelled` switch, so nothing is
hidden either way.

---

## 5. ⚠️ The hotel database is NOT a good model for the tackle business

This matters more than anything else in this document.

The database analysed here belongs to **Subang U Three Hotel**. Its purchase
orders are **expense-based**, not stock-based. A real one looks like this:

```
PO23/06/001   O'CONNOR'S TECHNOLOGIES SDN BHD   2023-06-27
  -                           qty 2   @ 140.00
  HOTEL EXPENSES              qty 5   @ 120.00
  UPKEEP OF HOTEL             qty 2   @ 475.00
```

Those line labels are **accounting codes, not products**. Of the hotel's 12 POs,
only 7 have any line with a positive quantity, and **none of those lines match a
catalogue product**, because a hotel buys services and expenses rather than
inventory.

**A tackle distributor's OBM will look completely different.** It buys rods,
reels and lures, so `PURCHASEORDERITEM.ITEMNO` will point at real `PRODUCT` rows
with real `PRODUCTID` codes, and those POs will import cleanly.

So use this database to prove the *mechanism* — which is what it was used for —
and expect the *data* to look different once pointed at the tackle company's OBM.

This is also why the importer reports skipped orders by name instead of failing
silently: with an expense-based file, "4 purchase orders were not imported" plus
a reason is the difference between understanding the system and distrusting it.

---

## 6. Field mapping

| OBM | This app |
|---|---|
| `PURCHASEORDER.TRANSNO` | `PurchaseOrder.external_reference` (the upsert key) |
| `PURCHASEORDER.VENDOR` → `CREDITOR.NAME` | `PurchaseOrder.supplier_name` (snapshot) + `supplier_id` (live link) |
| `PURCHASEORDER.REQUIREDDATE` | `PurchaseOrder.expected_date` |
| `PURCHASEORDER.REFERENCE`, `STATUS`, `TXDATE` | `PurchaseOrder.notes` (kept for provenance) |
| `PURCHASEORDERITEM.ITEMNO` → `PRODUCT.PRODUCTID` | `Product.obm_item_code` |
| `PURCHASEORDERITEM.QTY` | `PurchaseOrderLine.quantity_ordered` |
| `PURCHASEORDERITEM.UNITPRICE` | `PurchaseOrderLine.unit_cost` |
| `PURCHASEORDERITEM.QTYPROCESSED` | not yet imported — see below |

### Not yet wired
`QTYPROCESSED` is read by the connector but not applied to
`quantity_received`. Doing so would let OBM's own receipt history seed this app's
receiving state. Worth adding once the tackle OBM is connected and the real
numbers can be compared.

---

## 7. Gotchas found the hard way

* **Firebird has no empty date.** A blank `REQUIREDDATE` casts to `1899-12-30`,
  which would import as a purchase order expected in 1899. Anything before
  1900 is treated as absent.
* **A bare `-` means "no product".** OBM writes a single hyphen on lines that
  have no stock item. Treated literally it becomes an item code of `-`, which
  matches nothing and turns a real PO into a wall of warnings.
* **Zero-quantity lines are allocation rows**, not orders. They are dropped.
* **`isql` needs an explicit `;`.** Without it the next statement is read as a
  continuation and the server answers `Token unknown - SELECT`.
* **`isql` exits 0 even on a SQL error**, so stderr is checked rather than the
  return code.
* **`isql.exe` cannot read an MSYS path.** Passing `/tmp/script.sql` fails; the
  script must be piped on stdin or written to a Windows path.

---

## 8. Pointing it at the tackle company's own OBM

Everything is in `backend/.env`:

```ini
OBM_FIREBIRD_ISQL=C:\Program Files (x86)\Firebird\Firebird_2_5\bin\isql.exe
OBM_FIREBIRD_DATABASE=C:\OBMSB\Data\SUBANG U THREE HOTEL SDN BHD.fdb   # <- change this
OBM_FIREBIRD_USER=SYSDBA
OBM_FIREBIRD_PASSWORD=masterkey
```

Change `OBM_FIREBIRD_DATABASE` to the tackle company's `.fdb`, then check
**Purchasing → Supplier PO → Import → From OBM**. The screen reports the
connection, the Firebird version and how many POs it can see, so a wrong path is
obvious immediately rather than at import time.

If OBM's database is on a different machine, the `.fdb` must be reachable from
this one (a network share works), or OBM must be configured to accept remote
connections — in which case the DSN becomes `host:/path/to/db.fdb`.

---

## 9. Fallback: CSV

The CSV importer is unchanged and still works. Use it when OBM is unreachable,
or when someone can only produce a file. Both paths feed the same
`import_purchase_orders()` seam, so behaviour — preview first, upsert on
`external_reference`, never invent suppliers — is identical.
