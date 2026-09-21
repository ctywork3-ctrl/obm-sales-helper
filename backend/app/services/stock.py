from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.models.stock_movement import StockMovement


async def deduct_stock(
    db: AsyncSession,
    product_id: int,
    quantity: int,
    source_type: str,
    source_id: int,
    performed_by: int | None = None,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Atomically deduct stock with overflow protection. Returns True if successful."""
    if quantity <= 0:
        return False

    if idempotency_key:
        existing = await db.execute(
            select(StockMovement).where(StockMovement.idempotency_key == idempotency_key)
        )
        if existing.scalar_one_or_none():
            return True  # Already processed

    result = await db.execute(
        update(Product)
        .where(Product.id == product_id, func.coalesce(Product.stock_qty, 0) >= quantity)
        .values(stock_qty=func.coalesce(Product.stock_qty, 0) - quantity)
    )

    if result.rowcount == 0:
        return False

    movement = StockMovement(
        product_id=product_id,
        quantity_delta=-quantity,
        movement_type=f"{source_type}.deduct",
        source_type=source_type,
        source_id=source_id,
        idempotency_key=idempotency_key,
        reason=reason,
        performed_by=performed_by,
    )
    db.add(movement)
    return True


async def restore_stock(
    db: AsyncSession,
    product_id: int,
    quantity: int,
    source_type: str,
    source_id: int,
    performed_by: int | None = None,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Atomically restore stock. Returns True if successful."""
    if quantity <= 0:
        return False

    if idempotency_key:
        existing = await db.execute(
            select(StockMovement).where(StockMovement.idempotency_key == idempotency_key)
        )
        if existing.scalar_one_or_none():
            return True  # Already processed

    await db.execute(
        update(Product)
        .where(Product.id == product_id)
        .values(stock_qty=func.coalesce(Product.stock_qty, 0) + quantity)
    )

    movement = StockMovement(
        product_id=product_id,
        quantity_delta=quantity,
        movement_type=f"{source_type}.restore",
        source_type=source_type,
        source_id=source_id,
        idempotency_key=idempotency_key,
        reason=reason,
        performed_by=performed_by,
    )
    db.add(movement)
    return True


async def receive_stock(
    db: AsyncSession,
    product_id: int,
    quantity: int,
    source_type: str,
    source_id: int,
    performed_by: int | None = None,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Atomically receive stock and write the matching ledger movement."""
    if quantity <= 0:
        return False

    if idempotency_key:
        existing = await db.execute(
            select(StockMovement).where(StockMovement.idempotency_key == idempotency_key)
        )
        if existing.scalar_one_or_none():
            return True

    result = await db.execute(
        update(Product)
        .where(Product.id == product_id)
        .values(stock_qty=func.coalesce(Product.stock_qty, 0) + quantity)
    )
    if result.rowcount == 0:
        return False

    db.add(StockMovement(
        product_id=product_id,
        quantity_delta=quantity,
        movement_type=f"{source_type}.receive",
        source_type=source_type,
        source_id=source_id,
        idempotency_key=idempotency_key,
        reason=reason,
        performed_by=performed_by,
    ))
    return True


async def product_inventory_model(db: AsyncSession, product_id: int) -> str:
    """Return SERIALIZED or BULK for a product."""
    product = await db.get(Product, product_id)
    if not product:
        return "BULK"
    return (product.inventory_model or "BULK").upper()


async def recompute_serialized_stock(db: AsyncSession, product_id: int) -> int:
    """For SERIALIZED products, available stock = count of AVAILABLE units.
    Sets Product.stock_qty to that count and returns it."""
    from app.models.product_unit import ProductUnit
    count = await db.scalar(
        select(func.count())
        .select_from(ProductUnit)
        .where(ProductUnit.product_id == product_id, ProductUnit.status == "AVAILABLE")
    )
    count = int(count or 0)
    await db.execute(
        update(Product).where(Product.id == product_id).values(stock_qty=count)
    )
    return count
