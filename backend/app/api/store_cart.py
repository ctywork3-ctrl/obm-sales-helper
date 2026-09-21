from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.ecommerce import Cart, CartItem, CustomerAccount
from app.models.product import Product
from app.schemas.ecommerce import CartItemRequest, CartItemResponse, CartResponse
from app.api.store_auth import require_store_customer

router = APIRouter(prefix="/api/store/cart", tags=["store-cart"])


async def _get_or_create_cart(db: AsyncSession, customer_id: int) -> Cart:
    result = await db.execute(
        select(Cart)
        .options(selectinload(Cart.items))
        .where(Cart.customer_id == customer_id)
    )
    cart = result.scalar_one_or_none()
    if not cart:
        cart = Cart(customer_id=customer_id)
        db.add(cart)
        await db.flush()
    return cart


async def _calculate_cart(cart: Cart, db: AsyncSession) -> CartResponse:
    total = 0.0
    item_responses = []
    for item in cart.items:
        prod_result = await db.execute(
            select(Product)
            .options(selectinload(Product.images))
            .where(Product.id == item.product_id)
        )
        product = prod_result.scalar_one_or_none()
        unit_price = float(product.selling_price or 0) if product else 0
        line_total = unit_price * item.quantity
        total += line_total

        product_image = None
        if product and product.images:
            primary = next((img for img in product.images if img.is_primary), product.images[0])
            product_image = primary.file_path if primary else None

        item_responses.append(
            CartItemResponse(
                id=item.id,
                product_id=item.product_id,
                quantity=item.quantity,
                product_name=product.name if product else None,
                product_image=product_image,
                unit_price=unit_price,
                line_total=line_total,
            )
        )
    return CartResponse(
        id=cart.id,
        items=item_responses,
        total=total,
        item_count=sum(i.quantity for i in cart.items),
    )


@router.get("", response_model=CartResponse)
async def get_cart(
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    cart = await _get_or_create_cart(db, customer.id)
    await db.commit()
    return await _calculate_cart(cart, db)


@router.post("/items", response_model=CartResponse)
async def add_to_cart(
    body: CartItemRequest,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    prod_result = await db.execute(select(Product).where(Product.id == body.product_id, Product.is_active == True))
    product = prod_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if (product.stock_qty or 0) < body.quantity:
        raise HTTPException(status_code=400, detail=f"Insufficient stock. Only {product.stock_qty} available.")

    cart = await _get_or_create_cart(db, customer.id)

    existing = await db.execute(
        select(CartItem).where(
            CartItem.cart_id == cart.id,
            CartItem.product_id == body.product_id,
        )
    )
    cart_item = existing.scalar_one_or_none()

    if cart_item:
        new_qty = cart_item.quantity + body.quantity
        if (product.stock_qty or 0) < new_qty:
            raise HTTPException(status_code=400, detail=f"Insufficient stock. Only {product.stock_qty} available.")
        cart_item.quantity = new_qty
    else:
        cart_item = CartItem(
            cart_id=cart.id,
            product_id=body.product_id,
            quantity=body.quantity,
        )
        db.add(cart_item)

    await db.commit()
    return await _calculate_cart(cart, db)


@router.put("/items/{item_id}", response_model=CartResponse)
async def update_cart_item(
    item_id: int,
    body: CartItemRequest,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CartItem)
        .join(Cart)
        .where(
            CartItem.id == item_id,
            Cart.customer_id == customer.id,
        )
    )
    cart_item = result.scalar_one_or_none()
    if not cart_item:
        raise HTTPException(status_code=404, detail="Cart item not found")

    prod_result = await db.execute(select(Product).where(Product.id == body.product_id))
    product = prod_result.scalar_one_or_none()
    if product and (product.stock_qty or 0) < body.quantity:
        raise HTTPException(status_code=400, detail=f"Insufficient stock. Only {product.stock_qty} available.")

    cart_item.quantity = body.quantity
    if body.quantity <= 0:
        await db.delete(cart_item)

    await db.commit()
    cart = await _get_or_create_cart(db, customer.id)
    return await _calculate_cart(cart, db)


@router.delete("/items/{item_id}", response_model=CartResponse)
async def remove_cart_item(
    item_id: int,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CartItem)
        .join(Cart)
        .where(
            CartItem.id == item_id,
            Cart.customer_id == customer.id,
        )
    )
    cart_item = result.scalar_one_or_none()
    if not cart_item:
        raise HTTPException(status_code=404, detail="Cart item not found")

    await db.delete(cart_item)
    await db.commit()
    cart = await _get_or_create_cart(db, customer.id)
    return await _calculate_cart(cart, db)


@router.delete("", response_model=CartResponse)
async def clear_cart(
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    cart = await _get_or_create_cart(db, customer.id)
    for item in cart.items:
        await db.delete(item)
    await db.commit()
    return await _calculate_cart(cart, db)
