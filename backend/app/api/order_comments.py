from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.comment import OrderComment
from app.models.sales_order import SalesOrder
from app.models.user import User
from app.schemas.sales_order import OrderCommentCreate, OrderCommentResponse

router = APIRouter(prefix="/api/sales-orders", tags=["order-comments"])


@router.get("/{order_id}/comments", response_model=list[OrderCommentResponse])
async def list_comments(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order_result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = order_result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    has_view_all = current_user.role in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]
    if not has_view_all and order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.execute(
        select(OrderComment)
        .where(OrderComment.sales_order_id == order_id)
        .order_by(OrderComment.created_at.asc())
    )
    return [OrderCommentResponse.model_validate(c) for c in result.scalars().all()]


@router.post("/{order_id}/comments", response_model=OrderCommentResponse, status_code=status.HTTP_201_CREATED)
async def add_comment(
    order_id: int,
    body: OrderCommentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order_result = await db.execute(select(SalesOrder).where(SalesOrder.id == order_id))
    order = order_result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    has_view_all = current_user.role in ["IT_ADMIN", "INSIDE_SALES", "DEVELOPER"]
    if not has_view_all and order.salesman_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    comment = OrderComment(
        sales_order_id=order_id,
        author_id=current_user.id,
        message=body.message,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    return OrderCommentResponse.model_validate(comment)
