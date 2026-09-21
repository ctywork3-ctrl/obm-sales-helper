import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.product_unit import ProductUnit
from app.models.product import Product
from app.models.user import User
from app.permissions import Permissions
from app.services.audit import AuditService
from app.services.stock import recompute_serialized_stock, product_inventory_model

router = APIRouter(prefix="/api/product-units", tags=["product-units"])

ALLOWED_STATUS_TRANSITIONS = {
    "AVAILABLE": {"RESERVED", "DAMAGED", "QUARANTINED", "MISSING"},
    "RESERVED": {"AVAILABLE", "SOLD", "DAMAGED", "QUARANTINED", "MISSING"},
    "SOLD": {"RETURNED", "AVAILABLE"},
    "RETURNED": {"AVAILABLE", "DAMAGED"},
    "DAMAGED": {"AVAILABLE", "QUARANTINED"},
    "QUARANTINED": {"AVAILABLE", "DAMAGED"},
    # A unit written off by a stock take can be found again later.
    "MISSING": {"AVAILABLE", "DAMAGED"},
}


def generate_serial_number(product_id: int) -> str:
    prefix = f"P{product_id:04d}"
    suffix = secrets.token_hex(3).upper()
    return f"{prefix}-{suffix}"


def generate_unit_code() -> str:
    return f"U-{secrets.token_hex(6).upper()}"


def generate_unit_barcode() -> str:
    return f"TBXU-{secrets.token_hex(6).upper()}"


@router.get("/product/{product_id}")
async def list_units_for_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_SCAN)),
):
    result = await db.execute(
        select(ProductUnit).where(ProductUnit.product_id == product_id)
        .order_by(ProductUnit.created_at.desc())
    )
    units = result.scalars().all()
    return [
        {
            "id": u.id,
            "unit_code": u.unit_code,
            "serial_number": u.serial_number,
            "manufacturer_serial": u.manufacturer_serial,
            "barcode": u.barcode,
            "status": u.status,
            "warehouse_location": u.warehouse_location,
            # The real location, as opposed to the legacy free-text field above.
            # This is what a transfer or a stock take actually moves.
            "location_id": u.location_id,
            "location_name": u.location.name if u.location else None,
            "batch_number": u.batch_number,
            "received_at": u.received_at.isoformat() if u.received_at else None,
            "sold_at": u.sold_at.isoformat() if u.sold_at else None,
            "order_id": u.order_id,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in units
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_unit(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    product_id = body.get("product_id")
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id is required")

    product_result = await db.execute(select(Product).where(Product.id == product_id))
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    unit_code = body.get("unit_code") or generate_unit_code()
    manufacturer_serial = body.get("manufacturer_serial") or None
    serial_number = body.get("serial_number") or manufacturer_serial or unit_code
    barcode = body.get("barcode") or generate_unit_barcode()

    existing = await db.execute(
        select(ProductUnit).where(ProductUnit.serial_number == serial_number)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Serial number already exists")

    unit = ProductUnit(
        product_id=product_id,
        unit_code=unit_code,
        serial_number=serial_number,
        manufacturer_serial=manufacturer_serial,
        barcode=barcode,
        status="AVAILABLE",
        warehouse_location=body.get("warehouse_location"),
        batch_number=body.get("batch_number"),
        received_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
    db.add(unit)
    await db.flush()

    # For serialized items the available stock is the unit count. This legacy
    # single-unit path is only kept for small ad-hoc corrections.
    if (await product_inventory_model(db, product_id)) == "SERIALIZED":
        await recompute_serialized_stock(db, product_id)
    else:
        from app.services.stock import receive_stock
        if not await receive_stock(
            db, product_id, 1, "PRODUCT_UNIT", unit.id,
            performed_by=current_user.id, reason="Direct unit receipt",
            idempotency_key=f"PRODUCT_UNIT:{unit.id}:RECEIVE",
        ):
            raise HTTPException(status_code=400, detail="Could not update stock for unit")

    await AuditService.log(
        db=db, action="product_unit.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="product_unit", entity_id=unit.id, entity_label=serial_number,
        new_values={"product_id": product_id, "serial_number": serial_number},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {
        "id": unit.id,
        "unit_code": unit_code,
        "serial_number": serial_number,
        "barcode": barcode,
        "status": unit.status,
    }


@router.get("/lookup/{serial_number}")
async def lookup_unit(
    serial_number: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_SCAN)),
):
    result = await db.execute(
        select(ProductUnit).where(
            or_(
                ProductUnit.serial_number == serial_number,
                ProductUnit.unit_code == serial_number,
                ProductUnit.barcode == serial_number,
                ProductUnit.manufacturer_serial == serial_number,
            )
        )
    )
    unit = result.scalar_one_or_none()
    if not unit:
        return {"found": False}

    product_result = await db.execute(select(Product).where(Product.id == unit.product_id))
    product = product_result.scalar_one_or_none()

    return {
        "found": True,
        "unit": {
            "id": unit.id,
            "unit_code": unit.unit_code,
            "serial_number": unit.serial_number,
            "manufacturer_serial": unit.manufacturer_serial,
            "barcode": unit.barcode,
            "status": unit.status,
            "warehouse_location": unit.warehouse_location,
        },
        "product": {
            "id": product.id,
            "name": product.name,
            "item_code": product.item_code,
        } if product else None,
    }


@router.patch("/{unit_id}")
async def update_unit(
    unit_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WAREHOUSE_RECEIVE)),
):
    result = await db.execute(select(ProductUnit).where(ProductUnit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Product unit not found")

    old_values = {
        "status": unit.status,
        "warehouse_location": unit.warehouse_location,
        "barcode": unit.barcode,
    }
    old_status = unit.status

    if "status" in body:
        new_status = body["status"]
        if new_status != unit.status and new_status not in ALLOWED_STATUS_TRANSITIONS.get(unit.status, set()):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot change unit status from {unit.status} to {new_status}",
            )
        unit.status = new_status
        if new_status == "SOLD":
            unit.sold_at = datetime.now(timezone.utc)
            if "order_id" in body:
                unit.order_id = body["order_id"]
        elif old_status == "SOLD":
            # BUGFIX: the old check compared against the already-updated
            # status, so sold_at was never cleared when a unit was returned
            # to stock. Compare against the pre-update status instead.
            unit.sold_at = None
    if "warehouse_location" in body:
        unit.warehouse_location = body["warehouse_location"]
    if "barcode" in body:
        if body["barcode"] and body["barcode"] != unit.barcode:
            existing = await db.execute(
                select(ProductUnit).where(ProductUnit.barcode == body["barcode"])
            )
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Barcode already assigned to another unit")
        unit.barcode = body["barcode"]

    if "status" in body and (await product_inventory_model(db, unit.product_id)) == "SERIALIZED":
        await recompute_serialized_stock(db, unit.product_id)

    await AuditService.log(
        db=db,
        action="product_unit.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_unit",
        entity_id=unit.id,
        entity_label=unit.serial_number,
        old_values=old_values,
        new_values={k: getattr(unit, k) for k in old_values},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"message": "Unit updated", "status": unit.status}
