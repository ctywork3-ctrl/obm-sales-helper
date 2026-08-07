import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.dependencies import require_permission
from app.models.audit_log import AuditLog
from app.models.user import User
from app.permissions import Permissions
from app.schemas.audit_log import AuditLogListResponse, AuditLogResponse

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    action: str = Query(None),
    entity_type: str = Query(None),
    actor_user_id: int = Query(None),
    result: str = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.AUDIT_VIEW)),
):
    actor_alias = aliased(User)
    query = select(AuditLog, actor_alias.full_name.label("actor_name")).outerjoin(
        actor_alias, AuditLog.actor_user_id == actor_alias.id
    )

    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if actor_user_id:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    if result:
        query = query.where(AuditLog.result == result)
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    count_query = select(func.count()).select_from(
        select(AuditLog).subquery()
    )
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(AuditLog.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    items = []
    for log, actor_name in rows:
        log_data = AuditLogResponse.model_validate(log)
        log_data.actor_name = actor_name
        items.append(log_data)

    return AuditLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.get("/export")
async def export_audit_logs(
    action: str = Query(None),
    entity_type: str = Query(None),
    actor_user_id: int = Query(None),
    result: str = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.AUDIT_EXPORT)),
):
    query = select(AuditLog)

    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if actor_user_id:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    if result:
        query = query.where(AuditLog.result == result)
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    query = query.order_by(AuditLog.created_at.desc())
    result_set = await db.execute(query)
    logs = result_set.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Created At", "Request ID", "Actor Type", "Actor User ID",
        "Actor Role", "Action", "Entity Type", "Entity ID", "Entity Label",
        "Result", "IP Address", "Error Message",
    ])

    for log in logs:
        writer.writerow([
            log.id,
            log.created_at.isoformat() if log.created_at else "",
            log.request_id or "",
            log.actor_type or "",
            log.actor_user_id or "",
            log.actor_role_at_time or "",
            log.action,
            log.entity_type or "",
            log.entity_id or "",
            log.entity_label or "",
            log.result or "",
            log.ip_address or "",
            log.error_message or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit_logs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"},
    )
