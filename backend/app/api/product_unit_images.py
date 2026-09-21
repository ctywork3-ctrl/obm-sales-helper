import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.product_unit import ProductUnit
from app.models.product_unit_image import ProductUnitImage
from app.models.user import User
from app.permissions import Permissions

router = APIRouter(prefix="/api/product-units", tags=["product-unit-images"])


@router.get("/{unit_id}/images")
async def list_unit_images(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    result = await db.execute(
        select(ProductUnitImage)
        .where(ProductUnitImage.product_unit_id == unit_id)
        .order_by(ProductUnitImage.created_at.desc())
    )
    return [
        {
            "id": image.id,
            "file_path": image.file_path,
            "image_type": image.image_type,
            "caption": image.caption,
            "uploaded_by": image.uploaded_by,
            "created_at": image.created_at.isoformat() if image.created_at else None,
        }
        for image in result.scalars().all()
    ]


@router.post("/{unit_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_unit_image(
    unit_id: int,
    request: Request,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    unit_result = await db.execute(select(ProductUnit).where(ProductUnit.id == unit_id))
    if not unit_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product unit not found")

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, and GIF images are allowed")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="Image is too large")

    os.makedirs(settings.PRIVATE_UPLOAD_DIR, exist_ok=True)
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
    filename = f"unit-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(settings.PRIVATE_UPLOAD_DIR, filename), "wb") as destination:
        destination.write(content)

    image = ProductUnitImage(
        product_unit_id=unit_id,
        file_path=filename,
        caption=caption,
        uploaded_by=current_user.id,
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return {"id": image.id, "file_path": image.file_path, "caption": image.caption}


@router.get("/images/{image_id}/file")
async def get_unit_image_file(
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_SCAN)),
):
    result = await db.execute(select(ProductUnitImage).where(ProductUnitImage.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Evidence image not found")
    private_path = os.path.join(settings.PRIVATE_UPLOAD_DIR, os.path.basename(image.file_path))
    legacy_path = os.path.join(settings.UPLOAD_DIR, os.path.basename(image.file_path))
    path = private_path if os.path.exists(private_path) else legacy_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Evidence image file not found")
    return FileResponse(path)
