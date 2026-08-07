from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.sales_order import SalesOrder, SalesOrderItem
from app.models.user import User
from app.permissions import Permissions
from app.schemas.sales_order import (
    MarkKeyedRequest,
    RejectOrderRequest,
    SalesOrderCreate,
    SalesOrderListResponse,
    SalesOrderResponse,
    SalesOrderUpdate,
)
from app.services.audit import AuditService

router = APIRouter(prefix="/api/sales-orders", tags=["sales-orders"])


def _generate_order_number(db: AsyncSession) -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    return f"SO-{today}-{datetime.utcnow().strftime('%H%M%S')}"


@router.get("", response_model=SalesOrderListResponse)
async def list_sales_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query(None, alias="status"),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_permissions = Permissions
    has_view_all = current_user.role in ["IT_ADMIN", "INSIDE_SALES"]

    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
    )

    if not has_view_all:
        query = query.where(SalesOrder.salesman_id == current_user.id)

    if status_filter:
        query = query.where(SalesOrder.status == status_filter)

    if search:
        query = query.where(
            SalesOrder.order_number.ilike(f"%{search}%")
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(SalesOrder.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    orders = result.scalars().unique().all()

    return SalesOrderListResponse(
        items=[SalesOrderResponse.model_validate(o) for o in orders],
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.post("", response_model=SalesOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_sales_order(
    body: SalesOrderCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_CREATE)),
):
    order_number = _generate_order_number(db)

    order = SalesOrder(
        order_number=order_number,
        customer_id=body.customer_id,
        salesman_id=current_user.id,
        status="DRAFT",
        delivery_address=body.delivery_address,
        notes=body.notes,
        currency=body.currency,
    )
    db.add(order)
    await db.flush()

    for item_data in body.items:
        item = SalesOrderItem(
            sales_order_id=order.id,
            **item_data.model_dump(),
        )
        db.add(item)

    await db.flush()

    await AuditService.log(
        db=db,
        action="sales_order.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order_number,
        new_values={"order_number": order_number},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)


@router.get("/{order_id}", response_model=SalesOrderResponse)
async def get_sales_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    has_view_all = current_user.role in ["IT_ADMIN", "INSIDE_SALES"]
    if not has_view_all and order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return SalesOrderResponse.model_validate(order)


@router.patch("/{order_id}", response_model=SalesOrderResponse)
async def update_sales_order(
    order_id: int,
    body: SalesOrderUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if order.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft orders can be edited",
        )

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(order, field, value)

    await AuditService.log(
        db=db,
        action="sales_order.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(order)

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)


@router.post("/{order_id}/submit", response_model=SalesOrderResponse)
async def submit_sales_order(
    order_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_CREATE)),
):
    result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if order.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft orders can be submitted",
        )

    order.status = "SUBMITTED"
    order.submitted_at = datetime.utcnow()

    await AuditService.log(
        db=db,
        action="sales_order.submit",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)


@router.post("/{order_id}/reject", response_model=SalesOrderResponse)
async def reject_sales_order(
    order_id: int,
    body: RejectOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_REJECT)),
):
    result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status != "SUBMITTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only submitted orders can be rejected",
        )

    order.status = "REJECTED"
    order.rejected_reason = body.reason
    order.reviewed_by = current_user.id
    order.reviewed_at = datetime.utcnow()

    await AuditService.log(
        db=db,
        action="sales_order.reject",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values={"reason": body.reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)


@router.post("/{order_id}/mark-keyed-to-obm", response_model=SalesOrderResponse)
async def mark_keyed_to_obm(
    order_id: int,
    body: MarkKeyedRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_MARK_KEYED)),
):
    result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status != "SUBMITTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only submitted orders can be marked as keyed",
        )

    order.status = "KEYED_TO_OBM"
    order.obm_reference_number = body.obm_reference_number
    order.keyed_to_obm_by = current_user.id
    order.keyed_to_obm_at = datetime.utcnow()
    order.reviewed_by = current_user.id
    order.reviewed_at = datetime.utcnow()

    await AuditService.log(
        db=db,
        action="sales_order.mark_keyed",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values={"obm_reference_number": body.obm_reference_number},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)


@router.post("/{order_id}/cancel", response_model=SalesOrderResponse)
async def cancel_sales_order(
    order_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_CANCEL)),
):
    result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status in ("CANCELLED", "KEYED_TO_OBM"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order cannot be cancelled in current status",
        )

    order.status = "CANCELLED"

    await AuditService.log(
        db=db,
        action="sales_order.cancel",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    )
    order = result.scalar_one()
    return SalesOrderResponse.model_validate(order)
