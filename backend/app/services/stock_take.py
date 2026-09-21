"""Stock take sessions: counting the shelf against the system.

The warehouse problem is not "we don't know the number" — it is "the number is
wrong and nobody can say by how much or why". A session makes that concrete:

1. Freeze what the system believes (so a sale mid-count does not move the goalposts).
2. Count what is physically there, on a phone, one scan at a time.
3. Post the differences as documented adjustments with a reason and an operator.

**How the two inventory models are posted differently — this matters:**

* ``BULK`` stock lives as a single number on the product. A variance goes through
  `deduct_stock` / `receive_stock`, which move the number *and* write the ledger.
* ``SERIALIZED`` stock is derived: `stock_qty` is the count of AVAILABLE units. So a
  variance is applied by changing individual unit statuses and recomputing, never by
  calling `deduct_stock` — that would double-count. The ledger row is then written
  from the *actual* before/after difference, so it can never disagree with stock.

A location-scoped count can only include serialized products, because bulk stock in
this app has no location breakdown. Saying so is better than producing a number that
looks authoritative and is not.
"""

from datetime import datetime, timezone
import secrets

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory_adjustment import InventoryAdjustment
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.models.warehouse import (
    StockTakeCount,
    StockTakeScope,
    StockTakeSession,
    StockTakeStatus,
)

UNIT_AVAILABLE = "AVAILABLE"
UNIT_MISSING = "MISSING"


def generate_session_number() -> str:
    return f"ST-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


async def expected_for_product(
    db: AsyncSession, product_id: int, location_id: int | None = None
) -> tuple[int, str, list[int]]:
    """What the system believes is on hand.

    Returns ``(quantity, tracking_mode, available_unit_ids)``. The unit ids are
    returned for serialized products so the variance step can identify exactly
    which physical rods went missing, rather than just a number.
    """
    product = await db.get(Product, product_id)
    if not product:
        return 0, "BULK", []

    tracking = (product.inventory_model or "BULK").upper()

    if tracking == "SERIALIZED":
        conditions = [ProductUnit.product_id == product_id, ProductUnit.status == UNIT_AVAILABLE]
        if location_id is not None:
            conditions.append(ProductUnit.location_id == location_id)
        result = await db.execute(select(ProductUnit.id).where(*conditions).order_by(ProductUnit.id))
        unit_ids = [row[0] for row in result.all()]
        return len(unit_ids), tracking, unit_ids

    return int(product.stock_qty or 0), tracking, []


async def build_session_lines(db: AsyncSession, session: StockTakeSession) -> int:
    """Populate the session's count lines from its scope.

    Called once when the session starts. Returns the number of lines created.
    """
    scope = (session.scope or StockTakeScope.LOCATION).upper()

    if scope == StockTakeScope.LOCATION and session.location_id:
        # Only serialized products: bulk stock has no location breakdown, so an
        # "expected" figure for a location would be a company-wide number in
        # disguise.
        result = await db.execute(
            select(Product.id)
            .join(ProductUnit, ProductUnit.product_id == Product.id)
            .where(
                ProductUnit.location_id == session.location_id,
                Product.is_active == True,  # noqa: E712
            )
            .group_by(Product.id)
            .order_by(Product.name)
        )
        product_ids = [row[0] for row in result.all()]
    elif scope == StockTakeScope.PRODUCT and session.product_id:
        product_ids = [session.product_id]
    else:
        result = await db.execute(
            select(Product.id).where(Product.is_active == True).order_by(Product.name)  # noqa: E712
        )
        product_ids = [row[0] for row in result.all()]

    created = 0
    for product_id in product_ids:
        expected, tracking, _ = await expected_for_product(
            db, product_id, session.location_id if scope == StockTakeScope.LOCATION else None
        )
        db.add(StockTakeCount(
            session_id=session.id,
            product_id=product_id,
            tracking_mode=tracking,
            expected_qty=expected,
            counted_qty=None,
            variance=None,
        ))
        created += 1

    await db.flush()
    session.total_lines = created
    return created


async def refresh_session_counters(db: AsyncSession, session: StockTakeSession) -> StockTakeSession:
    """Recompute the headline numbers from the lines.

    A line counts as *counted* only once it has a real figure, so an untouched
    line is never mistaken for "counted zero".
    """
    result = await db.execute(
        select(StockTakeCount).where(StockTakeCount.session_id == session.id)
    )
    counts = result.scalars().all()

    session.total_lines = len(counts)
    session.counted_lines = sum(1 for c in counts if c.counted_qty is not None)
    session.variance_lines = sum(1 for c in counts if c.variance not in (None, 0))
    return session


async def recorded_unit_ids(db: AsyncSession, session_id: int, product_id: int) -> list[int]:
    """Units scanned during this session for a product."""
    result = await db.execute(
        select(ProductUnit.id).where(
            ProductUnit.product_id == product_id,
            ProductUnit.stock_take_session_id == session_id,
        )
    )
    return [row[0] for row in result.all()]


async def apply_line_variance(
    db: AsyncSession, session: StockTakeSession, count: StockTakeCount, actor: User
) -> dict:
    """Post one line's difference to stock and write the document + ledger row.

    Returns a small report describing what actually happened, so the API can
    tell the operator rather than just saying "done".
    """
    product = await db.get(Product, count.product_id)
    if not product:
        return {"product_id": count.product_id, "applied": False, "reason": "product missing"}

    variance = int(count.variance or 0)
    if variance == 0:
        return {"product_id": product.id, "applied": False, "reason": "no variance"}

    tracking = (count.tracking_mode or "BULK").upper()
    reason = (
        f"Stock take {session.session_number}: counted {count.counted_qty}, "
        f"expected {count.expected_qty}"
    )
    if session.completion_notes:
        reason = f"{reason} — {session.completion_notes}"

    adjustment = InventoryAdjustment(
        adjustment_number=f"ADJ-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}",
        product_id=product.id,
        quantity_delta=variance,
        reason=reason,
        warehouse_location=session.location.name if session.location else None,
        created_by=actor.id,
    )
    db.add(adjustment)
    await db.flush()
    count.adjustment_id = adjustment.id

    missing_units: list[str] = []
    found_units: list[str] = []

    if tracking == "SERIALIZED":
        # Mark the specific rods that are not on the shelf, then let the derived
        # quantity follow. Never call deduct_stock here — stock_qty is computed
        # from AVAILABLE units, so doing both would double-count the loss.
        before = int(product.stock_qty or 0)

        _, _, expected_ids = await expected_for_product(
            db, product.id, session.location_id if session.scope == StockTakeScope.LOCATION else None
        )
        scanned_ids = set(await recorded_unit_ids(db, session.id, product.id))
        gone_ids = [unit_id for unit_id in expected_ids if unit_id not in scanned_ids]

        if gone_ids:
            await db.execute(
                update(ProductUnit)
                .where(ProductUnit.id.in_(gone_ids))
                .values(status=UNIT_MISSING)
            )
            result = await db.execute(
                select(ProductUnit.serial_number).where(ProductUnit.id.in_(gone_ids))
            )
            missing_units = [row[0] for row in result.all()]

        # Units scanned that were not expected: they exist but the system did not
        # think they were available here. Report them instead of guessing — this
        # is usually a unit in the wrong location, or one already marked sold.
        unexpected_ids = [unit_id for unit_id in scanned_ids if unit_id not in set(expected_ids)]
        if unexpected_ids:
            result = await db.execute(
                select(ProductUnit.serial_number).where(ProductUnit.id.in_(unexpected_ids))
            )
            found_units = [row[0] for row in result.all()]

        from app.services.stock import recompute_serialized_stock

        after = await recompute_serialized_stock(db, product.id)
        delta = after - before

        if delta != 0:
            db.add(StockMovement(
                product_id=product.id,
                quantity_delta=delta,
                movement_type="STOCK_TAKE.adjust",
                source_type="STOCK_TAKE",
                source_id=adjustment.id,
                reason=reason,
                performed_by=actor.id,
            ))
        adjustment.quantity_delta = delta
        return {
            "product_id": product.id,
            "applied": delta != 0,
            "delta": delta,
            "adjustment_number": adjustment.adjustment_number,
            "missing_serials": missing_units,
            "unexpected_serials": found_units,
        }

    # Bulk: the number *is* the stock, so the ledger helpers do the whole job.
    from app.services.stock import deduct_stock, receive_stock

    if variance > 0:
        ok = await receive_stock(
            db, product.id, variance, "STOCK_TAKE", adjustment.id,
            performed_by=actor.id, reason=reason,
            idempotency_key=f"STOCK_TAKE:{adjustment.id}",
        )
    else:
        ok = await deduct_stock(
            db, product.id, abs(variance), "STOCK_TAKE", adjustment.id,
            performed_by=actor.id, reason=reason,
            idempotency_key=f"STOCK_TAKE:{adjustment.id}",
        )

    if not ok:
        # The count says more were found than the system had, and the deduction
        # would have gone negative. Drop the document rather than leave a
        # dangling adjustment that never moved anything.
        await db.delete(adjustment)
        count.adjustment_id = None
        return {
            "product_id": product.id,
            "applied": False,
            "reason": "adjustment would make stock negative",
        }

    return {
        "product_id": product.id,
        "applied": True,
        "delta": variance,
        "adjustment_number": adjustment.adjustment_number,
    }


async def clear_session_marks(db: AsyncSession, session_id: int) -> None:
    """Release units claimed by a session, so they can be counted again later."""
    await db.execute(
        update(ProductUnit)
        .where(ProductUnit.stock_take_session_id == session_id)
        .values(stock_take_session_id=None, stock_take_counted_at=None)
    )


async def load_session(db: AsyncSession, session_id: int) -> StockTakeSession | None:
    result = await db.execute(
        select(StockTakeSession)
        .options(selectinload(StockTakeSession.counts))
        .where(StockTakeSession.id == session_id)
    )
    return result.scalar_one_or_none()
