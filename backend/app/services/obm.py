"""OBM (the accounting package) integration seam.

**No network code lives here yet, on purpose.** The business currently raises
purchase orders in OBM and re-keys them here, and they have not decided how OBM
can hand a PO over (printed PDF, Excel/CSV export, or an API). Writing a
connector against a guessed interface would be wasted work.

What this module *does* provide:

* `get_obm_config()` — finally makes the `obm_api_url`, `obm_api_key` and
  `enable_obm_sync` settings real. Until now nothing in the backend read them.
* `import_purchase_orders()` — the landing point a future connector calls. It
  is idempotent on `(source="OBM_IMPORT", external_reference)`, so re-running a
  sync updates rather than duplicates, and it refuses to touch a PO a human has
  already started working on.

So a connector only has to produce a list of dicts and call this.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.master_data import Supplier, normalize_supplier_name
from app.models.product import Product
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.models.settings import Setting

OBM_SETTING_KEYS = ("obm_api_url", "obm_api_key", "enable_obm_sync")

SOURCE_MANUAL = "MANUAL"
SOURCE_OBM = "OBM_IMPORT"

# A PO only imports cleanly while it is untouched. Once warehouse staff have
# been sent to count it, an import must not rewrite the lines underneath them.
IMPORTABLE_STATUSES = ("DRAFT",)


async def get_obm_config(db: AsyncSession) -> dict:
    """Read the OBM connection settings.

    Returns `{"configured": bool, "enabled": bool, "api_url": str}`. The API key
    is deliberately NOT returned — callers that need it should read it inside
    the connector, so it cannot leak into a response payload or a log line.
    """
    result = await db.execute(select(Setting).where(Setting.key.in_(OBM_SETTING_KEYS)))
    values: dict[str, object] = {}
    for setting in result.scalars().all():
        payload = setting.value_json
        if isinstance(payload, dict):
            values[setting.key] = payload.get("value")
        else:
            values[setting.key] = payload

    api_url = str(values.get("obm_api_url") or "").strip()
    api_key = str(values.get("obm_api_key") or "").strip()
    enabled = bool(values.get("enable_obm_sync"))

    return {
        "api_url": api_url,
        "enabled": enabled,
        # A URL without a key cannot authenticate, so treat it as unconfigured
        # rather than failing later with a confusing 401.
        "configured": bool(api_url and api_key),
        "source": SOURCE_OBM,
    }


async def _resolve_supplier(db: AsyncSession, supplier_name: object) -> int | None:
    """Match an external supplier name to a supplier master row.

    Matches on the NORMALIZED name, so "Shimano SEA", "shimano sea" and
    " Shimano  SEA " all find the same vendor. Returns None when there is no
    match, and deliberately does NOT create one: an import is not the place to
    invent master data, or every typo in the accounting package becomes a
    permanent supplier. Unmatched names still import (the PO keeps its
    supplier_name snapshot) and can be linked later from the Suppliers screen.
    """
    normalized = normalize_supplier_name(supplier_name if isinstance(supplier_name, str) else None)
    if not normalized:
        return None
    result = await db.execute(select(Supplier.id).where(Supplier.normalized_name == normalized))
    return result.scalar_one_or_none()


async def _resolve_product(db: AsyncSession, line: dict) -> Product | None:
    """Match an external line to a real product.

    Tries the OBM item code first (that is the identifier the accounting package
    actually knows), then the internal code, then an exact name match. No fuzzy
    matching: importing the wrong product into a PO is worse than importing
    nothing, and an unmatched line is reported back so a human can fix it.
    """
    code = str(line.get("item_code") or "").strip()
    if code:
        result = await db.execute(
            select(Product).where(
                (Product.obm_item_code == code) | (Product.item_code == code)
            ).limit(1)
        )
        product = result.scalars().first()
        if product:
            return product

    name = str(line.get("name") or "").strip()
    if name:
        result = await db.execute(select(Product).where(Product.name.ilike(name)).limit(1))
        return result.scalars().first()
    return None


async def import_purchase_orders(
    db: AsyncSession,
    external_orders: list[dict],
    actor_user_id: int,
) -> dict:
    """Upsert purchase orders that came from OBM.

    Each entry in ``external_orders``::

        {
          "external_reference": "OBM-PO-10233",     # required, the OBM doc number
          "supplier_name": "Shimano SEA",
          "expected_date": "2026-10-01",            # optional
          "notes": "..."                            # optional
          "lines": [
            {"item_code": "OBM-R001", "name": "Stingray Rod", "quantity": 20, "unit_cost": 88.5}
          ]
        }

    Returns a report rather than raising, because a sync of 40 POs should not be
    thrown away because one line referenced a product nobody has created yet.
    The caller (a future connector, or an admin screen) surfaces the warnings.
    """
    created = 0
    updated = 0
    skipped: list[dict] = []
    unmatched_lines: list[dict] = []

    for entry in external_orders:
        reference = str(entry.get("external_reference") or "").strip()
        if not reference:
            skipped.append({"reason": "missing external_reference", "entry": entry.get("supplier_name")})
            continue

        lines = entry.get("lines") or []
        if not lines:
            skipped.append({"reason": "no lines", "reference": reference})
            continue

        existing = await db.execute(
            select(PurchaseOrder)
            .options(selectinload(PurchaseOrder.lines))
            .where(
                PurchaseOrder.source == SOURCE_OBM,
                PurchaseOrder.external_reference == reference,
            )
        )
        po = existing.scalars().first()

        if po and po.status not in IMPORTABLE_STATUSES:
            # Someone is already receiving this. Do not rewrite it.
            skipped.append({
                "reason": f"PO already in progress ({po.status})",
                "reference": reference,
                "po_number": po.po_number,
            })
            continue

        expected = entry.get("expected_date")
        expected_date = None
        if expected:
            try:
                expected_date = datetime.fromisoformat(str(expected).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                skipped.append({"reason": "unparseable expected_date", "reference": reference})
                continue

        # Resolve every line BEFORE touching the purchase order.
        #
        # Doing it in the other order (create the PO, then add lines) means an
        # order whose lines all fail to match a product is created as an empty
        # shell. A draft with no items is worse than no draft: it looks like a
        # real order someone has to open and investigate, and re-importing would
        # also wipe the lines off a PO that already had them.
        resolved: list[tuple] = []
        for line in lines:
            product = await _resolve_product(db, line)
            if not product:
                unmatched_lines.append({
                    "reference": reference,
                    "item_code": line.get("item_code"),
                    "name": line.get("name"),
                })
                continue

            try:
                quantity = int(line.get("quantity") or 0)
            except (TypeError, ValueError):
                unmatched_lines.append({
                    "reference": reference,
                    "item_code": line.get("item_code"),
                    "reason": "quantity is not a whole number",
                })
                continue
            if quantity <= 0:
                continue

            resolved.append((product, quantity, line))

        if not resolved:
            # Same rule the CSV parser follows: name it, never hide it. The
            # order exists in the accounting package, so silently dropping it
            # would leave the user hunting for a document we were told about.
            skipped.append({
                "reason": "no lines matched a product",
                "reference": reference,
            })
            continue

        if po is None:
            po = PurchaseOrder(
                po_number=f"PO-OBM-{reference}"[:50],
                supplier_id=await _resolve_supplier(db, entry.get("supplier_name")),
                supplier_name=str(entry.get("supplier_name") or "Unknown supplier")[:200],
                status="DRAFT",
                source=SOURCE_OBM,
                external_reference=reference[:100],
                external_synced_at=datetime.now(timezone.utc),
                expected_date=expected_date,
                notes=entry.get("notes"),
                created_by=actor_user_id,
            )
            db.add(po)
            await db.flush()
            created += 1
        else:
            # Replace the lines wholesale: the accounting package is the source
            # of truth for a PO that has not been worked on yet.
            po.supplier_id = await _resolve_supplier(db, entry.get("supplier_name")) or po.supplier_id
            po.supplier_name = str(entry.get("supplier_name") or po.supplier_name)[:200]
            po.expected_date = expected_date
            po.notes = entry.get("notes") or po.notes
            po.external_synced_at = datetime.now(timezone.utc)
            for old_line in list(po.lines):
                await db.delete(old_line)
            await db.flush()
            updated += 1

        for product, quantity, line in resolved:
            db.add(PurchaseOrderLine(
                purchase_order_id=po.id,
                product_id=product.id,
                quantity_ordered=quantity,
                # Always zero: this app's received quantity reflects THIS app's
                # receipts, never another system's belief. OBM's figure is kept
                # separately so the difference can be shown to a human.
                quantity_received=0,
                unit_cost=line.get("unit_cost"),
                obm_quantity_processed=line.get("quantity_processed"),
            ))

        await db.flush()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "unmatched_lines": unmatched_lines,
        "message": (
            f"{created} created, {updated} updated"
            + (f", {len(unmatched_lines)} line(s) could not be matched to a product" if unmatched_lines else "")
            + (f", {len(skipped)} skipped" if skipped else "")
        ),
    }
