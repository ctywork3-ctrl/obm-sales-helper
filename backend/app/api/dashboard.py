from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.product import Product
from app.models.sales_order import SalesOrder, SalesOrderItem
from app.models.stock_movement import StockMovement
from app.models.user import User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_sales = current_user.role == "OUTSIDE_SALES"
    is_stock = current_user.role == "STOCK_KEEPER"

    if is_stock:
        return await _stock_keeper_dashboard(db)
    if is_sales:
        return await _sales_dashboard(db, current_user)
    return await _manager_dashboard(db)


async def _stock_keeper_dashboard(db: AsyncSession):
    low_stock_result = await db.execute(
        select(Product).where(Product.is_active == True, Product.stock_qty <= 10)
        .order_by(Product.stock_qty.asc()).limit(10)
    )
    low_stock_products = low_stock_result.scalars().all()

    recent_movements_result = await db.execute(
        select(StockMovement).order_by(StockMovement.created_at.desc()).limit(10)
    )
    recent_movements = recent_movements_result.scalars().all()

    total_products_result = await db.execute(
        select(func.count()).select_from(select(Product).where(Product.is_active == True).subquery())
    )
    total_products = total_products_result.scalar() or 0

    return {
        "total_products": total_products,
        "low_stock_count": len(low_stock_products),
        "low_stock_products": [
            {"id": p.id, "name": p.name, "stock_qty": p.stock_qty, "item_code": p.item_code}
            for p in low_stock_products
        ],
        "recent_movements": [
            {
                "id": m.id, "product_id": m.product_id,
                "quantity_delta": m.quantity_delta,
                "movement_type": m.movement_type,
                "reason": m.reason,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in recent_movements
        ],
        "role": "STOCK_KEEPER",
    }


async def _sales_dashboard(db: AsyncSession, current_user: User):
    order_query = select(SalesOrder).where(SalesOrder.salesman_id == current_user.id)

    total_orders_result = await db.execute(select(func.count()).select_from(order_query.subquery()))
    total_orders = total_orders_result.scalar() or 0

    pending_result = await db.execute(
        select(func.count()).select_from(
            order_query.where(SalesOrder.status.in_(["DRAFT", "SUBMITTED"])).subquery()
        )
    )
    pending_orders = pending_result.scalar() or 0

    revenue_result = await db.execute(
        select(func.coalesce(func.sum(SalesOrder.total_amount), 0))
        .where(SalesOrder.salesman_id == current_user.id, SalesOrder.status == "KEYED_TO_OBM")
    )
    my_revenue = revenue_result.scalar() or 0

    low_stock_result = await db.execute(
        select(Product).where(Product.is_active == True, Product.stock_qty <= 10)
    )
    low_stock_products = low_stock_result.scalars().all()

    recent_result = await db.execute(
        select(SalesOrder).where(SalesOrder.salesman_id == current_user.id)
        .order_by(SalesOrder.created_at.desc()).limit(5)
    )
    recent_orders = recent_result.scalars().all()

    return {
        "total_orders": total_orders,
        "pending_orders": pending_orders,
        "total_revenue": float(my_revenue),
        "low_stock_count": len(low_stock_products),
        "low_stock_products": [
            {"id": p.id, "name": p.name, "stock_qty": p.stock_qty, "item_code": p.item_code}
            for p in low_stock_products
        ],
        "recent_orders": [
            {
                "id": o.id, "order_number": o.order_number,
                "status": o.status, "total_amount": float(o.total_amount or 0),
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in recent_orders
        ],
        "role": "OUTSIDE_SALES",
    }


async def _manager_dashboard(db: AsyncSession):
    total_orders_result = await db.execute(
        select(func.count()).select_from(select(SalesOrder).subquery())
    )
    total_orders = total_orders_result.scalar() or 0

    pending_result = await db.execute(
        select(func.count()).select_from(
            select(SalesOrder).where(SalesOrder.status == "SUBMITTED").subquery()
        )
    )
    pending_orders = pending_result.scalar() or 0

    revenue_result = await db.execute(
        select(func.coalesce(func.sum(SalesOrder.total_amount), 0))
        .where(SalesOrder.status == "KEYED_TO_OBM")
    )
    total_revenue = revenue_result.scalar() or 0

    low_stock_result = await db.execute(
        select(Product).where(Product.is_active == True, Product.stock_qty <= 10)
    )
    low_stock_products = low_stock_result.scalars().all()

    recent_result = await db.execute(
        select(SalesOrder).order_by(SalesOrder.created_at.desc()).limit(5)
    )
    recent_orders = recent_result.scalars().all()

    return {
        "total_orders": total_orders,
        "pending_orders": pending_orders,
        "total_revenue": float(total_revenue),
        "low_stock_count": len(low_stock_products),
        "low_stock_products": [
            {"id": p.id, "name": p.name, "stock_qty": p.stock_qty, "item_code": p.item_code}
            for p in low_stock_products
        ],
        "recent_orders": [
            {
                "id": o.id, "order_number": o.order_number,
                "status": o.status, "total_amount": float(o.total_amount or 0),
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in recent_orders
        ],
        "role": "MANAGER",
    }
