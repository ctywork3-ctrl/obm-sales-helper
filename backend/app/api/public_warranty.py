"""Public warranty check.

Why this is a SEPARATE endpoint from `/api/warehouse-ops/warranty/lookup/{code}`,
rather than making that one public:

That endpoint is an internal tool. It returns the customer's **name and phone
number**, the **sales order number**, the warehouse location, and every claim
ever raised. Publishing it would turn a serial number into a lookup that leaks
personal data — and serials are printed on labels anyone can photograph.

So this module answers exactly one question, for the person holding the product:

    "Is this still under warranty, and until when?"

The customer already physically possesses the item and its warranty card, so
the product name and the warranty dates are not disclosure. Everything else is
withheld deliberately, and `tests/test_public_warranty.py` asserts the fields
are absent, so a future edit cannot quietly add them back.

Security posture:
* **Off by default.** `PUBLIC_WARRANTY_ENABLED` must be turned on deliberately.
  The business decided managers and sales checking internally is enough, so the
  endpoint answers 404 unless someone opts in. 404 rather than 403 on purpose:
  a 403 would confirm the route exists.
* **Unmatched serials give nothing away.** A code that does not exist and a code
  that exists but is unsold both return `found: false` with the same wording, so
  the endpoint cannot be used to test whether a serial is real.
* **Rate-limited by prefix** (see `middleware/rate_limit.py`), because a limit on
  a URL that contains the serial would reset on every guess.
* **Read-only.** There is no POST here and no way to change a warranty.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.warehouse import WarrantyClaim

router = APIRouter(prefix="/api/public/warranty", tags=["public-warranty"])

# A serial is short; cap the input so an oversized string cannot be used to make
# the database do pointless work.
MAX_CODE_LENGTH = 64


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("/check/{code}")
async def check_warranty(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """Look up a serial and report its warranty status.

    Returns only fields a customer holding the product already knows. Disabled
    unless PUBLIC_WARRANTY_ENABLED is set.
    """
    if not settings.PUBLIC_WARRANTY_ENABLED:
        # 404, not 403: a 403 confirms the route is real. Staff use the
        # authenticated warranty lookup in the app.
        raise HTTPException(status_code=404, detail="Not found")

    code = (code or "").strip()
    if not code or len(code) > MAX_CODE_LENGTH:
        return _not_found()

    result = await db.execute(
        select(ProductUnit).where(
            or_(
                ProductUnit.serial_number == code,
                ProductUnit.barcode == code,
                ProductUnit.unit_code == code,
                ProductUnit.manufacturer_serial == code,
            )
        )
    )
    unit = result.scalars().first()
    if not unit:
        return _not_found()

    # An unsold unit has no warranty clock yet. Reporting it as "found" would let
    # someone confirm a serial exists straight off the delivery carton, so it is
    # answered the same as an unknown code.
    if not unit.sold_at and not unit.warranty_start:
        return _not_found()

    now = datetime.now(timezone.utc)
    end = unit.warranty_end
    days_left = (end.replace(tzinfo=timezone.utc) - now).days if end else None

    voided = bool(unit.warranty_void_reason)
    active = bool(
        end and days_left is not None and days_left >= 0 and not voided
    )

    product = await db.get(Product, unit.product_id) if unit.product_id else None

    claim_count = (
        await db.execute(
            select(WarrantyClaim.id).where(WarrantyClaim.product_unit_id == unit.id)
        )
    ).scalars().all()

    # NOTE: no customer name, no phone, no sales order number, no cost, no
    # warehouse location, no internal status. See the module docstring.
    return {
        "found": True,
        "code": code,
        "product": {"name": product.name, "brand": product.brand} if product else None,
        "warranty": {
            "active": active,
            "end_date": _iso(end),
            "days_left": days_left if active else None,
            "voided": voided,
            # The reason itself is withheld: it can contain internal notes.
        },
        "has_claims": bool(claim_count),
        "claim_count": len(claim_count),
    }


def _not_found() -> dict:
    """One response shape for every "no".

    An unknown serial, a serial that exists but has not been sold, and a serial
    belonging to a voided sale all land here with byte-identical wording, so the
    endpoint cannot be used to discover which serials are real. Do not add a
    distinguishing field or message.
    """
    return {
        "found": False,
        "product": None,
        "warranty": None,
        "has_claims": False,
        "claim_count": 0,
        "message": (
            "We could not find that serial number. Check the code on the label and "
            "try again, or contact us and we will look it up for you."
        ),
    }
