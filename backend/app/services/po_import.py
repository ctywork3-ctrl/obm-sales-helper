"""Parse a purchase-order spreadsheet export into the OBM import contract.

Why this exists: the business raises POs in OBM and re-keys them here. The
connector that would automate that is blocked on a decision about OBM's handover
format (PDF / Excel-CSV / API). A CSV importer does not need that decision — CSV
is the format any accounting package can produce today — and it lands on exactly
the same `import_purchase_orders()` seam the eventual connector will use. So this
is useful now and does not become throwaway work later.

The output of `parse_po_csv()` is deliberately the same list-of-dicts that
`services/obm.import_purchase_orders()` documents:

    [{"external_reference", "supplier_name", "expected_date", "notes",
      "lines": [{"item_code", "name", "quantity", "unit_cost"}]}]

Design decisions worth stating:

* **Row-level errors never abort the file.** A 500-row export with one bad
  quantity should import 499 rows and tell you about the one; failing the whole
  file makes the user hunt through Excel for a problem we already located.
* **Header names are matched loosely.** "Supplier", "supplier_name",
  "SUPPLIER NAME" are all the same column. Nobody controls how their accounting
  package labels an export, and demanding an exact header is a needless failure.
* **One row per PO line, with the PO columns repeated.** This is what real
  exports look like (a flat table), not a nested structure. Rows are grouped by
  the PO reference.
* **No crossing-supplier merging.** Two rows with the same PO reference but
  different suppliers is a data error, and it is reported rather than silently
  resolved, because guessing which supplier is right would corrupt the PO.
* **A bad line does not erase its order.** The order header is registered the
  moment its reference is valid, before any line is validated, so a file whose
  only row for PO-9002 has a blank quantity still reports "2 orders found, 1
  error on row 4". Dropping the whole order would tell the user their PO is not
  in the file when it plainly is - and `import_purchase_orders()` would then
  report `skipped: no lines` for a reference it never received, which is exactly
  the kind of unhelpful message that costs an hour of Excel archaeology.
  An order with zero usable lines is skipped by the importer and named in the
  report; an order that is invisible is a bug.
* **A supplier name nobody has a master row for is NOT a parser error.** It
  imports with the name as a snapshot and no `supplier_id`, because an import is
  not the place to invent master data (see `services/obm._resolve_supplier`).
  The report surfaces these separately so they can be linked deliberately.
* **The snapshot keeps the document's wording; normalization stays out of it.**
  Cell text is trimmed at the ends but inner spacing is preserved, so a file
  that wrote `"Shimano  SEA"` produces a PO that says exactly that. Collapsing
  whitespace is `normalize_supplier_name()`'s job at match time. This is the
  same split as `supplier_name` (what the document said) versus
  `normalized_name` (how we match) on the supplier master row itself.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

# Column aliases, all lowercased and stripped of spaces/underscores before
# matching. Order matters only for documentation.
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "external_reference": (
        "external_reference", "reference", "po_ref", "po_no", "po_number",
        "purchase_order", "order_no", "doc_no", "document_no",
    ),
    "supplier_name": ("supplier_name", "supplier", "vendor", "vendor_name"),
    "expected_date": ("expected_date", "due_date", "delivery_date", "eta", "expected"),
    "notes": ("notes", "remarks", "comment", "description_of_order"),
    "item_code": ("item_code", "code", "sku", "product_code", "item_no", "item"),
    "name": ("name", "product_name", "description", "item_name", "product"),
    "quantity": ("quantity", "qty", "order_qty", "ordered_qty"),
    "unit_cost": ("unit_cost", "cost", "unit_price", "price", "buy_price"),
}

REQUIRED_FIELDS = ("external_reference", "supplier_name", "item_code", "quantity")

# Date formats we accept, tried in order. Malaysian exports commonly use
# day-first, which is the opposite of Python's default, so it goes first.
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d")


def _normalise_header(raw: str) -> str:
    return str(raw or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "")


def _build_column_map(fieldnames: list[str] | None) -> dict[str, str]:
    """Map our field names to the actual header text, using the alias table."""
    found: dict[str, str] = {}
    if not fieldnames:
        return found
    lookup = {_normalise_header(h): h for h in fieldnames if h}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            key = _normalise_header(alias)
            if key in lookup:
                found[field] = lookup[key]
                break
    return found


def _to_int(value: object) -> int | None:
    raw = str(value or "").strip().replace(",", "")
    if not raw:
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def _to_float(value: object) -> float | None:
    raw = str(value or "").strip().replace(",", "")
    if not raw:
        return None
    # Tolerate a currency prefix: "RM88.50" and "$88.50" are both routine.
    for symbol in ("RM", "MYR", "$", "S$"):
        if raw.upper().startswith(symbol):
            raw = raw[len(symbol):].strip()
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def parse_date(value: object) -> str | None:
    """Return an ISO date string, or None if it cannot be understood."""
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_po_csv(content: bytes | str) -> dict:
    """Parse a CSV export into importable purchase orders.

    Returns::

        {
          "orders": [ ...import_purchase_orders() entries... ],
          "errors": [{"row": 4, "reason": "..."}],
          "warnings": [{"row": 7, "reason": "..."}],
          "columns": {"external_reference": "PO No", ...},   # what we matched
          "rows_read": 12,
          "unmatched_suppliers": ["Shimano SEA"],            # no master row yet
        }

    `errors` are rows that could not be used; `warnings` are rows that were used
    but lost a detail (an unparseable date, say). Both are reported with the
    spreadsheet row number so the user can find them.

    `unmatched_suppliers` is a different category again: the rows were fine, but
    the vendor name has no supplier master row, so the resulting PO will carry
    the name with no `supplier_id`. It is a list of the distinct names found,
    ready to show as "create these suppliers?" rather than an error.
    """
    if isinstance(content, bytes):
        # utf-8-sig strips the BOM Excel writes, which would otherwise corrupt
        # the first header name and silently break column matching.
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    else:
        text = content.lstrip("\ufeff")

    reader = csv.DictReader(io.StringIO(text))
    columns = _build_column_map(reader.fieldnames)

    missing = [f for f in REQUIRED_FIELDS if f not in columns]
    if missing:
        return {
            "orders": [],
            "errors": [{
                "row": 0,
                "reason": (
                    "missing required column(s): " + ", ".join(missing)
                    + ". Found columns: " + ", ".join(str(h) for h in (reader.fieldnames or []))
                ),
            }],
            "warnings": [],
            "columns": columns,
            "rows_read": 0,
            "unmatched_suppliers": [],
        }

    orders: dict[str, dict] = {}
    errors: list[dict] = []
    warnings: list[dict] = []
    rows_read = 0

    for index, row in enumerate(reader, start=2):  # row 1 is the header
        if not any(str(v or "").strip() for v in row.values()):
            continue  # blank line
        rows_read += 1

        def cell(field: str) -> str:
            # Ends trimmed, inner spacing kept on purpose - see the module
            # docstring on snapshots versus normalization.
            return str(row.get(columns[field]) or "").strip()

        reference = cell("external_reference")
        if not reference:
            errors.append({"row": index, "reason": "no PO reference"})
            continue

        supplier = cell("supplier_name")
        item_code = cell("item_code")

        raw_date = cell("expected_date")
        expected = parse_date(raw_date) if raw_date else None
        if raw_date and not expected:
            warnings.append({
                "row": index,
                "reason": f"could not read date {raw_date!r}; left blank",
            })

        # Register the order header BEFORE validating the line. A row with a bad
        # quantity must not make its whole PO disappear: the user is told about
        # the bad row either way, and "2 orders found, 1 error" is far more
        # useful than "1 order found" plus a reference that vanished.
        order = orders.get(reference)
        if order is None:
            order = {
                "external_reference": reference,
                "supplier_name": supplier,
                "expected_date": expected,
                "notes": cell("notes") or None,
                "lines": [],
            }
            orders[reference] = order
        else:
            # Same PO on several rows is normal (one row per line). A different
            # supplier on those rows is not, and we must not guess which is
            # right - reporting beats corrupting the PO.
            if supplier and order["supplier_name"] and supplier != order["supplier_name"]:
                errors.append({
                    "row": index,
                    "reason": (
                        f"PO {reference} is listed with two suppliers "
                        f"({order['supplier_name']!r} and {supplier!r})"
                    ),
                })
                continue
            if not order["supplier_name"] and supplier:
                order["supplier_name"] = supplier
            if not order["expected_date"] and expected:
                order["expected_date"] = expected

        # A supplier name that is blank on the FIRST row can still arrive on a
        # later one; the header exists now, so keep it in step.
        if not order["supplier_name"] and supplier:
            order["supplier_name"] = supplier

        quantity = _to_int(cell("quantity"))
        if quantity is None or quantity <= 0:
            errors.append({
                "row": index,
                "reason": f"quantity must be a positive number (got {cell('quantity')!r})",
            })
            continue
        if not item_code:
            errors.append({"row": index, "reason": "no item code"})
            continue

        order["lines"].append({
            "item_code": item_code,
            "name": cell("name") or None,
            "quantity": quantity,
            "unit_cost": _to_float(cell("unit_cost")),
        })

    # An order left with no usable lines cannot be imported; the importer would
    # skip it with "no lines". Say so here, against the reference, so the message
    # names the PO instead of leaving the user to work it out.
    for reference, order in orders.items():
        if not order["lines"]:
            errors.append({
                "row": 0,
                "reason": (
                    f"PO {reference} has no usable lines "
                    f"(every row was rejected); it will not be imported"
                ),
            })

    unmatched_suppliers = sorted({
        order["supplier_name"]
        for order in orders.values()
        if order["lines"] and order["supplier_name"]
    })

    return {
        "orders": list(orders.values()),
        "errors": errors,
        "warnings": warnings,
        "columns": columns,
        "rows_read": rows_read,
        "unmatched_suppliers": unmatched_suppliers,
    }
