import csv
import io
import secrets
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.customer import Customer, CustomerAddress, CustomerContact
from app.models.master_data import TaxProfile
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.sales_order import SalesOrder, SalesOrderItem
from app.models.settings import Setting
from app.models.user import User
from app.permissions import Permissions
from app.schemas.sales_order import (
    DiscountCheckRequest,
    MarkKeyedRequest,
    RejectOrderRequest,
    SalesOrderCreate,
    SalesOrderFullUpdate,
    SalesOrderListResponse,
    SalesOrderResponse,
    SalesOrderUpdate,
)
from app.services.audit import AuditService
from app.services.pricing import ZERO, money, normalise_discount_type, price_order
from app.services.stock import deduct_stock, product_inventory_model, recompute_serialized_stock, restore_stock
from app.api.notifications import create_notification

router = APIRouter(prefix="/api/sales-orders", tags=["sales-orders"])

# Effective order discount above this percentage needs a manager's approval.
DEFAULT_DISCOUNT_APPROVAL_PERCENT = Decimal("10")


def utcnow() -> datetime:
    """Aware UTC 'now' — for columns declared DateTime(timezone=True).

    SalesOrder's own timestamp columns are plain ``DateTime`` (no timezone),
    so writing an aware datetime into them makes asyncpg raise
    "can't subtract offset-naive and offset-aware datetimes". Use
    :func:`utcnow_naive` for those and this one only for the unit/receipt
    tables, which really are timezone-aware.
    """
    return datetime.now(timezone.utc)


def utcnow_naive() -> datetime:
    """Naive UTC 'now' — for the plain DateTime columns on sales_orders."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _discount_approval_threshold(db: AsyncSession) -> Decimal:
    """Read the approval threshold from settings, falling back to 10%."""
    result = await db.execute(
        select(Setting).where(Setting.key == "discount_approval_threshold_percent")
    )
    setting = result.scalar_one_or_none()
    if not setting or not isinstance(setting.value_json, dict):
        return DEFAULT_DISCOUNT_APPROVAL_PERCENT
    try:
        return Decimal(str(setting.value_json.get("value", DEFAULT_DISCOUNT_APPROVAL_PERCENT)))
    except (TypeError, ValueError):
        return DEFAULT_DISCOUNT_APPROVAL_PERCENT


def _effective_discount_percent(gross_subtotal: Decimal, discount_total: Decimal) -> Decimal:
    if gross_subtotal <= 0:
        return ZERO
    return (discount_total / gross_subtotal * Decimal("100")).quantize(Decimal("0.01"))


async def _resolve_tax(
    db: AsyncSession, tax_profile_id: int | None, currency: str
) -> tuple[TaxProfile | None, Decimal, bool]:
    """Return (profile, rate-as-fraction, price_includes_tax)."""
    if not tax_profile_id:
        return None, ZERO, False
    result = await db.execute(
        select(TaxProfile).where(TaxProfile.id == tax_profile_id, TaxProfile.is_active == True)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tax profile")
    if profile.currency != currency:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tax profile currency does not match order currency",
        )
    rate = Decimal(str(profile.rate or 0)) / Decimal("100")
    return profile, rate, bool(profile.price_includes_tax)


async def _apply_pricing(
    db: AsyncSession,
    order: SalesOrder,
    item_dicts: list[dict],
    tax_profile_id: int | None = None,
) -> list[SalesOrderItem]:
    """Create SalesOrderItem rows and set the order's money fields.

    ``item_dicts`` entries carry quantity, unit_price, discount_type,
    discount_value plus the snapshot fields.
    """
    profile, tax_rate, price_includes_tax = await _resolve_tax(
        db, tax_profile_id or order.tax_profile_id, order.currency
    )

    priced = price_order(
        item_dicts,
        order_discount_type=order.discount_type,
        order_discount_value=order.discount_value,
        tax_rate=tax_rate,
        price_includes_tax=price_includes_tax,
    )

    items: list[SalesOrderItem] = []
    for line in priced["lines"]:
        item = SalesOrderItem(
            sales_order_id=order.id,
            product_id=line.get("product_id"),
            product_code_snapshot=line.get("product_code_snapshot"),
            product_name_snapshot=line.get("product_name_snapshot"),
            quantity=line.get("quantity"),
            unit_price=line.get("unit_price"),
            notes=line.get("notes"),
            gross_amount=line["gross"],
            discount_type=line["discount_type"],
            discount_value=line["discount_value"],
            discount_amount=line["discount"],
            order_discount_share=line["order_discount_share"],
            line_total=line["line_total"],
            tax_rate_snapshot=tax_rate * Decimal("100"),
            tax_amount=line["tax_amount"],
        )
        db.add(item)
        items.append(item)

    order.gross_subtotal = priced["gross_subtotal"]
    order.line_discount_total = priced["line_discount_total"]
    order.subtotal_amount = priced["subtotal"]
    order.order_discount_amount = priced["order_discount"]
    order.discount_total = priced["discount_total"]
    order.tax_amount = priced["tax_total"]
    order.total_amount = priced["total"]
    order.discount_requires_approval = (
        _effective_discount_percent(priced["gross_subtotal"], priced["discount_total"])
        > await _discount_approval_threshold(db)
    )
    return items


async def _confirm_reserved_units(db: AsyncSession, order_id: int):
    """Mark reserved units as sold and start their warranty clock."""
    units_result = await db.execute(
        select(ProductUnit).where(ProductUnit.order_id == order_id, ProductUnit.status == "RESERVED")
    )
    now = utcnow()
    order_result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = order_result.scalar_one_or_none()

    affected = set()
    for unit in units_result.scalars().all():
        unit.status = "SOLD"
        unit.sold_at = now
        if order is not None:
            unit.customer_id = order.customer_id
        if unit.warranty_months and not unit.warranty_start:
            unit.warranty_start = now
            unit.warranty_end = now + _months_delta(int(unit.warranty_months))
        affected.add(unit.product_id)
    for product_id in affected:
        await recompute_serialized_stock(db, product_id)


def _months_delta(months: int):
    """Add N months to 'now' without pulling in dateutil."""
    from datetime import timedelta

    days = int(round(months * 30.44))
    return timedelta(days=days)


async def _deduct_stock(db: AsyncSession, order_id: int, performed_by: int):
    items_result = await db.execute(
        select(SalesOrderItem).where(SalesOrderItem.sales_order_id == order_id)
    )
    items = items_result.scalars().all()
    quantities = {}
    for item in items:
        if item.product_id:
            quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity

    for product_id, quantity in quantities.items():
        model = await product_inventory_model(db, product_id)
        if model == "SERIALIZED":
            units_result = await db.execute(
                select(ProductUnit)
                .where(ProductUnit.product_id == product_id, ProductUnit.status == "AVAILABLE")
                .order_by(ProductUnit.created_at)
                .limit(quantity)
            )
            units = units_result.scalars().all()
            if len(units) < quantity:
                raise HTTPException(status_code=400, detail="Not enough available units for a tracked item")
            for unit in units:
                unit.status = "RESERVED"
                unit.order_id = order_id
            await recompute_serialized_stock(db, product_id)
        else:
            success = await deduct_stock(
                db, product_id, quantity, "SALES_ORDER", order_id,
                performed_by=performed_by,
                idempotency_key=f"SALES_ORDER:{order_id}:DEDUCT:{product_id}",
            )
            if not success:
                raise HTTPException(status_code=400, detail="Not enough stock to submit this order")


async def _restore_stock(db: AsyncSession, order_id: int, performed_by: int):
    items_result = await db.execute(
        select(SalesOrderItem).where(SalesOrderItem.sales_order_id == order_id)
    )
    items = items_result.scalars().all()
    quantities = {}
    for item in items:
        if item.product_id:
            quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity

    for product_id, quantity in quantities.items():
        model = await product_inventory_model(db, product_id)
        if model == "SERIALIZED":
            units_result = await db.execute(
                select(ProductUnit).where(ProductUnit.order_id == order_id, ProductUnit.status == "RESERVED")
            )
            for unit in units_result.scalars().all():
                unit.status = "AVAILABLE"
                unit.order_id = None
            await recompute_serialized_stock(db, product_id)
        else:
            await restore_stock(
                db, product_id, quantity, "SALES_ORDER", order_id,
                performed_by=performed_by,
                idempotency_key=f"SALES_ORDER:{order_id}:RESTORE:{product_id}",
            )


def _generate_order_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"SO-{today}-{datetime.now(timezone.utc).strftime('%H%M%S')}-{secrets.token_hex(3).upper()}"


async def _load_order(db: AsyncSession, order_id: int) -> SalesOrder:
    result = await db.execute(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.items),
            selectinload(SalesOrder.salesman),
            selectinload(SalesOrder.customer),
        )
        .where(SalesOrder.id == order_id)
    )
    return result.scalar_one()


def _has_view_all(user: User) -> bool:
    return user.role in [
        "IT_ADMIN", "INSIDE_SALES", "DEVELOPER", "MANAGER",
        "DIRECTOR", "OPERATIONS_MANAGER", "PURCHASE_MANAGER",
    ]


@router.get("/discount-policy")
async def discount_policy(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Threshold the draft editor uses to warn 'this needs manager approval'."""
    threshold = await _discount_approval_threshold(db)
    return {
        "approval_threshold_percent": float(threshold),
        "can_approve_discounts": _has_view_all(current_user) or current_user.role == "INSIDE_SALES",
        "max_percent": 100,
    }


@router.post("/discount-check")
async def discount_check(
    body: DiscountCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Live check while typing a discount, so the UI can warn before submit."""
    from app.services.pricing import compute_discount

    amount = money(body.amount)
    discount = compute_discount(amount, body.discount_type, body.discount_value)
    percent = _effective_discount_percent(amount, discount)
    threshold = await _discount_approval_threshold(db)
    return {
        "amount": float(amount),
        "discount_amount": float(discount),
        "net_amount": float(money(amount - discount)),
        "effective_percent": float(percent),
        "requires_approval": percent > threshold,
        "approval_threshold_percent": float(threshold),
    }


@router.get("", response_model=SalesOrderListResponse)
async def list_sales_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query(None, alias="status"),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
        selectinload(SalesOrder.salesman),
        selectinload(SalesOrder.customer),
    )

    if not _has_view_all(current_user):
        query = query.where(SalesOrder.salesman_id == current_user.id)

    if status_filter:
        query = query.where(SalesOrder.status == status_filter)

    if search:
        query = query.where(SalesOrder.order_number.ilike(f"%{search}%"))

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
    customer_result = await db.execute(select(Customer).where(Customer.id == body.customer_id))
    customer = customer_result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if current_user.role == "OUTSIDE_SALES" and customer.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Customer is not assigned to you")

    # Validate the tax profile / currency pairing up front.
    await _resolve_tax(db, body.tax_profile_id, body.currency)

    address_snapshot = body.delivery_address
    if body.delivery_address_id:
        address_result = await db.execute(
            select(CustomerAddress).where(
                CustomerAddress.id == body.delivery_address_id,
                CustomerAddress.customer_id == body.customer_id,
                CustomerAddress.is_active == True,
            )
        )
        address = address_result.scalar_one_or_none()
        if not address:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid delivery address")
        address_snapshot = _address_json(address)

    contact_snapshot = None
    if body.contact_id:
        contact_result = await db.execute(
            select(CustomerContact).where(
                CustomerContact.id == body.contact_id,
                CustomerContact.customer_id == body.customer_id,
                CustomerContact.is_active == True,
            )
        )
        contact = contact_result.scalar_one_or_none()
        if not contact:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid customer contact")
        contact_snapshot = _contact_json(contact)

    order_number = _generate_order_number()

    order = SalesOrder(
        order_number=order_number,
        customer_id=body.customer_id,
        salesman_id=current_user.id,
        status="DRAFT",
        delivery_address=address_snapshot,
        delivery_address_id=body.delivery_address_id,
        contact_id=body.contact_id,
        delivery_address_snapshot=address_snapshot,
        contact_snapshot=contact_snapshot,
        tax_profile_id=body.tax_profile_id,
        notes=body.notes,
        currency=body.currency,
        discount_type=normalise_discount_type(body.discount_type),
        discount_value=body.discount_value,
        discount_reason=body.discount_reason,
    )
    db.add(order)
    await db.flush()

    item_dicts = await _build_item_dicts(db, body.items)
    await _apply_pricing(db, order, item_dicts)

    await AuditService.log(
        db=db,
        action="sales_order.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order_number,
        new_values={
            "order_number": order_number,
            "discount_total": float(order.discount_total or 0),
            "discount_requires_approval": bool(order.discount_requires_approval),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


def _address_json(address: CustomerAddress) -> str:
    import json

    return json.dumps({
        "label": address.label,
        "address_type": address.address_type,
        "address_line1": address.address_line1,
        "address_line2": address.address_line2,
        "postcode": address.postcode,
        "city": address.city,
        "state": address.state,
        "country": address.country,
        "contact_name": address.contact_name,
        "contact_phone": address.contact_phone,
        "delivery_notes": address.delivery_notes,
    })


def _contact_json(contact: CustomerContact) -> str:
    import json

    return json.dumps({
        "name": contact.name,
        "job_title": contact.job_title,
        "phone": contact.phone,
        "mobile": contact.mobile,
        "email": contact.email,
        "whatsapp": contact.whatsapp,
    })


async def _build_item_dicts(db: AsyncSession, items) -> list[dict]:
    """Validate stock and turn request items into pricing dicts."""
    dicts: list[dict] = []
    for item_data in items:
        data = item_data.model_dump()
        if data.get("product_id"):
            product = await db.get(Product, data["product_id"])
            if product is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Product {data['product_id']} not found",
                )
            if (product.stock_qty or 0) < data.get("quantity", 0):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient stock for {product.name}: only {product.stock_qty} available",
                )
            data.setdefault("product_code_snapshot", product.obm_item_code or product.item_code)
            data.setdefault("product_name_snapshot", product.name)
        dicts.append(data)
    return dicts


@router.get("/{order_id:int}", response_model=SalesOrderResponse)
async def get_sales_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = await _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if not _has_view_all(current_user) and order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return SalesOrderResponse.model_validate(order)


@router.patch("/{order_id:int}", response_model=SalesOrderResponse)
async def update_sales_order(
    order_id: int,
    body: SalesOrderUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = await _load_order(db, order_id)
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
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.put("/{order_id:int}", response_model=SalesOrderResponse)
async def full_update_sales_order(
    order_id: int,
    body: SalesOrderFullUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace a draft order's header, discount and lines.

    BUGFIX: this endpoint used to fire an "Order Rejected" notification and
    read ``body.reason``, a field that does not exist on the schema, so any
    call raised AttributeError after already mutating the order. It now only
    records the change in the audit log.
    """
    order = await _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if order.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft orders can be edited",
        )

    if body.customer_id is not None:
        order.customer_id = body.customer_id
    if body.delivery_address is not None:
        order.delivery_address = body.delivery_address
    if body.delivery_address_id is not None:
        order.delivery_address_id = body.delivery_address_id
    if body.contact_id is not None:
        order.contact_id = body.contact_id
    if body.notes is not None:
        order.notes = body.notes
    if body.currency is not None:
        order.currency = body.currency
    if body.tax_profile_id is not None:
        order.tax_profile_id = body.tax_profile_id
    if body.discount_reason is not None:
        order.discount_reason = body.discount_reason
    if "discount_type" in body.model_fields_set:
        order.discount_type = normalise_discount_type(body.discount_type)
    if "discount_value" in body.model_fields_set:
        order.discount_value = body.discount_value

    await _resolve_tax(db, order.tax_profile_id, order.currency)

    if body.items is not None:
        old_items_result = await db.execute(
            select(SalesOrderItem).where(SalesOrderItem.sales_order_id == order.id)
        )
        for item in old_items_result.scalars().all():
            await db.delete(item)
        await db.flush()

        item_dicts = await _build_item_dicts(db, body.items)
        await _apply_pricing(db, order, item_dicts)

    await db.flush()

    await AuditService.log(
        db=db,
        action="sales_order.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values={
            "items_updated": body.items is not None,
            "discount_total": float(order.discount_total or 0),
            "discount_requires_approval": bool(order.discount_requires_approval),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.post("/{order_id:int}/submit", response_model=SalesOrderResponse)
async def submit_sales_order(
    order_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_CREATE)),
):
    order = await _load_order(db, order_id)
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
    order.submitted_at = utcnow_naive()

    await _deduct_stock(db, order.id, current_user.id)

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

    # Big discounts are flagged to the reviewers, not silently accepted.
    inside_users = await db.execute(
        select(User).where(User.role.in_(["INSIDE_SALES", "IT_ADMIN", "DEVELOPER", "MANAGER", "DIRECTOR"]))
    )
    discount_note = ""
    if order.discount_requires_approval:
        discount_note = (
            f" Discount of RM {float(order.discount_total or 0):.2f} "
            f"({_effective_discount_percent(money(order.gross_subtotal), money(order.discount_total))}%) "
            "exceeds the approval threshold."
        )
    for u in inside_users.scalars().all():
        await create_notification(
            db, u.id, "order.submitted", "New Order Submitted",
            f"Order {order.order_number} from {current_user.full_name} is ready for review.{discount_note}",
            f"/app/sales/orders/{order.id}",
        )

    await db.commit()
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.post("/{order_id:int}/approve", response_model=SalesOrderResponse)
async def approve_sales_order(
    order_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_REVIEW)),
):
    order = await _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status != "SUBMITTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only submitted orders can be approved",
        )

    order.status = "APPROVED"
    order.reviewed_by = current_user.id
    order.reviewed_at = utcnow_naive()

    await AuditService.log(
        db=db,
        action="sales_order.approve",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="sales_order",
        entity_id=order.id,
        entity_label=order.order_number,
        new_values={
            "approved_discount": float(order.discount_total or 0),
            "discount_was_flagged": bool(order.discount_requires_approval),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await create_notification(
        db, order.salesman_id, "order.approved", "Order Approved",
        f"Order {order.order_number} has been approved and is ready to key into OBM",
        f"/app/sales/orders/{order.id}",
    )

    await db.commit()
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.post("/{order_id:int}/reject", response_model=SalesOrderResponse)
async def reject_sales_order(
    order_id: int,
    body: RejectOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_REJECT)),
):
    order = await _load_order(db, order_id)
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
    order.reviewed_at = utcnow_naive()

    await _restore_stock(db, order.id, current_user.id)

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
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.post("/{order_id:int}/mark-keyed-to-obm", response_model=SalesOrderResponse)
async def mark_keyed_to_obm(
    order_id: int,
    body: MarkKeyedRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_MARK_KEYED)),
):
    order = await _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only approved orders can be marked as keyed",
        )

    order.status = "KEYED_TO_OBM"
    order.obm_reference_number = body.obm_reference_number
    order.keyed_to_obm_by = current_user.id
    order.keyed_to_obm_at = utcnow_naive()
    order.reviewed_by = current_user.id
    order.reviewed_at = utcnow_naive()

    await _confirm_reserved_units(db, order.id)

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
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.post("/{order_id:int}/cancel", response_model=SalesOrderResponse)
async def cancel_sales_order(
    order_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_CANCEL)),
):
    order = await _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if current_user.role == "OUTSIDE_SALES" and order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if order.status in ("CANCELLED", "KEYED_TO_OBM"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order cannot be cancelled in current status",
        )

    if order.status in ("SUBMITTED", "APPROVED"):
        await _restore_stock(db, order.id, current_user.id)

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
    return SalesOrderResponse.model_validate(await _load_order(db, order.id))


@router.get("/export/csv")
async def export_sales_orders(
    status_filter: str = Query(None, alias="status"),
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(SalesOrder).options(
        selectinload(SalesOrder.items),
        selectinload(SalesOrder.salesman),
        selectinload(SalesOrder.customer),
    )

    if not _has_view_all(current_user):
        query = query.where(SalesOrder.salesman_id == current_user.id)

    if status_filter:
        query = query.where(SalesOrder.status == status_filter)

    if date_from:
        query = query.where(SalesOrder.created_at >= date_from)
    if date_to:
        query = query.where(SalesOrder.created_at <= date_to)

    query = query.order_by(SalesOrder.created_at.desc())
    result = await db.execute(query)
    orders = result.scalars().unique().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Order Number", "Customer", "Salesman", "Status", "Order Date",
        "Gross", "Discount", "Net Subtotal", "Tax", "Total Amount",
        "Currency", "Items Count", "Notes",
    ])

    for order in orders:
        writer.writerow([
            order.order_number,
            order.customer.name if order.customer else "",
            order.salesman.full_name if order.salesman else "",
            order.status,
            order.created_at.isoformat() if order.created_at else "",
            float(order.gross_subtotal or 0),
            float(order.discount_total or 0),
            float(order.subtotal_amount or 0),
            float(order.tax_amount or 0),
            float(order.total_amount or 0),
            order.currency or "MYR",
            len(order.items) if order.items else 0,
            order.notes or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f"attachment; filename=sales_orders_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
            )
        },
    )
