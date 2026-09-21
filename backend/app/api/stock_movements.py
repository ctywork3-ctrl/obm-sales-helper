from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.permissions import Permissions

router = APIRouter(prefix="/api/stock-movements", tags=["stock-movements"])


@router.get("")
async def list_movements(
    product_id: int = Query(None),
    movement_type: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_MOVEMENTS_VIEW)),
):
    query = select(StockMovement)
    if product_id:
        query = query.where(StockMovement.product_id == product_id)
    if movement_type:
        query = query.where(StockMovement.movement_type == movement_type)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(StockMovement.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    movements = result.scalars().all()

    return {
        "items": [
            {
                "id": m.id,
                "product_id": m.product_id,
                "quantity_delta": m.quantity_delta,
                "movement_type": m.movement_type,
                "source_type": m.source_type,
                "source_id": m.source_id,
                "idempotency_key": m.idempotency_key,
                "reason": m.reason,
                "performed_by": m.performed_by,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in movements
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }
