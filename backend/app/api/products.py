from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_permission
from app.models.product import Product, ProductImage
from app.models.user import User
from app.permissions import Permissions
from app.schemas.product import ProductCreate, ProductListResponse, ProductResponse, ProductUpdate
from app.services.audit import AuditService
from app.services.stock import receive_stock

router = APIRouter(prefix="/api/products", tags=["products"])

VALID_EVIDENCE_POLICIES = {"NONE", "RECEIPT", "UNIT"}
VALID_INVENTORY_MODELS = {"BULK", "SERIALIZED"}

SERIALIZED_CATEGORIES = {"equipment", "spare parts"}


def _validate_evidence_policy(value: str | None) -> str:
    policy = (value or "RECEIPT").upper()
    if policy not in VALID_EVIDENCE_POLICIES:
        raise HTTPException(
            status_code=400,
            detail=f"evidence_policy must be one of: {', '.join(sorted(VALID_EVIDENCE_POLICIES))}",
        )
    return policy


def _validate_inventory_model(value: str | None, category: str | None = None) -> str:
    if value:
        model = value.upper()
        if model not in VALID_INVENTORY_MODELS:
            raise HTTPException(
                status_code=400,
                detail="inventory_model must be BULK or SERIALIZED",
            )
        return model
    return "SERIALIZED" if (category or "").lower() in SERIALIZED_CATEGORIES else "BULK"


@router.get("/all", response_model=ProductListResponse)
@router.get("", response_model=ProductListResponse)
async def list_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    category: str = Query(None),
    brand: str = Query(None),
    is_active: bool = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    query = select(Product).options(selectinload(Product.images), selectinload(Product.prices))

    if search:
        query = query.where(
            or_(
                Product.name.ilike(f"%{search}%"),
                Product.item_code.ilike(f"%{search}%"),
                Product.obm_item_code.ilike(f"%{search}%"),
                Product.barcode.ilike(f"%{search}%"),
            )
        )
    if category:
        query = query.where(Product.category == category)
    if brand:
        query = query.where(Product.brand == brand)
    if is_active is not None:
        query = query.where(Product.is_active == is_active)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    products = result.scalars().unique().all()

    items = []
    for product in products:
        item = ProductResponse.model_validate(product)
        if current_user.role not in ["IT_ADMIN", "DEVELOPER", "MANAGER"]:
            item.cost_price = None
        items.append(item)

    return ProductListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    if body.item_code:
        existing = await db.execute(
            select(Product).where(Product.item_code == body.item_code)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Product with this item code already exists",
            )

    product = Product(
        **body.model_dump(),
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    product.evidence_policy = _validate_evidence_policy(body.evidence_policy)
    product.inventory_model = _validate_inventory_model(body.inventory_model, body.category)
    db.add(product)
    await db.flush()

    if (body.stock_qty or 0) > 0:
        if not await receive_stock(
            db,
            product.id,
            body.stock_qty,
            "PRODUCT_OPENING",
            product.id,
            performed_by=current_user.id,
            reason="Opening stock on product creation",
            idempotency_key=f"PRODUCT_OPENING:{product.id}",
        ):
            raise HTTPException(status_code=400, detail="Could not register opening stock")

    await AuditService.log(
        db=db,
        action="products.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product",
        entity_id=product.id,
        entity_label=product.name,
        new_values=body.model_dump(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(product)

    result = await db.execute(
        select(Product).options(selectinload(Product.images), selectinload(Product.prices)).where(Product.id == product.id)
    )
    product = result.scalar_one()
    return ProductResponse.model_validate(product)


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    result = await db.execute(
        select(Product).options(selectinload(Product.images), selectinload(Product.prices)).where(Product.id == product_id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    resp = ProductResponse.model_validate(product)

    if current_user.role not in ["IT_ADMIN", "DEVELOPER", "MANAGER"]:
        resp.cost_price = None

    return resp


@router.patch("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    old_values = {k: getattr(product, k) for k in body.model_fields if getattr(product, k, None) is not None}

    update_data = body.model_dump(exclude_unset=True)
    if "evidence_policy" in update_data:
        update_data["evidence_policy"] = _validate_evidence_policy(update_data["evidence_policy"])
    model_changed_to_serialized = False
    if "inventory_model" in update_data:
        update_data["inventory_model"] = _validate_inventory_model(update_data["inventory_model"])
        model_changed_to_serialized = (
            update_data["inventory_model"] == "SERIALIZED"
            and (product.inventory_model or "BULK") != "SERIALIZED"
        )
    for field, value in update_data.items():
        setattr(product, field, value)
    product.updated_by = current_user.id

    # Switching a product to SERIALIZED makes its stock_qty a derived value
    # (the count of AVAILABLE units). Recompute it immediately, otherwise the
    # old bulk figure lingers and every stock screen shows a number that does
    # not match the units on the shelf.
    if model_changed_to_serialized:
        from app.services.stock import recompute_serialized_stock

        await db.flush()
        await recompute_serialized_stock(db, product.id)

    await AuditService.log(
        db=db,
        action="products.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product",
        entity_id=product.id,
        entity_label=product.name,
        old_values=old_values,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    result = await db.execute(
        select(Product).options(selectinload(Product.images), selectinload(Product.prices)).where(Product.id == product.id)
    )
    product = result.scalar_one()
    return ProductResponse.model_validate(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def put_product(
    product_id: int,
    body: ProductUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    return await update_product(product_id, body, request, db, current_user)


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    product_name = product.name

    images = (await db.execute(
        select(ProductImage).where(ProductImage.product_id == product_id)
    )).scalars().all()
    for img in images:
        await db.delete(img)

    await db.delete(product)
    await db.flush()

    await AuditService.log(
        db=db,
        action="products.delete",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product",
        entity_id=product_id,
        entity_label=product_name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"message": "Product deleted"}
