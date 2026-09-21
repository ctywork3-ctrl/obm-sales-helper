import os
import secrets
import string
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.dependencies import get_current_user, require_permission
from app.models.product import Product
from app.models.product_barcode import ProductBarcode, ProductIntakeRequest
from app.models.user import User
from app.permissions import Permissions
from app.services.audit import AuditService

router = APIRouter(prefix="/api/barcodes", tags=["barcodes"])


def generate_barcode(prefix: str = "TBX") -> str:
    suffix = secrets.token_hex(4).upper()
    return f"{prefix}-{suffix}"


@router.get("/lookup/{barcode_value}")
async def lookup_barcode(
    barcode_value: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProductBarcode).where(ProductBarcode.barcode_value == barcode_value)
    )
    barcode = result.scalar_one_or_none()

    if not barcode:
        return {"found": False, "barcode": barcode_value}

    product_result = await db.execute(
        select(Product).where(Product.id == barcode.product_id)
    )
    product = product_result.scalar_one_or_none()

    return {
        "found": True,
        "barcode": barcode_value,
        "product": {
            "id": product.id,
            "name": product.name,
            "item_code": product.item_code,
            "selling_price": float(product.selling_price or 0),
            "stock_qty": product.stock_qty or 0,
            "uom": product.uom,
            "category": product.category,
        } if product else None,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_barcode(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    product_id = body.get("product_id")
    barcode_value = body.get("barcode_value") or generate_barcode()
    barcode_type = body.get("barcode_type", "CODE128")
    source = body.get("source", "INTERNAL")

    if not product_id:
        raise HTTPException(status_code=400, detail="product_id is required")

    existing = await db.execute(
        select(ProductBarcode).where(ProductBarcode.barcode_value == barcode_value)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Barcode already exists")

    barcode = ProductBarcode(
        product_id=product_id,
        barcode_value=barcode_value,
        barcode_type=barcode_type,
        source=source,
        created_by=current_user.id,
    )
    db.add(barcode)
    await db.flush()

    await AuditService.log(
        db=db,
        action="barcode.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="barcode",
        entity_id=barcode.id,
        entity_label=barcode_value,
        new_values={"product_id": product_id, "barcode_type": barcode_type, "source": source},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"id": barcode.id, "barcode_value": barcode_value, "barcode_type": barcode_type}


@router.get("/product/{product_id}")
async def list_barcodes_for_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    result = await db.execute(
        select(ProductBarcode).where(ProductBarcode.product_id == product_id)
    )
    barcodes = result.scalars().all()
    return [
        {
            "id": b.id,
            "barcode_value": b.barcode_value,
            "barcode_type": b.barcode_type,
            "source": b.source,
            "is_primary": b.is_primary,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in barcodes
    ]


@router.post("/intake-request", status_code=status.HTTP_201_CREATED)
async def create_intake_request(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    barcode_value = body.get("barcode_value")
    product_name = body.get("product_name")
    if not product_name:
        raise HTTPException(status_code=400, detail="product_name is required")

    request_number = f"IR-{secrets.token_hex(4).upper()}"
    intake = ProductIntakeRequest(
        request_number=request_number,
        barcode_value=barcode_value,
        product_name=product_name,
        brand=body.get("brand"),
        category=body.get("category"),
        description=body.get("description"),
        quantity_received=body.get("quantity_received", 0),
        supplier_name=body.get("supplier_name"),
        suggested_selling_price=body.get("suggested_selling_price"),
        suggested_cost_price=body.get("suggested_cost_price"),
        photo_path=body.get("photo_path"),
        status="DRAFT",
        submitted_by=current_user.id,
    )
    db.add(intake)
    await db.flush()

    await AuditService.log(
        db=db,
        action="product_intake.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_intake",
        entity_id=intake.id,
        entity_label=request_number,
        new_values={"product_name": product_name, "barcode": barcode_value},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"id": intake.id, "request_number": request_number, "status": intake.status}


@router.post("/intake-request/{intake_id}/photo")
async def upload_intake_photo(
    intake_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    result = await db.execute(select(ProductIntakeRequest).where(ProductIntakeRequest.id == intake_id))
    intake = result.scalar_one_or_none()
    if not intake:
        raise HTTPException(status_code=404, detail="Intake request not found")
    if intake.submitted_by != current_user.id or intake.status != "DRAFT":
        raise HTTPException(status_code=403, detail="Only the creator can add photos to a draft request")

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, and GIF images are allowed")
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="Image is too large")

    os.makedirs(settings.PRIVATE_UPLOAD_DIR, exist_ok=True)
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
    filename = f"intake-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(settings.PRIVATE_UPLOAD_DIR, filename), "wb") as destination:
        destination.write(content)
    intake.photo_path = filename
    await AuditService.log(
        db=db,
        action="product_intake.photo_upload",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_intake",
        entity_id=intake.id,
        entity_label=intake.request_number,
        new_values={"photo_path": filename},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"id": intake.id, "photo_path": filename}


@router.get("/intake-request/{intake_id}/photo")
async def get_intake_photo(
    intake_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCT_INTAKE_APPROVE)),
):
    result = await db.execute(select(ProductIntakeRequest).where(ProductIntakeRequest.id == intake_id))
    intake = result.scalar_one_or_none()
    if not intake or not intake.photo_path:
        raise HTTPException(status_code=404, detail="Intake photo not found")
    private_path = os.path.join(settings.PRIVATE_UPLOAD_DIR, os.path.basename(intake.photo_path))
    legacy_path = os.path.join(settings.UPLOAD_DIR, os.path.basename(intake.photo_path))
    path = private_path if os.path.exists(private_path) else legacy_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Intake photo file not found")
    return FileResponse(path)


@router.post("/intake-request/{intake_id}/submit")
async def submit_intake_request(
    intake_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    result = await db.execute(
        select(ProductIntakeRequest).where(ProductIntakeRequest.id == intake_id)
    )
    intake = result.scalar_one_or_none()
    if not intake:
        raise HTTPException(status_code=404, detail="Intake request not found")
    if intake.submitted_by != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if intake.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft requests can be submitted")

    intake.status = "PENDING_REVIEW"
    await db.commit()
    return {"message": "Intake request submitted for review", "status": intake.status}


@router.get("/intake-requests")
async def list_intake_requests(
    request_status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCT_INTAKE_APPROVE)),
):
    query = select(ProductIntakeRequest).order_by(ProductIntakeRequest.created_at.desc())
    if request_status:
        query = query.where(ProductIntakeRequest.status == request_status)
    result = await db.execute(query.limit(100))
    return [
        {
            "id": intake.id,
            "request_number": intake.request_number,
            "barcode_value": intake.barcode_value,
            "product_name": intake.product_name,
            "brand": intake.brand,
            "category": intake.category,
            "description": intake.description,
            "quantity_received": intake.quantity_received,
            "supplier_name": intake.supplier_name,
            "suggested_selling_price": intake.suggested_selling_price,
            "suggested_cost_price": intake.suggested_cost_price,
            "photo_path": intake.photo_path,
            "status": intake.status,
            "submitted_by": intake.submitted_by,
            "created_at": intake.created_at,
            "approved_product_id": intake.approved_product_id,
            "review_notes": intake.review_notes,
        }
        for intake in result.scalars().all()
    ]


@router.post("/intake-request/{intake_id}/resolve")
async def resolve_intake_request(
    intake_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCT_INTAKE_APPROVE)),
):
    return await approve_intake_request(intake_id, body, request, db, current_user)


@router.post("/intake-request/{intake_id}/approve")
async def approve_intake_request(
    intake_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCT_INTAKE_APPROVE)),
):
    result = await db.execute(
        select(ProductIntakeRequest).where(ProductIntakeRequest.id == intake_id)
    )
    intake = result.scalar_one_or_none()
    if not intake:
        raise HTTPException(status_code=404, detail="Intake request not found")
    if intake.status != "PENDING_REVIEW":
        raise HTTPException(status_code=400, detail="Only pending requests can be approved")

    existing_product_id = body.get("existing_product_id")
    if existing_product_id:
        product_result = await db.execute(select(Product).where(Product.id == existing_product_id))
        product = product_result.scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Existing product not found")
        item_code = product.item_code
    else:
        item_code = body.get("item_code", f"IR-{secrets.token_hex(3).upper()}")
        product = Product(
            item_code=item_code,
            name=intake.product_name,
            category=intake.category,
            brand=intake.brand,
            description=intake.description,
            selling_price=body.get("selling_price", intake.suggested_selling_price or 0),
            cost_price=body.get("cost_price", intake.suggested_cost_price or 0),
            stock_qty=0,
            is_active=True,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(product)
        await db.flush()

    if intake.barcode_value:
        barcode_result = await db.execute(
            select(ProductBarcode).where(ProductBarcode.barcode_value == intake.barcode_value)
        )
        existing_barcode = barcode_result.scalar_one_or_none()
        if existing_barcode and existing_barcode.product_id != product.id:
            raise HTTPException(status_code=409, detail="This barcode is already assigned to another product")
        if not existing_barcode:
            db.add(ProductBarcode(
                product_id=product.id,
                barcode_value=intake.barcode_value,
                barcode_type="CODE128",
                source="SUPPLIER",
                created_by=current_user.id,
            ))

    intake.status = "APPROVED"
    intake.reviewed_by = current_user.id
    intake.review_notes = body.get("review_notes")
    intake.approved_product_id = product.id
    from datetime import datetime, timezone
    intake.reviewed_at = datetime.now(timezone.utc)

    await AuditService.log(
        db=db,
        action="product_intake.approve",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_intake",
        entity_id=intake.id,
        entity_label=intake.request_number,
        new_values={"approved_product_id": product.id, "item_code": item_code, "stock_registered": False},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"message": "Product created", "product_id": product.id, "item_code": item_code}
