"""Moving stock between locations, with a check at each end.

**A transfer never changes a quantity.** It only changes where a unit is. That
invariant is why a transfer is a separate document from a stock adjustment — if a
transfer could move the number, "we lost two rods" and "we moved two rods" would
look identical in the ledger, and the loss would never be found.

The two-sided confirm is the control that matters:

1. The **sender** scans what leaves. This claims the units to the transfer but
   deliberately does **not** relocate them yet.
2. The **receiver** scans what arrives. *This* is what relocates a unit.

So anything scanned out but never scanned in stays exactly where it was, and the
transfer shows the shortfall. A trolley that never reaches the showroom shows up
as a difference rather than silently teleporting stock.

Only serialized products can be transferred, because only they carry a location.
"""

from datetime import datetime, timezone
import secrets

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.warehouse import (
    StockTransfer,
    StockTransferLine,
    StockTransferStatus,
)

UNIT_AVAILABLE = "AVAILABLE"

# Statuses a unit must be in to be physically moved. A sold or reserved rod is
# spoken for, and moving it would break the promise made to a customer.
MOVABLE_STATUSES = ("AVAILABLE",)


def generate_transfer_number() -> str:
    return f"TR-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


async def load_transfer(db: AsyncSession, transfer_id: int) -> StockTransfer | None:
    result = await db.execute(
        select(StockTransfer)
        .options(selectinload(StockTransfer.lines))
        .where(StockTransfer.id == transfer_id)
    )
    return result.scalar_one_or_none()


def refresh_counters(transfer: StockTransfer) -> StockTransfer:
    """Recompute the headline numbers from the lines."""
    transfer.total_units = sum(line.quantity_expected for line in transfer.lines)
    transfer.dispatched_units = sum(line.quantity_dispatched for line in transfer.lines)
    transfer.received_units = sum(line.quantity_received for line in transfer.lines)
    return transfer


async def find_unit(db: AsyncSession, code: str) -> ProductUnit | None:
    result = await db.execute(
        select(ProductUnit)
        .options(selectinload(ProductUnit.product))
        .where(or_(
            ProductUnit.barcode == code,
            ProductUnit.unit_code == code,
            ProductUnit.serial_number == code,
            ProductUnit.manufacturer_serial == code,
        ))
        .limit(1)
    )
    return result.scalars().first()


def _line_for(transfer: StockTransfer, product_id: int) -> StockTransferLine | None:
    return next((line for line in transfer.lines if line.product_id == product_id), None)


async def scan_dispatch(
    db: AsyncSession, transfer: StockTransfer, code: str
) -> dict:
    """Record a unit as leaving the source location.

    Deliberately does **not** change the unit's location. Nothing has arrived yet.
    """
    unit = await find_unit(db, code)
    if not unit:
        return {"result": "UNKNOWN", "message": f"No unit matches {code}."}

    line = _line_for(transfer, unit.product_id)
    if line is None:
        return {
            "result": "NOT_IN_TRANSFER",
            "message": f"{unit.serial_number} is not on this transfer.",
            "product_id": unit.product_id,
        }

    if unit.stock_transfer_id == transfer.id:
        return {
            "result": "ALREADY_DISPATCHED",
            "message": f"{unit.serial_number} has already been sent.",
            "quantity_dispatched": line.quantity_dispatched,
            "quantity_expected": line.quantity_expected,
        }

    if unit.stock_transfer_id and unit.stock_transfer_id != transfer.id:
        return {
            "result": "ON_ANOTHER_TRANSFER",
            "message": (
                f"{unit.serial_number} is already on transfer #{unit.stock_transfer_id}. "
                "Finish or cancel that one first."
            ),
        }

    if unit.status not in MOVABLE_STATUSES:
        return {
            "result": "NOT_MOVABLE",
            "message": (
                f"{unit.serial_number} is {unit.status.lower()} and cannot be moved. "
                "A sold or reserved rod is already spoken for."
            ),
        }

    # A location mismatch is worth reporting but not worth blocking over — the
    # system is often the thing that is wrong, and the operator is holding the
    # rod. The receiver's scan is what sets the truth.
    mismatch = unit.location_id != transfer.from_location_id
    location_note = None
    if mismatch:
        location_note = (
            f"the system had it in "
            f"{unit.location.name if unit.location else 'no location'}"
        )

    unit.stock_transfer_id = transfer.id
    line.quantity_dispatched += 1
    refresh_counters(transfer)
    await db.flush()

    return {
        "result": "OK_LOCATION_MISMATCH" if mismatch else "OK",
        "message": (
            f"{unit.serial_number} sent"
            + (f" — note {location_note}." if location_note else ".")
        ),
        "product_id": unit.product_id,
        "quantity_dispatched": line.quantity_dispatched,
        "quantity_expected": line.quantity_expected,
    }


async def scan_receive(
    db: AsyncSession, transfer: StockTransfer, code: str
) -> dict:
    """Confirm a unit arrived. **This is the scan that relocates it.**"""
    unit = await find_unit(db, code)
    if not unit:
        return {"result": "UNKNOWN", "message": f"No unit matches {code}."}

    line = _line_for(transfer, unit.product_id)
    if line is None:
        return {
            "result": "NOT_IN_TRANSFER",
            "message": f"{unit.serial_number} is not on this transfer.",
            "product_id": unit.product_id,
        }

    if unit.stock_transfer_id != transfer.id:
        return {
            "result": "NOT_DISPATCHED",
            "message": (
                f"{unit.serial_number} was never scanned out of "
                f"{transfer.from_location.name if transfer.from_location else 'the source'}. "
                "It may have been sent on a different transfer."
            ),
        }

    unit.location_id = transfer.to_location_id
    unit.stock_transfer_id = None
    line.quantity_received += 1
    refresh_counters(transfer)
    await db.flush()

    return {
        "result": "OK",
        "message": f"{unit.serial_number} received into "
                   f"{transfer.to_location.name if transfer.to_location else 'the destination'}.",
        "product_id": unit.product_id,
        "quantity_received": line.quantity_received,
        "quantity_expected": line.quantity_expected,
    }


async def release_units(db: AsyncSession, transfer_id: int) -> int:
    """Unclaim every unit still in flight on a transfer.

    Used when a transfer is cancelled. Locations are left untouched — nothing
    moved, so nothing should change.
    """
    result = await db.execute(
        update(ProductUnit)
        .where(ProductUnit.stock_transfer_id == transfer_id)
        .values(stock_transfer_id=None)
    )
    return int(result.rowcount or 0)


async def units_in_flight(db: AsyncSession, transfer_id: int) -> list[dict]:
    """Units claimed by a transfer that have not yet been received."""
    result = await db.execute(
        select(ProductUnit)
        .options(selectinload(ProductUnit.product))
        .where(ProductUnit.stock_transfer_id == transfer_id)
        .order_by(ProductUnit.id)
    )
    return [
        {
            "id": unit.id,
            "serial_number": unit.serial_number,
            "product_id": unit.product_id,
            "product_name": unit.product.name if unit.product else None,
        }
        for unit in result.scalars().unique().all()
    ]


async def transferable_products(
    db: AsyncSession, from_location_id: int, search: str | None = None
) -> list[dict]:
    """What could actually be sent from a location right now."""
    conditions = [
        ProductUnit.location_id == from_location_id,
        ProductUnit.status == UNIT_AVAILABLE,
        ProductUnit.stock_transfer_id.is_(None),
        Product.is_active == True,  # noqa: E712
    ]
    query = (
        select(
            Product.id,
            Product.name,
            Product.item_code,
            Product.obm_item_code,
            func.count(ProductUnit.id).label("available"),
        )
        .join(ProductUnit, ProductUnit.product_id == Product.id)
        .where(*conditions)
        .group_by(Product.id, Product.name, Product.item_code, Product.obm_item_code)
        .order_by(Product.name)
    )
    if search:
        like = f"%{search}%"
        query = query.where(or_(
            Product.name.ilike(like),
            Product.item_code.ilike(like),
            Product.obm_item_code.ilike(like),
        ))

    result = await db.execute(query)
    return [
        {
            "product_id": row[0],
            "product_name": row[1],
            "product_code": row[3] or row[2],
            "available_here": row[4],
        }
        for row in result.all()
    ]


async def transfer_report(db: AsyncSession, transfer: StockTransfer) -> dict:
    """Per-line progress, including anything sent but never received.

    `in_flight` is the number that matters: units the sender scanned out that the
    receiver has not confirmed. They are still physically at the source location.
    """
    rows = []
    for line in transfer.lines:
        product = await db.get(Product, line.product_id)
        rows.append({
            "line_id": line.id,
            "product_id": line.product_id,
            "product_name": product.name if product else None,
            "product_code": (product.obm_item_code or product.item_code) if product else None,
            "quantity_expected": line.quantity_expected,
            "quantity_dispatched": line.quantity_dispatched,
            "quantity_received": line.quantity_received,
            "in_flight": line.quantity_dispatched - line.quantity_received,
        })
    return {
        "lines": rows,
        "in_flight_total": sum(row["in_flight"] for row in rows),
    }
