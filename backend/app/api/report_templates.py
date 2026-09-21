"""Report Design Centre API.

Templates are stored as JSON so the designer can evolve without migrations.
Two endpoints matter most:

* ``GET /report-templates/catalog`` gives the frontend the block palette, the
  paper sizes and the default layout — everything the designer UI needs.
* ``GET /report-templates/print-data/sales-order/{id}`` returns the template
  plus every value the A4 page renders, including serial numbers and the
  discount breakdown, so the print view needs exactly one request.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.product_unit import ProductUnit
from app.models.sales_order import SalesOrder
from app.models.settings import Setting
from app.models.user import User
from app.models.warehouse import ReportTemplate
from app.permissions import Permissions
from app.services.audit import AuditService
from app.services.pricing import discount_breakdown
from app.services.reporting import (
    BLOCK_CATALOG,
    DOC_TYPES,
    PAPER_SPECS,
    default_template_config,
    normalise_config,
    parse_config,
)

router = APIRouter(prefix="/api/report-templates", tags=["report-templates"])

COMPANY_SETTING_KEYS = [
    "company_name", "company_address", "company_phone", "company_email",
    "company_reg_no", "company_logo_url", "company_bank_details", "company_terms",
]


async def _company_profile(db: AsyncSession) -> dict:
    result = await db.execute(select(Setting).where(Setting.key.in_(COMPANY_SETTING_KEYS)))
    profile = {key: "" for key in COMPANY_SETTING_KEYS}
    for setting in result.scalars().all():
        value = setting.value_json
        if isinstance(value, dict):
            profile[setting.key] = value.get("value", "")
        else:
            profile[setting.key] = value
    return profile


def _template_payload(template: ReportTemplate, include_config: bool = True) -> dict:
    payload = {
        "id": template.id,
        "name": template.name,
        "doc_type": template.doc_type,
        "paper_size": template.paper_size,
        "orientation": template.orientation,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "notes": template.notes,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }
    if include_config:
        payload["config"] = parse_config(template.config_json)
    return payload


@router.get("/catalog")
async def template_catalog(
    current_user: User = Depends(get_current_user),
):
    """Everything the designer UI needs to render its palette and previews."""
    return {
        "block_catalog": BLOCK_CATALOG,
        "doc_types": DOC_TYPES,
        "paper_specs": PAPER_SPECS,
        "default_configs": {entry["key"]: default_template_config(entry["key"]) for entry in DOC_TYPES},
    }


@router.get("")
async def list_templates(
    doc_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(ReportTemplate).where(ReportTemplate.is_active == True)
    if doc_type:
        query = query.where(ReportTemplate.doc_type == doc_type)
    query = query.order_by(ReportTemplate.doc_type, ReportTemplate.is_default.desc(), ReportTemplate.name)
    result = await db.execute(query)
    return [_template_payload(t, include_config=False) for t in result.scalars().all()]


@router.get("/default/{doc_type}")
async def get_default_template(
    doc_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc_type = doc_type.upper()
    result = await db.execute(
        select(ReportTemplate)
        .where(ReportTemplate.doc_type == doc_type, ReportTemplate.is_active == True)
        .order_by(ReportTemplate.is_default.desc(), ReportTemplate.id)
        .limit(1)
    )
    template = result.scalars().first()
    if template:
        return _template_payload(template)
    # Fall back to the built-in layout so printing never breaks.
    return {
        "id": None,
        "name": f"Built-in {doc_type}",
        "doc_type": doc_type,
        "paper_size": "A4",
        "orientation": "portrait",
        "is_default": True,
        "is_active": True,
        "config": default_template_config(doc_type),
    }


@router.get("/print-data/sales-order/{order_id}")
async def sales_order_print_data(
    order_id: int,
    template_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Template + every value needed to draw one sales order on A4."""
    result = await db.execute(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.items),
            selectinload(SalesOrder.salesman),
            selectinload(SalesOrder.customer),
        )
        .where(SalesOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    view_all = current_user.role in [
        "IT_ADMIN", "INSIDE_SALES", "DEVELOPER", "MANAGER",
        "DIRECTOR", "OPERATIONS_MANAGER", "PURCHASE_MANAGER",
    ]
    if not view_all and order.salesman_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    if template_id:
        template = await db.get(ReportTemplate, template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
    else:
        default_result = await db.execute(
            select(ReportTemplate)
            .where(ReportTemplate.doc_type == "SALES_ORDER", ReportTemplate.is_active == True)
            .order_by(ReportTemplate.is_default.desc(), ReportTemplate.id)
            .limit(1)
        )
        template = default_result.scalars().first()

    config = (
        parse_config(template.config_json)
        if template
        else default_template_config("SALES_ORDER")
    )

    # Serial numbers / warranty for any tracked units on this order.
    units_result = await db.execute(
        select(ProductUnit).where(ProductUnit.order_id == order.id).order_by(ProductUnit.id)
    )
    serials = [
        {
            "product_id": unit.product_id,
            "product_name": unit.product.name if unit.product else None,
            "serial_number": unit.serial_number,
            "barcode": unit.barcode,
            "status": unit.status,
            "warehouse_location": unit.warehouse_location,
            "warranty_months": unit.warranty_months,
            "warranty_start": unit.warranty_start.isoformat() if unit.warranty_start else None,
            "warranty_end": unit.warranty_end.isoformat() if unit.warranty_end else None,
        }
        for unit in units_result.scalars().all()
    ]

    priced_lines = [
        {
            "product_name_snapshot": item.product_name_snapshot,
            "product_code_snapshot": item.product_code_snapshot,
            "quantity": item.quantity,
            "unit_price": float(item.unit_price or 0),
            "discount_type": item.discount_type or "NONE",
            "discount_value": float(item.discount_value or 0),
            "gross": float(item.gross_amount or 0),
            "discount": float(item.discount_amount or 0),
            "net": float(
                (item.gross_amount or 0) - (item.discount_amount or 0) - (item.order_discount_share or 0)
            ),
        }
        for item in order.items
    ]

    return {
        "template": {
            "id": template.id if template else None,
            "name": template.name if template else f"Built-in SALES_ORDER",
            "doc_type": "SALES_ORDER",
            "paper_size": template.paper_size if template else "A4",
            "orientation": template.orientation if template else "portrait",
            "config": config,
        },
        "company": await _company_profile(db),
        "order": {
            "id": order.id,
            "order_number": order.order_number,
            "status": order.status,
            "order_date": order.order_date.isoformat() if order.order_date else None,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "submitted_at": order.submitted_at.isoformat() if order.submitted_at else None,
            "reviewed_at": order.reviewed_at.isoformat() if order.reviewed_at else None,
            "keyed_to_obm_at": order.keyed_to_obm_at.isoformat() if order.keyed_to_obm_at else None,
            "currency": order.currency,
            "notes": order.notes,
            "obm_reference_number": order.obm_reference_number,
            "customer": {
                "id": order.customer.id,
                "name": order.customer.name,
                "code": order.customer.code,
                "phone": order.customer.phone,
                "address": order.customer.address,
                "email": order.customer.email,
            } if order.customer else None,
            "salesman": order.salesman.full_name if order.salesman else None,
            "delivery_address_snapshot": order.delivery_address_snapshot,
            "delivery_address": order.delivery_address,
            "contact_snapshot": order.contact_snapshot,
            "totals": {
                "gross_subtotal": float(order.gross_subtotal or 0),
                "line_discount_total": float(order.line_discount_total or 0),
                "subtotal": float(order.subtotal_amount or 0),
                "order_discount": float(order.order_discount_amount or 0),
                "discount_total": float(order.discount_total or 0),
                "tax": float(order.tax_amount or 0),
                "total": float(order.total_amount or 0),
                "discount_type": order.discount_type or "NONE",
                "discount_value": float(order.discount_value or 0),
                "discount_reason": order.discount_reason,
                "discount_requires_approval": bool(order.discount_requires_approval),
            },
            "items": [
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "product_name": item.product_name_snapshot,
                    "product_code": item.product_code_snapshot,
                    "quantity": item.quantity,
                    "unit_price": float(item.unit_price or 0),
                    "gross": float(item.gross_amount or 0),
                    "discount_type": item.discount_type or "NONE",
                    "discount_value": float(item.discount_value or 0),
                    "discount": float(item.discount_amount or 0),
                    "order_discount_share": float(item.order_discount_share or 0),
                    "tax": float(item.tax_amount or 0),
                    "line_total": float(item.line_total or 0),
                    "notes": item.notes,
                }
                for item in order.items
            ],
        },
        "discounts": discount_breakdown({"lines": priced_lines}),
        "serials": serials,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{template_id}")
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return _template_payload(template)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    doc_type = str(body.get("doc_type") or "SALES_ORDER").upper()

    config = normalise_config(body.get("config"), doc_type)
    template = ReportTemplate(
        name=name[:120],
        doc_type=doc_type,
        paper_size=str(body.get("paper_size") or config["paper"]["size"]).upper(),
        orientation=str(body.get("orientation") or config["paper"]["orientation"]).lower(),
        config_json=json.dumps(config),
        is_default=bool(body.get("is_default", False)),
        notes=(str(body["notes"])[:255] if body.get("notes") else None),
        created_by=current_user.id,
    )
    db.add(template)
    await db.flush()

    if template.is_default:
        await _clear_other_defaults(db, doc_type, template.id)

    await AuditService.log(
        db=db, action="report_template.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="report_template", entity_id=template.id, entity_label=template.name,
        new_values={"doc_type": doc_type, "is_default": template.is_default},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _template_payload(template)


@router.put("/{template_id}")
async def update_template(
    template_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    old_name = template.name

    if body.get("name"):
        template.name = str(body["name"])[:120]
    if body.get("doc_type"):
        template.doc_type = str(body["doc_type"]).upper()
    if body.get("config") is not None:
        config = normalise_config(body["config"], template.doc_type)
        template.config_json = json.dumps(config)
        template.paper_size = config["paper"]["size"]
        template.orientation = config["paper"]["orientation"]
    if body.get("paper_size"):
        template.paper_size = str(body["paper_size"]).upper()
    if body.get("orientation"):
        template.orientation = str(body["orientation"]).lower()
    if body.get("notes") is not None:
        template.notes = str(body["notes"])[:255] if body["notes"] else None
    if "is_default" in body:
        template.is_default = bool(body["is_default"])
        if template.is_default:
            await _clear_other_defaults(db, template.doc_type, template.id)
    if "is_active" in body:
        template.is_active = bool(body["is_active"])

    await AuditService.log(
        db=db, action="report_template.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="report_template", entity_id=template.id, entity_label=template.name,
        old_values={"name": old_name},
        new_values={"name": template.name, "is_default": template.is_default},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _template_payload(template)


@router.post("/{template_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    copy = ReportTemplate(
        name=f"{template.name} (copy)"[:120],
        doc_type=template.doc_type,
        paper_size=template.paper_size,
        orientation=template.orientation,
        config_json=template.config_json,
        is_default=False,
        is_active=True,
        notes=template.notes,
        created_by=current_user.id,
    )
    db.add(copy)
    await db.flush()
    await db.commit()
    return _template_payload(copy)


@router.post("/{template_id}/set-default")
async def set_default_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await _clear_other_defaults(db, template.doc_type, template.id)
    template.is_default = True

    await AuditService.log(
        db=db, action="report_template.set_default",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="report_template", entity_id=template.id, entity_label=template.name,
        new_values={"doc_type": template.doc_type},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"message": f"{template.name} is now the default {template.doc_type} layout"}


@router.post("/reset-defaults")
async def reset_template_defaults(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    """Recreate the built-in A4 layouts for every document type."""
    created = 0
    for entry in DOC_TYPES:
        existing = await db.execute(
            select(ReportTemplate).where(ReportTemplate.doc_type == entry["key"])
        )
        if existing.scalars().first():
            continue
        db.add(ReportTemplate(
            name=f"Default {entry['label']} (A4)",
            doc_type=entry["key"],
            paper_size="A4",
            orientation="portrait",
            config_json=json.dumps(default_template_config(entry["key"])),
            is_default=True,
            is_active=True,
            created_by=current_user.id,
        ))
        created += 1

    await AuditService.log(
        db=db, action="report_template.reset_defaults",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="report_template", entity_id=0, entity_label="reset",
        new_values={"created": created},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"message": f"Created {created} default layout(s)"}


@router.delete("/{template_id}")
async def delete_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.REPORT_DESIGN_MANAGE)),
):
    template = await db.get(ReportTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.is_default:
        raise HTTPException(
            status_code=400,
            detail="This is the default layout. Set another template as default first.",
        )

    template.is_active = False
    await AuditService.log(
        db=db, action="report_template.delete",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="report_template", entity_id=template.id, entity_label=template.name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"message": f"{template.name} removed"}


async def _clear_other_defaults(db: AsyncSession, doc_type: str, keep_id: int):
    await db.execute(
        update(ReportTemplate)
        .where(ReportTemplate.doc_type == doc_type, ReportTemplate.id != keep_id)
        .values(is_default=False)
    )
