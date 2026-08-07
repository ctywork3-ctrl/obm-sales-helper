import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.product import Product, ProductImage
from app.models.user import User
from app.permissions import Permissions
from app.schemas.product import ProductImageResponse
from app.services.audit import AuditService

router = APIRouter(tags=["product-images"])


@router.post("/api/products/{product_id}/images", response_model=ProductImageResponse, status_code=status.HTTP_201_CREATED)
async def upload_image(
    product_id: int,
    file: UploadFile,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_IMAGE_UPLOAD)),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File type not allowed. Allowed: JPEG, PNG, WebP, GIF",
        )

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE // (1024 * 1024)}MB",
        )

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    ext = file.filename.split(".")[-1] if file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    existing_images = await db.execute(
        select(ProductImage).where(ProductImage.product_id == product_id)
    )
    existing_count = len(existing_images.scalars().all())
    is_primary = existing_count == 0

    image = ProductImage(
        product_id=product_id,
        file_path=filename,
        original_filename=file.filename,
        mime_type=file.content_type,
        file_size=len(content),
        is_primary=is_primary,
        uploaded_by=current_user.id,
    )
    db.add(image)
    await db.flush()

    await AuditService.log(
        db=db,
        action="products.image.upload",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_image",
        entity_id=image.id,
        entity_label=file.filename,
        new_values={"product_id": product_id, "filename": file.filename},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(image)
    return ProductImageResponse.model_validate(image)


@router.delete("/api/product-images/{image_id}")
async def delete_image(
    image_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_IMAGE_DELETE)),
):
    result = await db.execute(select(ProductImage).where(ProductImage.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    filepath = os.path.join(settings.UPLOAD_DIR, image.file_path)
    if os.path.exists(filepath):
        os.remove(filepath)

    was_primary = image.is_primary
    product_id = image.product_id

    await db.delete(image)
    await db.flush()

    if was_primary:
        next_image = await db.execute(
            select(ProductImage)
            .where(ProductImage.product_id == product_id)
            .order_by(ProductImage.id)
            .limit(1)
        )
        next_img = next_image.scalar_one_or_none()
        if next_img:
            next_img.is_primary = True

    await AuditService.log(
        db=db,
        action="products.image.delete",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_image",
        entity_id=image_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"message": "Image deleted"}


@router.post("/api/product-images/{image_id}/set-primary")
async def set_primary_image(
    image_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_IMAGE_UPLOAD)),
):
    result = await db.execute(select(ProductImage).where(ProductImage.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    await db.execute(
        ProductImage.__table__.update()
        .where(ProductImage.product_id == image.product_id)
        .values(is_primary=False)
    )

    image.is_primary = True

    await AuditService.log(
        db=db,
        action="products.image.set_primary",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_image",
        entity_id=image_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"message": "Primary image updated"}
