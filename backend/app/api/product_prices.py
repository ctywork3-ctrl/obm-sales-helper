from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.product import Product
from app.models.product_price import ProductPrice
from app.models.user import User
from app.permissions import Permissions
from app.schemas.product import ProductPriceCreate, ProductPriceResponse, ProductPriceUpdate
from app.services.audit import AuditService

router = APIRouter(tags=["product-prices"])

ALLOWED_CURRENCIES = {"MYR", "SGD"}


class CurrencyPriceRequest(BaseModel):
    currency: str


@router.get("/api/products/{product_id}/prices", response_model=list[ProductPriceResponse])
async def list_product_prices(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    result = await db.execute(
        select(ProductPrice)
        .where(ProductPrice.product_id == product_id)
        .order_by(ProductPrice.currency)
    )
    return [ProductPriceResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/api/products/{product_id}/prices", response_model=ProductPriceResponse, status_code=status.HTTP_201_CREATED)
async def create_product_price(
    product_id: int,
    body: ProductPriceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    if body.currency not in ALLOWED_CURRENCIES:
        raise HTTPException(status_code=400, detail=f"Currency must be one of: {', '.join(sorted(ALLOWED_CURRENCIES))}")
    if body.unit_price <= 0:
        raise HTTPException(status_code=400, detail="Unit price must be greater than zero")

    product_result = await db.execute(select(Product).where(Product.id == product_id))
    if not product_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    existing_result = await db.execute(
        select(ProductPrice).where(
            ProductPrice.product_id == product_id,
            ProductPrice.currency == body.currency,
        )
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"A {body.currency} price already exists for this product")

    price = ProductPrice(
        product_id=product_id,
        currency=body.currency,
        unit_price=body.unit_price,
        min_qty=body.min_qty,
        is_active=body.is_active,
    )
    db.add(price)
    await db.flush()

    await AuditService.log(
        db=db,
        action="products.price.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_price",
        entity_id=price.id,
        entity_label=f"{body.currency} {body.unit_price}",
        new_values={"product_id": product_id, "currency": body.currency, "unit_price": float(body.unit_price)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(price)
    return ProductPriceResponse.model_validate(price)


@router.patch("/api/product-prices/{price_id}", response_model=ProductPriceResponse)
async def update_product_price(
    price_id: int,
    body: ProductPriceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    result = await db.execute(select(ProductPrice).where(ProductPrice.id == price_id))
    price = result.scalar_one_or_none()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")

    update_data = body.model_dump(exclude_unset=True)
    if "unit_price" in update_data and update_data["unit_price"] is not None and update_data["unit_price"] <= 0:
        raise HTTPException(status_code=400, detail="Unit price must be greater than zero")

    old_values = {"unit_price": float(price.unit_price or 0), "min_qty": price.min_qty, "is_active": price.is_active}
    for field, value in update_data.items():
        setattr(price, field, value)

    await AuditService.log(
        db=db,
        action="products.price.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_price",
        entity_id=price.id,
        entity_label=f"{price.currency} {price.unit_price}",
        old_values=old_values,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(price)
    return ProductPriceResponse.model_validate(price)


@router.delete("/api/product-prices/{price_id}")
async def delete_product_price(
    price_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    result = await db.execute(select(ProductPrice).where(ProductPrice.id == price_id))
    price = result.scalar_one_or_none()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")

    await AuditService.log(
        db=db,
        action="products.price.delete",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_price",
        entity_id=price.id,
        entity_label=f"{price.currency} {price.unit_price}",
        old_values={"product_id": price.product_id, "currency": price.currency},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.delete(price)
    await db.commit()
    return {"message": "Price deleted"}
