import hashlib
import hmac
import json
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.ecommerce import (
    Cart,
    CartItem,
    EcommerceCustomerAddress as CustomerAddress,
    CustomerAccount,
    Payment,
    StoreOrder,
    StoreOrderItem,
)
from app.models.product import Product
from app.schemas.ecommerce import (
    StoreOrderCreate,
    StoreOrderResponse,
    PaymentResponse,
)
from app.api.store_auth import require_store_customer

router = APIRouter(prefix="/api/store/checkout", tags=["store-checkout"])


def _generate_store_order_number() -> str:
    now = datetime.now(timezone.utc)
    random_suffix = secrets.token_hex(3).upper()
    return f"ST-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}-{random_suffix}"


def _get_shipping_cost(method: str) -> float:
    shipping_config = {
        "standard": 10.0,
        "express": 20.0,
        "pickup": 0.0,
    }
    if method not in shipping_config:
        raise ValueError(f"Invalid shipping method: {method}")
    return shipping_config[method]


@router.get("/orders", response_model=dict)
async def list_store_orders(
    page: int = 1,
    page_size: int = 10,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func as sqlfunc

    query = select(StoreOrder).options(
        selectinload(StoreOrder.items)
    ).where(StoreOrder.customer_id == customer.id)

    count_query = select(sqlfunc.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(StoreOrder.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    orders = result.scalars().unique().all()

    return {
        "items": [StoreOrderResponse.model_validate(o) for o in orders],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }


@router.get("/{order_id:int}", response_model=StoreOrderResponse)
async def get_store_order(
    order_id: int,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StoreOrder)
        .options(selectinload(StoreOrder.items))
        .where(
            StoreOrder.id == order_id,
            StoreOrder.customer_id == customer.id,
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return StoreOrderResponse.model_validate(order)


@router.post("", response_model=StoreOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_store_order(
    body: StoreOrderCreate,
    request: Request,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    cart_result = await db.execute(
        select(Cart)
        .options(selectinload(Cart.items))
        .where(Cart.customer_id == customer.id)
    )
    cart = cart_result.scalar_one_or_none()
    if not cart or not cart.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    address_json = None
    if body.shipping_address_id:
        addr_result = await db.execute(
            select(CustomerAddress).where(
                CustomerAddress.id == body.shipping_address_id,
                CustomerAddress.customer_id == customer.id,
            )
        )
        address = addr_result.scalar_one_or_none()
        if not address:
            raise HTTPException(status_code=404, detail="Address not found")
        if not address.address_line1:
            raise HTTPException(status_code=400, detail="Invalid address")
        address_json = json.dumps({
            "label": address.label,
            "address_line1": address.address_line1,
            "address_line2": address.address_line2,
            "city": address.city,
            "state": address.state,
            "postcode": address.postcode,
            "country": address.country,
            "phone": address.phone,
        })
    elif body.shipping_address:
        address_json = json.dumps(body.shipping_address.model_dump())

    try:
        shipping_cost = _get_shipping_cost(body.shipping_method)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid shipping method")

    subtotal = 0.0
    order_items = []
    for cart_item in cart.items:
        prod_result = await db.execute(
            select(Product)
            .options(selectinload(Product.images))
            .where(Product.id == cart_item.product_id)
            .with_for_update()
        )
        product = prod_result.scalar_one_or_none()
        if not product:
            continue
        if (product.stock_qty or 0) < cart_item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {product.name}: only {product.stock_qty} available",
            )

        unit_price = float(product.selling_price or 0)
        line_total = unit_price * cart_item.quantity
        subtotal += line_total

        primary_img = None
        if product.images:
            primary = next((img for img in product.images if img.is_primary), product.images[0])
            primary_img = primary.file_path if primary else None

        order_items.append(StoreOrderItem(
            product_id=product.id,
            product_name_snapshot=product.name,
            product_image_snapshot=primary_img,
            quantity=cart_item.quantity,
            unit_price=unit_price,
            line_total=line_total,
        ))

    if not order_items:
        raise HTTPException(status_code=400, detail="No valid items in cart")

    discount = 0.0
    total = subtotal + shipping_cost - discount

    order = StoreOrder(
        order_number=_generate_store_order_number(),
        customer_id=customer.id,
        status="PENDING",
        subtotal=subtotal,
        shipping_cost=shipping_cost,
        discount_amount=discount,
        total_amount=total,
        shipping_method=body.shipping_method,
        delivery_address_json=address_json,
        notes=body.notes,
        promo_code=body.promo_code,
    )
    db.add(order)
    await db.flush()

    for item in order_items:
        item.store_order_id = order.id
        db.add(item)
    await db.flush()

    for cart_item in cart.items:
        await db.delete(cart_item)
    await db.commit()

    result = await db.execute(
        select(StoreOrder)
        .options(selectinload(StoreOrder.items))
        .where(StoreOrder.id == order.id)
    )
    order = result.scalar_one()
    return StoreOrderResponse.model_validate(order)


@router.post("/{order_id:int}/pay", response_model=PaymentResponse)
async def initiate_payment(
    order_id: int,
    request: Request,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StoreOrder).where(
            StoreOrder.id == order_id,
            StoreOrder.customer_id == customer.id,
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "PENDING":
        raise HTTPException(status_code=400, detail="Order is not pending payment")

    existing_result = await db.execute(
        select(Payment).where(Payment.store_order_id == order.id)
    )
    existing_payment = existing_result.scalar_one_or_none()
    if existing_payment:
        if existing_payment.status in ("FAILED", "EXPIRED"):
            await db.delete(existing_payment)
            await db.flush()
        else:
            raise HTTPException(status_code=400, detail="Payment already initiated for this order")

    webhook_url = f"{settings.BACKEND_URL}/api/store/checkout/webhook"
    redirect_url = f"{settings.STOREFRONT_URL}/order-confirmation/{order.id}"

    if not settings.HITPAY_API_KEY:
        payment = Payment(
            store_order_id=order.id,
            status="COMPLETED",
            amount=order.total_amount,
            currency=order.currency,
            payment_method="sandbox",
        )
        db.add(payment)
        order.status = "PAID"
        order.paid_at = datetime.now(timezone.utc)
        await db.flush()

        order_items = await db.execute(
            select(StoreOrderItem).where(StoreOrderItem.store_order_id == order.id)
        )
        for item in order_items.scalars().all():
            if item.product_id:
                await db.execute(
                    update(Product)
                    .where(Product.id == item.product_id)
                    .values(stock_qty=Product.stock_qty - item.quantity)
                )
        await db.commit()

        result = await db.execute(select(Payment).where(Payment.store_order_id == order.id))
        payment = result.scalar_one()
        return PaymentResponse.model_validate(payment)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.HITPAY_API_URL}/payment-requests",
            auth=(settings.HITPAY_API_KEY, settings.HITPAY_API_SECRET),
            data={
                "amount": str(order.total_amount),
                "currency": order.currency,
                "description": f"Order {order.order_number}",
                "webhook": webhook_url,
                "redirect_url": redirect_url,
                "metadata": json.dumps({"order_id": order.id, "order_number": order.order_number}),
            },
        )

    if resp.status_code != 201:
        raise HTTPException(status_code=500, detail="Failed to create payment")

    data = resp.json()
    payment = Payment(
        store_order_id=order.id,
        hitpay_payment_id=data.get("id"),
        status="PENDING",
        amount=order.total_amount,
        currency=order.currency,
        hitpay_reference=data.get("reference_no"),
    )
    db.add(payment)
    await db.commit()

    result = await db.execute(select(Payment).where(Payment.store_order_id == order.id))
    payment = result.scalar_one()
    return PaymentResponse.model_validate(payment)


@router.get("/{order_id:int}/payment-url")
async def get_payment_url(
    order_id: int,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payment)
        .join(StoreOrder)
        .where(
            Payment.store_order_id == order_id,
            StoreOrder.customer_id == customer.id,
        )
    )
    payment = result.scalar_one_or_none()
    if not payment or not payment.hitpay_payment_id:
        raise HTTPException(status_code=404, detail="Payment not found")

    checkout_url = f"https://app.hitpay.me/{settings.HITPAY_MERCHANT_ID}/{payment.hitpay_payment_id}"
    return {"checkout_url": checkout_url}


@router.post("/webhook")
async def hitpay_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.HITPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook not configured")

    body = await request.body()

    signature = request.headers.get("hitpay-signature", "")
    expected = hmac.new(
        settings.HITPAY_WEBHOOK_SECRET.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    data = json.loads(body)

    payment_request = data.get("payment_request", {})
    payment_id = payment_request.get("id") or data.get("id")
    payment_status = data.get("status")

    if not payment_id:
        return {"message": "No payment ID"}

    result = await db.execute(
        select(Payment).where(Payment.hitpay_payment_id == payment_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        return {"message": "Payment not found"}

    if payment.status == "COMPLETED":
        return {"message": "Already processed"}

    status_map = {
        "completed": "COMPLETED",
        "failed": "FAILED",
        "expired": "EXPIRED",
        "pending": "PENDING",
    }
    new_status = status_map.get(payment_status, payment.status)

    forward_transitions = {
        "PENDING": ["COMPLETED", "FAILED", "EXPIRED"],
        "FAILED": [],
        "EXPIRED": [],
        "COMPLETED": [],
    }
    if new_status not in forward_transitions.get(payment.status, []):
        return {"message": "No status change"}

    payment.status = new_status
    payment.webhook_data_json = json.dumps(data)

    if payment.status == "COMPLETED":
        order_result = await db.execute(
            select(StoreOrder).where(StoreOrder.id == payment.store_order_id)
        )
        order = order_result.scalar_one_or_none()
        if order:
            if order.paid_at is None:
                order.paid_at = datetime.now(timezone.utc)
            order.status = "PAID"
            payment.payment_method = data.get("payment_method", "unknown")

            # Decrypt stock on payment confirmation
            items_result = await db.execute(
                select(StoreOrderItem).where(StoreOrderItem.store_order_id == order.id)
            )
            for item in items_result.scalars().all():
                if item.product_id:
                    await db.execute(
                        update(Product)
                        .where(Product.id == item.product_id)
                        .values(stock_qty=Product.stock_qty - item.quantity)
                    )
    elif payment.status in ("FAILED", "EXPIRED"):
        order_result = await db.execute(
            select(StoreOrder).where(StoreOrder.id == payment.store_order_id)
        )
        order = order_result.scalar_one_or_none()
        if order and order.status == "PENDING":
            order.status = "CANCELLED"
            order.cancel_reason = f"Payment {payment.status.lower()}"
            order.cancelled_at = datetime.now(timezone.utc)

    await db.commit()
    return {"message": "Webhook processed"}


@router.get("/shipping-methods")
async def list_shipping_methods():
    return {
        "methods": [
            {"id": "standard", "name": "Standard Shipping", "cost": 10.0, "days": "3-5"},
            {"id": "express", "name": "Express Shipping", "cost": 20.0, "days": "1-2"},
            {"id": "pickup", "name": "Store Pickup", "cost": 0.0, "days": "Ready in 1 hour"},
        ]
    }
