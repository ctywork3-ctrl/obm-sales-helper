from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.sales_order import SalesOrder, SalesOrderItem
from app.models.product import Product
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.permissions import Permissions

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/sales-summary")
async def sales_summary(
    date_from: str = Query(None),
    date_to: str = Query(None),
    salesman_id: int = Query(None),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_VIEW_ALL)),
):
    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
        selectinload(SalesOrder.salesman),
        selectinload(SalesOrder.customer),
    )

    if date_from:
        query = query.where(SalesOrder.created_at >= date_from)
    if date_to:
        query = query.where(SalesOrder.created_at <= date_to)
    if salesman_id:
        query = query.where(SalesOrder.salesman_id == salesman_id)
    if status:
        query = query.where(SalesOrder.status == status)

    query = query.order_by(SalesOrder.created_at.desc())
    result = await db.execute(query)
    orders = result.scalars().unique().all()

    total_amount = sum(float(o.total_amount or 0) for o in orders)
    total_tax = sum(float(o.tax_amount or 0) for o in orders)
    total_commission = sum(float(o.commission_total or 0) for o in orders)
    total_discount = sum(sum(float(item.discount_amount or 0) for item in (o.items or [])) for o in orders)

    by_status = {}
    for o in orders:
        by_status[o.status] = by_status.get(o.status, 0) + 1

    by_salesman = {}
    for o in orders:
        name = o.salesman.full_name if o.salesman else "Unknown"
        if name not in by_salesman:
            by_salesman[name] = {"count": 0, "total": 0}
        by_salesman[name]["count"] += 1
        by_salesman[name]["total"] += float(o.total_amount or 0)

    by_category = {}
    for o in orders:
        for item in (o.items or []):
            cat = "Unknown"
            if item.product_id:
                p_result = await db.execute(select(Product).where(Product.id == item.product_id))
                p = p_result.scalar_one_or_none()
                if p:
                    cat = p.category or "Unknown"
            if cat not in by_category:
                by_category[cat] = {"count": 0, "total": 0}
            by_category[cat]["count"] += item.quantity
            by_category[cat]["total"] += float(item.line_total or 0)

    return {
        "summary": {
            "total_orders": len(orders),
            "total_amount": round(total_amount, 2),
            "total_tax": round(total_tax, 2),
            "total_commission": round(total_commission, 2),
            "total_discount": round(total_discount, 2),
        },
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_salesman": [{"name": k, "count": v["count"], "total": round(v["total"], 2)} for k, v in sorted(by_salesman.items(), key=lambda x: -x[1]["total"])],
        "by_category": [{"category": k, "count": v["count"], "total": round(v["total"], 2)} for k, v in sorted(by_category.items(), key=lambda x: -x[1]["total"])],
        "orders": [
            {
                "id": o.id, "order_number": o.order_number, "status": o.status,
                "total_amount": float(o.total_amount or 0), "currency": o.currency,
                "salesman": o.salesman.full_name if o.salesman else None,
                "customer": o.customer.name if o.customer else None,
                "created_at": o.created_at.isoformat() if o.created_at else None,
                "commission_total": float(o.commission_total or 0),
            }
            for o in orders
        ],
    }


@router.get("/inventory")
async def inventory_report(
    category: str = Query(None),
    low_stock_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    query = select(Product).options(selectinload(Product.images))
    if category:
        query = query.where(Product.category == category)
    if low_stock_only:
        query = query.where(Product.stock_qty <= 10)
    query = query.order_by(Product.name)

    result = await db.execute(query)
    products = result.scalars().unique().all()

    return {
        "products": [
            {
                "id": p.id, "name": p.name, "item_code": p.item_code,
                "category": p.category, "brand": p.brand, "uom": p.uom,
                "selling_price": float(p.selling_price or 0),
                "stock_qty": p.stock_qty or 0,
                "is_low_stock": (p.stock_qty or 0) <= 10,
                "is_active": p.is_active,
            }
            for p in products
        ],
        "total": len(products),
        "low_stock_count": sum(1 for p in products if (p.stock_qty or 0) <= 10),
    }


@router.get("/commissions")
async def commission_report(
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_VIEW_ALL)),
):
    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
        selectinload(SalesOrder.salesman),
    ).where(SalesOrder.status == "KEYED_TO_OBM")

    if date_from:
        query = query.where(SalesOrder.created_at >= date_from)
    if date_to:
        query = query.where(SalesOrder.created_at <= date_to)

    result = await db.execute(query)
    orders = result.scalars().unique().all()

    by_salesman = {}
    for o in orders:
        name = o.salesman.full_name if o.salesman else "Unknown"
        uid = o.salesman_id
        if uid not in by_salesman:
            by_salesman[uid] = {"name": name, "order_count": 0, "total_amount": 0, "total_commission": 0}
        by_salesman[uid]["order_count"] += 1
        by_salesman[uid]["total_amount"] += float(o.total_amount or 0)
        by_salesman[uid]["total_commission"] += float(o.commission_total or 0)

    return {
        "commissions": [
            {
                "user_id": uid, "name": v["name"],
                "order_count": v["order_count"],
                "total_amount": round(v["total_amount"], 2),
                "total_commission": round(v["total_commission"], 2),
            }
            for uid, v in sorted(by_salesman.items(), key=lambda x: -x[1]["total_commission"])
        ],
        "total_commission": round(sum(v["total_commission"] for v in by_salesman.values()), 2),
    }
