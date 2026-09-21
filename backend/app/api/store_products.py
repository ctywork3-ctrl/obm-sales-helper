from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.ecommerce import ProductCategory
from app.models.product import Product, ProductImage
from app.schemas.ecommerce import CategoryResponse

router = APIRouter(prefix="/api/store/products", tags=["store-products"])


@router.get("")
async def list_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    category: str = Query(None),
    min_price: float = Query(None),
    max_price: float = Query(None),
    sort: str = Query("newest"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Product).options(
        selectinload(Product.images)
    ).where(Product.is_active == True)

    if search:
        query = query.where(
            or_(
                Product.name.ilike(f"%{search}%"),
                Product.description.ilike(f"%{search}%"),
                Product.item_code.ilike(f"%{search}%"),
                Product.brand.ilike(f"%{search}%"),
            )
        )

    if category:
        query = query.where(Product.category == category)

    if min_price is not None:
        query = query.where(Product.selling_price >= min_price)
    if max_price is not None:
        query = query.where(Product.selling_price <= max_price)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    if sort == "price_asc":
        query = query.order_by(Product.selling_price.asc())
    elif sort == "price_desc":
        query = query.order_by(Product.selling_price.desc())
    elif sort == "name":
        query = query.order_by(Product.name.asc())
    else:
        query = query.order_by(Product.created_at.desc())

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    products = result.scalars().unique().all()

    items = []
    for p in products:
        primary_image = next((img for img in p.images if img.is_primary), p.images[0] if p.images else None)
        items.append({
            "id": p.id,
            "name": p.name,
            "item_code": p.item_code,
            "category": p.category,
            "brand": p.brand,
            "description": p.description,
            "selling_price": float(p.selling_price or 0),
            "stock_qty": p.stock_qty or 0,
            "uom": p.uom,
            "image_url": primary_image.file_path if primary_image else None,
            "images": [{"id": img.id, "file_path": img.file_path, "is_primary": img.is_primary} for img in p.images],
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }


@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ProductCategory)
        .where(ProductCategory.is_active == True)
        .order_by(ProductCategory.sort_order, ProductCategory.name)
    )
    categories = result.scalars().all()
    if categories:
        return [CategoryResponse.model_validate(c) for c in categories]

    # Keep the read-only catalog useful even when category records have not been seeded.
    category_result = await db.execute(
        select(Product.category)
        .where(Product.is_active == True, Product.category.is_not(None))
        .distinct()
        .order_by(Product.category)
    )
    return [
        {
            "id": index,
            "name": category,
            "slug": category.lower().replace(" ", "-"),
            "description": None,
            "parent_id": None,
            "sort_order": index,
            "is_active": True,
        }
        for index, (category,) in enumerate(category_result.all(), start=1)
    ]


@router.get("/featured")
async def featured_products(
    limit: int = Query(8, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Product)
        .options(selectinload(Product.images))
        .where(Product.is_active == True)
        .order_by(Product.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    products = result.scalars().unique().all()

    items = []
    for p in products:
        primary_image = next((img for img in p.images if img.is_primary), p.images[0] if p.images else None)
        items.append({
            "id": p.id,
            "name": p.name,
            "item_code": p.item_code,
            "category": p.category,
            "brand": p.brand,
            "selling_price": float(p.selling_price or 0),
            "stock_qty": p.stock_qty or 0,
            "image_url": primary_image.file_path if primary_image else None,
        })
    return items


@router.get("/{product_id}")
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Product)
        .options(selectinload(Product.images))
        .where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return {
        "id": product.id,
        "name": product.name,
        "item_code": product.item_code,
        "obm_item_code": product.obm_item_code,
        "category": product.category,
        "brand": product.brand,
        "description": product.description,
        "uom": product.uom,
        "selling_price": float(product.selling_price or 0),
        "stock_qty": product.stock_qty or 0,
        "barcode": product.barcode,
        "images": [
            {
                "id": img.id,
                "file_path": img.file_path,
                "original_filename": img.original_filename,
                "is_primary": img.is_primary,
            }
            for img in product.images
        ],
    }
