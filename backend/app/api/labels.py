"""Label printing API.

The config lives behind its own endpoints rather than `/api/settings`, because
`GET /api/settings` requires `SETTINGS_VIEW` which a store keeper does not
have — and the store keeper is exactly who prints labels.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_any_permission, require_permission
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.settings import Setting
from app.models.user import User
from app.permissions import Permissions
from app.services.audit import AuditService
from app.services.labels import (
    DEFAULT_LABEL_CONFIG,
    FIELD_KEYS,
    parse_label_config,
    normalise_label_config,
)

router = APIRouter(prefix="/api/labels", tags=["labels"])

SETTING_KEY = "label_print_settings"

# Printing a label is a warehouse-floor action, so the guard matches that.
LABEL_READ = (
    Permissions.LABELS_PRINT,
    Permissions.STOCK_MOVEMENTS_VIEW,
    Permissions.RECEIVING_TASK_EXECUTE,
)


async def _load_config(db: AsyncSession) -> dict:
    result = await db.execute(select(Setting).where(Setting.key == SETTING_KEY))
    setting = result.scalar_one_or_none()
    if not setting:
        return parse_label_config(None)
    return parse_label_config(setting.value_json)


@router.get("/config")
async def get_label_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*LABEL_READ)),
):
    return {
        "config": await _load_config(db),
        "defaults": DEFAULT_LABEL_CONFIG,
        "field_keys": list(FIELD_KEYS),
    }


@router.put("/config")
async def update_label_config(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.LABELS_CONFIGURE)),
):
    """Save the label defaults. Values are clamped, never rejected."""
    incoming = body.get("config") if isinstance(body.get("config"), dict) else body
    config = normalise_label_config(incoming)

    result = await db.execute(select(Setting).where(Setting.key == SETTING_KEY))
    setting = result.scalar_one_or_none()
    old_value = setting.value_json if setting else None

    if setting:
        setting.value_json = config
        setting.updated_by = current_user.id
    else:
        setting = Setting(key=SETTING_KEY, value_json=config, updated_by=current_user.id)
        db.add(setting)

    await AuditService.log(
        db=db, action="labels.config_update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="setting", entity_label=SETTING_KEY,
        old_values={"value": old_value},
        new_values={"value": config},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"config": config, "message": "Label settings saved"}


@router.post("/render-data")
async def label_render_data(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*LABEL_READ)),
):
    """Label-ready rows for a set of units.

    Body: {unit_ids: int[]} — at most 500 at a time.

    Returns everything the sticker needs, including the plain serial that goes
    into the QR. Deliberately NOT a URL: a label stuck on a rod outlives any
    tunnel hostname we could print today, so the QR carries the serial and a
    public lookup page can be added later without reprinting anything.
    """
    raw_ids = body.get("unit_ids") or []
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="unit_ids must be a list")
    if len(raw_ids) > 500:
        raise HTTPException(status_code=400, detail="At most 500 labels per request")

    try:
        unit_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="unit_ids must be whole numbers")
    if not unit_ids:
        return {"labels": [], "count": 0}

    result = await db.execute(
        select(ProductUnit)
        .options(
            selectinload(ProductUnit.product).selectinload(Product.images),
            selectinload(ProductUnit.location),
        )
        .where(ProductUnit.id.in_(unit_ids))
    )
    units = result.scalars().unique().all()

    by_id = {unit.id: unit for unit in units}
    labels = []
    # Preserve the caller's order so a sheet prints in scan order.
    for unit_id in unit_ids:
        unit = by_id.get(unit_id)
        if not unit:
            continue
        product = unit.product
        labels.append({
            "unit_id": unit.id,
            "code": unit.serial_number,
            "barcode": unit.barcode,
            "unit_code": unit.unit_code,
            "manufacturer_serial": unit.manufacturer_serial,
            "status": unit.status,
            "product_name": product.name if product else None,
            "item_code": (product.obm_item_code or product.item_code) if product else None,
            "brand": product.brand if product else None,
            "warranty_months": unit.warranty_months,
            "warranty_end": unit.warranty_end.isoformat() if unit.warranty_end else None,
            "location": unit.location.name if unit.location else unit.warehouse_location,
            "image_path": product.images[0].file_path if product and product.images else None,
        })

    return {"labels": labels, "count": len(labels)}


@router.get("/lookup-unit")
async def lookup_unit_for_label(
    code: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*LABEL_READ)),
):
    """Find a unit by any of its identifiers, then print its label.

    Uses the same identifier set as `/api/inventory/resolve`, so scanning a
    manufacturer serial, a unit code or the label's own barcode all work.
    """
    result = await db.execute(
        select(ProductUnit)
        .options(selectinload(ProductUnit.product), selectinload(ProductUnit.location))
        .where(or_(
            ProductUnit.barcode == code,
            ProductUnit.unit_code == code,
            ProductUnit.serial_number == code,
            ProductUnit.manufacturer_serial == code,
        ))
        .limit(1)
    )
    unit = result.scalars().first()
    if not unit:
        raise HTTPException(status_code=404, detail=f"No unit found for {code}")

    product: Product | None = unit.product
    return {
        "label": {
            "unit_id": unit.id,
            "code": unit.serial_number,
            "barcode": unit.barcode,
            "unit_code": unit.unit_code,
            "manufacturer_serial": unit.manufacturer_serial,
            "status": unit.status,
            "product_name": product.name if product else None,
            "item_code": (product.obm_item_code or product.item_code) if product else None,
            "brand": product.brand if product else None,
            "warranty_months": unit.warranty_months,
            "warranty_end": unit.warranty_end.isoformat() if unit.warranty_end else None,
            "location": unit.location.name if unit.location else unit.warehouse_location,
            "image_path": product.images[0].file_path if product and product.images else None,
        }
    }
