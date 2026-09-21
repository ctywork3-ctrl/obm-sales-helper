import os
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import require_permission
from app.models.inventory_adjustment import InventoryAdjustment
from app.models.inventory_receipt import InventoryReceipt, InventoryReceiptImage, InventoryReceiptLine
from app.models.product import Product
from app.models.product_barcode import ProductBarcode
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.models.product_unit import ProductUnit
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.permissions import Permissions
from app.schemas.inventory import InventoryAdjustmentCreate, InventoryReceiptCreate, InventoryResolveResponse
from app.services.audit import AuditService
from app.services.stock import deduct_stock, receive_stock, recompute_serialized_stock

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _receipt_number() -> str:
    return f"GR-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}"


def _unit_code() -> str:
    return f"U-{uuid.uuid4().hex[:12].upper()}"


def _unit_barcode() -> str:
    return f"TBXU-{uuid.uuid4().hex[:12].upper()}"


def _product_payload(product: Product | None) -> dict | None:
    if not product:
        return None
    return {
        "id": product.id,
        "name": product.name,
        "item_code": product.item_code,
        "obm_item_code": product.obm_item_code,
        "category": product.category,
        "brand": product.brand,
        "uom": product.uom,
        "description": product.description,
        "selling_price": float(product.selling_price or 0),
        "stock_qty": product.stock_qty or 0,
        "inventory_model": (product.inventory_model or "BULK").upper(),
        "images": [
            {"id": image.id, "file_path": image.file_path, "is_primary": image.is_primary}
            for image in (product.images or [])
        ],
    }


def _unit_payload(unit: ProductUnit) -> dict:
    return {
        "id": unit.id,
        "unit_code": unit.unit_code,
        "serial_number": unit.serial_number,
        "manufacturer_serial": unit.manufacturer_serial,
        "barcode": unit.barcode,
        "status": unit.status,
        "warehouse_location": unit.warehouse_location,
        "batch_number": unit.batch_number,
        "product_id": unit.product_id,
        "product_name": unit.product.name if unit.product else None,
        "product_code": unit.product.item_code if unit.product else None,
        "received_at": unit.received_at,
        "receipt_id": unit.receipt_id,
    }


async def _load_receipt(receipt_id: int, db: AsyncSession) -> InventoryReceipt:
    result = await db.execute(
        select(InventoryReceipt)
        .options(
            selectinload(InventoryReceipt.lines).selectinload(InventoryReceiptLine.product),
            selectinload(InventoryReceipt.lines).selectinload(InventoryReceiptLine.units).selectinload(ProductUnit.product),
            selectinload(InventoryReceipt.images),
        )
        .where(InventoryReceipt.id == receipt_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="Inventory receipt not found")
    return receipt


def _receipt_payload(receipt: InventoryReceipt) -> dict:
    units = [unit for line in receipt.lines for unit in line.units]
    return {
        "id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "status": receipt.status,
        "supplier_name": receipt.supplier_name,
        "reference_number": receipt.reference_number,
        "warehouse_location": receipt.warehouse_location,
        "notes": receipt.notes,
        "received_at": receipt.received_at,
        "created_by": receipt.created_by,
        "posted_by": receipt.posted_by,
        "posted_at": receipt.posted_at,
        "created_at": receipt.created_at,
        "lines": [
            {
                "id": line.id,
                "product_id": line.product_id,
                "product": _product_payload(line.product),
                "quantity": line.quantity,
                "tracking_mode": line.tracking_mode,
                "batch_number": line.batch_number,
                "unit_cost": float(line.unit_cost) if line.unit_cost is not None else None,
                "unit_count": len(line.units),
            }
            for line in receipt.lines
        ],
        "units": [_unit_payload(unit) for unit in units],
        "images": [
            {
                "id": image.id,
                "receipt_id": image.receipt_id,
                "file_path": image.file_path,
                "original_filename": image.original_filename,
                "caption": image.caption,
                "uploaded_by": image.uploaded_by,
                "created_at": image.created_at,
            }
            for image in receipt.images
        ],
    }


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
async def receive_inventory(
    body: InventoryReceiptCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    if idempotency_key:
        existing_result = await db.execute(
            select(InventoryReceipt).where(InventoryReceipt.client_key == idempotency_key)
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            return _receipt_payload(await _load_receipt(existing.id, db))

    product_ids = {line.product_id for line in body.lines}
    products_result = await db.execute(
        select(Product).options(selectinload(Product.images)).where(Product.id.in_(product_ids))
    )
    products = {product.id: product for product in products_result.scalars().unique().all()}
    missing = product_ids - products.keys()
    if missing:
        raise HTTPException(status_code=404, detail=f"Product not found: {sorted(missing)}")

    received_at = body.received_at or datetime.now(timezone.utc)
    purchase_order = None
    po_lines: dict[int, PurchaseOrderLine] = {}
    if body.purchase_order_id is not None:
        po_result = await db.execute(
            select(PurchaseOrder)
            .options(selectinload(PurchaseOrder.lines))
            .where(PurchaseOrder.id == body.purchase_order_id)
        )
        purchase_order = po_result.scalar_one_or_none()
        if not purchase_order:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        if purchase_order.status not in ("SENT", "PARTIALLY_RECEIVED"):
            raise HTTPException(
                status_code=400,
                detail=f"Purchase order {purchase_order.po_number} is {purchase_order.status} and cannot be received against",
            )
        po_lines = {line.id: line for line in purchase_order.lines}
        for line_data in body.lines:
            if line_data.purchase_order_line_id is not None:
                po_line = po_lines.get(line_data.purchase_order_line_id)
                if not po_line:
                    raise HTTPException(status_code=400, detail="Purchase order line does not belong to this purchase order")
                if po_line.product_id != line_data.product_id:
                    raise HTTPException(status_code=400, detail="Receipt line product does not match the purchase order line")
    receipt = InventoryReceipt(
        receipt_number=_receipt_number(),
        client_key=idempotency_key,
        status="POSTED",
        supplier_name=body.supplier_name or (purchase_order.supplier_name if purchase_order else None),
        reference_number=body.reference_number,
        warehouse_location=body.warehouse_location,
        notes=body.notes,
        received_at=received_at,
        created_by=current_user.id,
        posted_by=current_user.id,
        posted_at=datetime.now(timezone.utc),
        purchase_order_id=body.purchase_order_id,
    )
    db.add(receipt)
    await db.flush()

    created_units: list[ProductUnit] = []
    for line_data in body.lines:
        line = InventoryReceiptLine(
            receipt_id=receipt.id,
            product_id=line_data.product_id,
            quantity=line_data.quantity,
            tracking_mode=line_data.tracking_mode,
            batch_number=line_data.batch_number,
            unit_cost=line_data.unit_cost,
            purchase_order_line_id=line_data.purchase_order_line_id,
        )
        db.add(line)
        await db.flush()

        product = products[line_data.product_id]
        model = (product.inventory_model or "BULK").upper()

        if model == "SERIALIZED":
            manufacturer_serials = [value.strip() for value in line_data.manufacturer_serials if value.strip()]
            if manufacturer_serials and len(manufacturer_serials) != line_data.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {product.name} needs one serial per unit or none",
                )
            if len(set(manufacturer_serials)) != len(manufacturer_serials):
                raise HTTPException(status_code=400, detail="Serials must be different within one line")

            for index in range(line_data.quantity):
                unit_code = _unit_code()
                manufacturer_serial = manufacturer_serials[index] if manufacturer_serials else None
                unit = ProductUnit(
                    product_id=line_data.product_id,
                    unit_code=unit_code,
                    serial_number=manufacturer_serial or unit_code,
                    manufacturer_serial=manufacturer_serial,
                    barcode=_unit_barcode(),
                    status="AVAILABLE",
                    warehouse_location=body.warehouse_location,
                    batch_number=line_data.batch_number,
                    received_at=received_at,
                    receipt_id=receipt.id,
                    receipt_line_id=line.id,
                    created_by=current_user.id,
                )
                db.add(unit)
                created_units.append(unit)
            # Record the in-movement for the audit trail, then derive available
            # stock from the unit count. Total units are what matters here.
            db.add(StockMovement(
                product_id=line_data.product_id,
                quantity_delta=line_data.quantity,
                movement_type="INVENTORY_RECEIPT.receive",
                source_type="INVENTORY_RECEIPT",
                source_id=receipt.id,
                idempotency_key=f"INVENTORY_RECEIPT:{receipt.id}:LINE:{line.id}",
                reason=receipt.receipt_number,
                performed_by=current_user.id,
            ))
            await recompute_serialized_stock(db, line_data.product_id)
        else:
            if not await receive_stock(
                db,
                line_data.product_id,
                line_data.quantity,
                "INVENTORY_RECEIPT",
                receipt.id,
                performed_by=current_user.id,
                reason=receipt.receipt_number,
                idempotency_key=f"INVENTORY_RECEIPT:{receipt.id}:LINE:{line.id}",
            ):
                raise HTTPException(status_code=400, detail="Could not update stock for receipt line")

    await db.flush()
    if purchase_order is not None:
        for line_data in body.lines:
            if line_data.purchase_order_line_id is not None:
                po_lines[line_data.purchase_order_line_id].quantity_received += line_data.quantity
        await db.flush()
        po_status_result = await db.execute(
            select(PurchaseOrderLine).where(PurchaseOrderLine.purchase_order_id == purchase_order.id)
        )
        all_po_lines = po_status_result.scalars().all()
        if all(line.quantity_received >= line.quantity_ordered for line in all_po_lines):
            purchase_order.status = "COMPLETED"
        elif any(line.quantity_received > 0 for line in all_po_lines):
            purchase_order.status = "PARTIALLY_RECEIVED"
    await AuditService.log(
        db=db,
        action="inventory.receipt.post",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="inventory_receipt",
        entity_id=receipt.id,
        entity_label=receipt.receipt_number,
        new_values={
            "lines": len(body.lines),
            "quantity": sum(line.quantity for line in body.lines),
            "serialized_units": len(created_units),
            "purchase_order_id": body.purchase_order_id,
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    receipt = await _load_receipt(receipt.id, db)
    return _receipt_payload(receipt)


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
async def adjust_inventory(
    body: InventoryAdjustmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_ADJUST)),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    if idempotency_key:
        existing_result = await db.execute(
            select(InventoryAdjustment).where(InventoryAdjustment.client_key == idempotency_key)
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            return {
                "id": existing.id,
                "adjustment_number": existing.adjustment_number,
                "product_id": existing.product_id,
                "quantity_delta": existing.quantity_delta,
                "reason": existing.reason,
            }
    if body.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="Quantity adjustment cannot be zero")
    product_result = await db.execute(select(Product).where(Product.id == body.product_id))
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    adjustment = InventoryAdjustment(
        adjustment_number=f"ADJ-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}",
        client_key=idempotency_key,
        product_id=body.product_id,
        quantity_delta=body.quantity_delta,
        reason=body.reason,
        warehouse_location=body.warehouse_location,
        created_by=current_user.id,
    )
    db.add(adjustment)
    await db.flush()

    if body.quantity_delta > 0:
        success = await receive_stock(
            db, body.product_id, body.quantity_delta, "STOCK_ADJUSTMENT", adjustment.id,
            performed_by=current_user.id, reason=body.reason,
            idempotency_key=f"STOCK_ADJUSTMENT:{adjustment.id}",
        )
    else:
        success = await deduct_stock(
            db, body.product_id, abs(body.quantity_delta), "STOCK_ADJUSTMENT", adjustment.id,
            performed_by=current_user.id, reason=body.reason,
            idempotency_key=f"STOCK_ADJUSTMENT:{adjustment.id}",
        )
    if not success:
        raise HTTPException(status_code=400, detail="Adjustment would make stock negative")

    await AuditService.log(
        db=db,
        action="inventory.adjustment.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="inventory_adjustment",
        entity_id=adjustment.id,
        entity_label=adjustment.adjustment_number,
        new_values={"product_id": body.product_id, "quantity_delta": body.quantity_delta, "reason": body.reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {
        "id": adjustment.id,
        "adjustment_number": adjustment.adjustment_number,
        "product_id": adjustment.product_id,
        "quantity_delta": adjustment.quantity_delta,
        "reason": adjustment.reason,
    }


@router.get("/receipts")
async def list_inventory_receipts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    result = await db.execute(
        select(InventoryReceipt)
        .order_by(InventoryReceipt.received_at.desc())
        .limit(100)
    )
    receipts = result.scalars().all()
    return [
        {
            "id": receipt.id,
            "receipt_number": receipt.receipt_number,
            "status": receipt.status,
            "supplier_name": receipt.supplier_name,
            "reference_number": receipt.reference_number,
            "warehouse_location": receipt.warehouse_location,
            "received_at": receipt.received_at,
            "created_by": receipt.created_by,
        }
        for receipt in receipts
    ]


@router.get("/receipts/{receipt_id}")
async def get_inventory_receipt(
    receipt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    return _receipt_payload(await _load_receipt(receipt_id, db))


@router.post("/receipts/{receipt_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_receipt_image(
    receipt_id: int,
    request: Request,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    receipt_result = await db.execute(select(InventoryReceipt).where(InventoryReceipt.id == receipt_id))
    receipt = receipt_result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="Inventory receipt not found")

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, and GIF images are allowed")
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="Image is too large")

    os.makedirs(settings.PRIVATE_UPLOAD_DIR, exist_ok=True)
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
    filename = f"receipt-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(settings.PRIVATE_UPLOAD_DIR, filename), "wb") as destination:
        destination.write(content)

    image = InventoryReceiptImage(
        receipt_id=receipt.id,
        file_path=filename,
        original_filename=file.filename,
        caption=caption,
        uploaded_by=current_user.id,
    )
    db.add(image)
    await db.flush()
    await AuditService.log(
        db=db,
        action="inventory.receipt.image_upload",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="inventory_receipt",
        entity_id=receipt.id,
        entity_label=receipt.receipt_number,
        new_values={"file_path": filename, "caption": caption},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    await db.refresh(image)
    return {
        "id": image.id,
        "receipt_id": image.receipt_id,
        "file_path": image.file_path,
        "caption": image.caption,
    }


@router.get("/receipt-images/{image_id}/file")
async def get_receipt_image_file(
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    result = await db.execute(select(InventoryReceiptImage).where(InventoryReceiptImage.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Receiving image not found")
    private_path = os.path.join(settings.PRIVATE_UPLOAD_DIR, os.path.basename(image.file_path))
    legacy_path = os.path.join(settings.UPLOAD_DIR, os.path.basename(image.file_path))
    path = private_path if os.path.exists(private_path) else legacy_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Receiving image file not found")
    return FileResponse(path)


@router.get("/resolve/{value}", response_model=InventoryResolveResponse)
async def resolve_inventory_identifier(
    value: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_SCAN)),
):
    unit_result = await db.execute(
        select(ProductUnit)
        .options(selectinload(ProductUnit.product).selectinload(Product.images), selectinload(ProductUnit.images))
        .where(
            or_(
                ProductUnit.barcode == value,
                ProductUnit.unit_code == value,
                ProductUnit.serial_number == value,
                ProductUnit.manufacturer_serial == value,
            )
        )
        .limit(1)
    )
    unit = unit_result.scalar_one_or_none()
    if unit:
        return {
            "found": True,
            "value": value,
            "result_type": "UNIT",
            "unit": _unit_payload(unit),
            "product": _product_payload(unit.product),
        }

    product_result = await db.execute(
        select(Product)
        .options(selectinload(Product.images))
        .where(
            or_(
                Product.barcode == value,
                Product.item_code == value,
                Product.obm_item_code == value,
            )
        )
        .limit(1)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        barcode_result = await db.execute(
            select(ProductBarcode)
            .options(selectinload(ProductBarcode.product).selectinload(Product.images))
            .where(ProductBarcode.barcode_value == value)
            .limit(1)
        )
        product_barcode = barcode_result.scalar_one_or_none()
        product = product_barcode.product if product_barcode else None

    return {
        "found": bool(product),
        "value": value,
        "result_type": "PRODUCT" if product else "UNKNOWN",
        "unit": None,
        "product": _product_payload(product),
    }


@router.get("/units/{unit_id}")
async def get_inventory_unit(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_SCAN)),
):
    result = await db.execute(
        select(ProductUnit)
        .options(selectinload(ProductUnit.product).selectinload(Product.images), selectinload(ProductUnit.images))
        .where(ProductUnit.id == unit_id)
    )
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Product unit not found")

    movements_result = await db.execute(
        select(StockMovement)
        .where(StockMovement.product_id == unit.product_id)
        .order_by(StockMovement.created_at.desc())
        .limit(100)
    )
    return {
        "unit": _unit_payload(unit),
        "product": _product_payload(unit.product),
        "images": [
            {
                "id": image.id,
                "file_path": image.file_path,
                "caption": image.caption,
                "created_at": image.created_at,
            }
            for image in unit.images
        ],
        "movements": [
            {
                "id": movement.id,
                "quantity_delta": movement.quantity_delta,
                "movement_type": movement.movement_type,
                "source_type": movement.source_type,
                "source_id": movement.source_id,
                "reason": movement.reason,
                "created_at": movement.created_at,
            }
            for movement in movements_result.scalars().all()
        ],
    }


@router.get("/reconciliation")
async def reconcile_inventory(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_MOVEMENTS_VIEW)),
):
    """Flag products where the stored quantity does not match the ledger or
    the tracked unit count. Read-only; shows the manager what needs fixing."""
    products = (await db.execute(select(Product))).scalars().all()
    mismatches = []
    for product in products:
        stored = product.stock_qty or 0
        if (product.inventory_model or "BULK").upper() == "SERIALIZED":
            available = int((await db.scalar(
                select(func.count()).select_from(ProductUnit)
                .where(ProductUnit.product_id == product.id, ProductUnit.status == "AVAILABLE")
            )) or 0)
            if available != stored:
                mismatches.append({
                    "product_id": product.id,
                    "item_code": product.item_code,
                    "name": product.name,
                    "model": "SERIALIZED",
                    "stored": stored,
                    "expected": available,
                })
        else:
            ledger = (await db.scalar(
                select(func.coalesce(func.sum(StockMovement.quantity_delta), 0))
                .where(StockMovement.product_id == product.id)
            )) or 0
            if int(ledger) != stored:
                mismatches.append({
                    "product_id": product.id,
                    "item_code": product.item_code,
                    "name": product.name,
                    "model": "BULK",
                    "stored": stored,
                    "expected": int(ledger),
                })
    return {"mismatches": mismatches, "total": len(mismatches)}
