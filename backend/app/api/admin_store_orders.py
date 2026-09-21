from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.ecommerce import CustomerAccount, Payment, StoreOrder, StoreOrderItem
from app.models.product import Product
from app.models.user import User
from app.services.audit import AuditService

router = APIRouter(prefix="/api/admin/store-orders", tags=["admin-store-orders"])

VALID_STATUS_TRANSITIONS = {
    "PENDING": ["PAID", "CANCELLED"],
    "PAID": ["PROCESSING", "CANCELLED"],
    "PROCESSING": ["SHIPPED", "CANCELLED"],
    "SHIPPED": ["DELIVERED"],
    "DELIVERED": [],
    "CANCELLED": [],
}


@router.get("")
async def list_store_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query(None, alias="status"),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]:
        raise HTTPException(status_code=403, detail="Access denied")

    query = (
        select(StoreOrder)
        .options(
            selectinload(StoreOrder.items),
            selectinload(StoreOrder.customer),
        )
    )

    if status_filter:
        query = query.where(StoreOrder.status == status_filter)

    if search:
        query = query.where(
            StoreOrder.order_number.ilike(f"%{search}%")
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(StoreOrder.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    orders = result.scalars().unique().all()

    items = []
    for order in orders:
        payment_result = await db.execute(
            select(Payment).where(Payment.store_order_id == order.id)
        )
        payment = payment_result.scalar_one_or_none()

        items.append({
            "id": order.id,
            "order_number": order.order_number,
            "status": order.status,
            "subtotal": float(order.subtotal or 0),
            "shipping_cost": float(order.shipping_cost or 0),
            "discount_amount": float(order.discount_amount or 0),
            "total_amount": float(order.total_amount or 0),
            "currency": order.currency,
            "shipping_method": order.shipping_method,
            "delivery_address_json": order.delivery_address_json,
            "notes": order.notes,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "paid_at": order.paid_at.isoformat() if order.paid_at else None,
            "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
            "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
            "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
            "cancel_reason": order.cancel_reason,
            "customer": {
                "id": order.customer.id if order.customer else None,
                "email": order.customer.email if order.customer else None,
                "full_name": order.customer.full_name if order.customer else None,
                "phone": order.customer.phone if order.customer else None,
            } if order.customer else None,
            "items": [
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "product_name_snapshot": item.product_name_snapshot,
                    "product_image_snapshot": item.product_image_snapshot,
                    "quantity": item.quantity,
                    "unit_price": float(item.unit_price or 0),
                    "line_total": float(item.line_total or 0),
                }
                for item in order.items
            ],
            "payment": {
                "status": payment.status if payment else None,
                "payment_method": payment.payment_method if payment else None,
                "hitpay_payment_id": payment.hitpay_payment_id if payment else None,
            } if payment else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }


@router.get("/{order_id:int}")
async def get_store_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(StoreOrder)
        .options(
            selectinload(StoreOrder.items),
            selectinload(StoreOrder.customer),
        )
        .where(StoreOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    payment_result = await db.execute(
        select(Payment).where(Payment.store_order_id == order.id)
    )
    payment = payment_result.scalar_one_or_none()

    address = None
    if order.delivery_address_json:
        import json
        try:
            address = json.loads(order.delivery_address_json)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "id": order.id,
        "order_number": order.order_number,
        "status": order.status,
        "subtotal": float(order.subtotal or 0),
        "shipping_cost": float(order.shipping_cost or 0),
        "discount_amount": float(order.discount_amount or 0),
        "total_amount": float(order.total_amount or 0),
        "currency": order.currency,
        "shipping_method": order.shipping_method,
        "delivery_address": address,
        "notes": order.notes,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "cancel_reason": order.cancel_reason,
        "customer": {
            "id": order.customer.id if order.customer else None,
            "email": order.customer.email if order.customer else None,
            "full_name": order.customer.full_name if order.customer else None,
            "phone": order.customer.phone if order.customer else None,
        } if order.customer else None,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name_snapshot": item.product_name_snapshot,
                "product_image_snapshot": item.product_image_snapshot,
                "quantity": item.quantity,
                "unit_price": float(item.unit_price or 0),
                "line_total": float(item.line_total or 0),
            }
            for item in order.items
        ],
        "payment": {
            "status": payment.status if payment else None,
            "payment_method": payment.payment_method if payment else None,
            "hitpay_payment_id": payment.hitpay_payment_id if payment else None,
        } if payment else None,
    }


@router.patch("/{order_id:int}")
async def update_store_order_status(
    order_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]:
        raise HTTPException(status_code=403, detail="Access denied")

    new_status = body.get("status")
    cancel_reason = body.get("cancel_reason")

    if not new_status:
        raise HTTPException(status_code=400, detail="Status is required")

    result = await db.execute(
        select(StoreOrder)
        .options(selectinload(StoreOrder.items))
        .where(StoreOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    allowed = VALID_STATUS_TRANSITIONS.get(order.status, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from {order.status} to {new_status}. Allowed: {allowed}",
        )

    now = datetime.now(timezone.utc)
    order.status = new_status

    if new_status == "CANCELLED":
        order.cancelled_at = now
        order.cancel_reason = cancel_reason or "Cancelled by staff"

        for item in order.items:
            if item.product_id:
                prod_result = await db.execute(
                    select(Product).where(Product.id == item.product_id).with_for_update()
                )
                product = prod_result.scalar_one_or_none()
                if product:
                    product.stock_qty = (product.stock_qty or 0) + item.quantity

    elif new_status == "SHIPPED":
        order.shipped_at = now
    elif new_status == "DELIVERED":
        order.delivered_at = now

    await AuditService.log(
        db=db,
        action="store_order.status_change",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="store_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values={"status": new_status, "cancel_reason": cancel_reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    return {"message": f"Order status updated to {new_status}", "status": order.status}


@router.get("/stats/summary")
async def store_order_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]:
        raise HTTPException(status_code=403, detail="Access denied")

    total_result = await db.execute(select(func.count()).select_from(StoreOrder))
    total = total_result.scalar() or 0

    paid_result = await db.execute(
        select(func.count()).select_from(
            select(StoreOrder).where(StoreOrder.status == "PAID").subquery()
        )
    )
    paid = paid_result.scalar() or 0

    processing_result = await db.execute(
        select(func.count()).select_from(
            select(StoreOrder).where(StoreOrder.status == "PROCESSING").subquery()
        )
    )
    processing = processing_result.scalar() or 0

    shipped_result = await db.execute(
        select(func.count()).select_from(
            select(StoreOrder).where(StoreOrder.status == "SHIPPED").subquery()
        )
    )
    shipped = shipped_result.scalar() or 0

    revenue_result = await db.execute(
        select(func.coalesce(func.sum(StoreOrder.total_amount), 0)).where(
            StoreOrder.status.in_(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"])
        )
    )
    revenue = float(revenue_result.scalar() or 0)

    return {
        "total": total,
        "paid": paid,
        "processing": processing,
        "shipped": shipped,
        "revenue": revenue,
    }
