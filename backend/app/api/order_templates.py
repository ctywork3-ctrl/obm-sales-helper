from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.order_template import OrderTemplate, OrderTemplateItem
from app.models.user import User
from app.services.audit import AuditService

router = APIRouter(prefix="/api/order-templates", tags=["order-templates"])


@router.get("")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OrderTemplate)
        .options(selectinload(OrderTemplate.items))
        .where(OrderTemplate.salesman_id == current_user.id)
        .order_by(OrderTemplate.name)
    )
    templates = result.scalars().unique().all()
    return [
        {
            "id": t.id, "name": t.name, "customer_id": t.customer_id,
            "notes": t.notes, "currency": t.currency,
            "item_count": len(t.items),
            "items": [
                {
                    "id": item.id, "product_id": item.product_id,
                    "product_name": item.product.name if item.product else None,
                    "product_code": item.product.item_code if item.product else None,
                    "quantity": item.quantity,
                    "unit_price": float(item.unit_price) if item.unit_price else None,
                }
                for item in t.items
            ],
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in templates
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")

    template = OrderTemplate(
        name=name,
        salesman_id=current_user.id,
        customer_id=body.get("customer_id"),
        notes=body.get("notes"),
        currency=body.get("currency", "MYR"),
    )
    db.add(template)
    await db.flush()

    for item_data in body.get("items", []):
        item = OrderTemplateItem(
            template_id=template.id,
            product_id=item_data["product_id"],
            quantity=item_data.get("quantity", 1),
            unit_price=item_data.get("unit_price"),
            notes=item_data.get("notes"),
        )
        db.add(item)

    await db.flush()

    await AuditService.log(
        db=db, action="order_template.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="order_template", entity_id=template.id, entity_label=name,
        new_values={"item_count": len(body.get("items", []))},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"id": template.id, "name": template.name}


@router.delete("/{template_id}")
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(OrderTemplate).where(
            OrderTemplate.id == template_id,
            OrderTemplate.salesman_id == current_user.id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(template)
    await db.commit()
    return {"message": "Template deleted"}
