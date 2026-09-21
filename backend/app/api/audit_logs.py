import csv
import io
from collections import defaultdict
from datetime import datetime, timezone

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
    result_filter: str = Query(None, alias="result"),
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
    if result_filter:
        query = query.where(AuditLog.result == result_filter)
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    count_query = select(func.count()).select_from(query.subquery())
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


@router.get("/{log_id:int}", response_model=AuditLogResponse)
async def get_audit_log(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.AUDIT_VIEW)),
):
    actor_alias = aliased(User)
    query = select(AuditLog, actor_alias.full_name.label("actor_name")).outerjoin(
        actor_alias, AuditLog.actor_user_id == actor_alias.id
    ).where(AuditLog.id == log_id)

    result = await db.execute(query)
    row = result.first()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Audit log not found")

    log, actor_name = row
    log_data = AuditLogResponse.model_validate(log)
    log_data.actor_name = actor_name
    return log_data


@router.get("/timeline")
async def get_timeline(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    action: str = Query(None),
    entity_type: str = Query(None),
    actor_user_id: int = Query(None),
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
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.order_by(AuditLog.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    events = []
    for log, actor_name in rows:
        events.append({
            "id": log.id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "actor_name": actor_name or "System",
            "actor_user_id": log.actor_user_id,
            "actor_role": log.actor_role_at_time,
            "action": log.action,
            "action_prefix": log.action.split(".")[0] if log.action else "",
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "entity_label": log.entity_label,
            "result": log.result,
            "old_values": log.old_values_json,
            "new_values": log.new_values_json,
            "ip_address": log.ip_address,
        })

    groups = _group_timeline_events(events)

    return {
        "items": groups,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }


def _group_timeline_events(events):
    groups = []
    current_group = None

    for event in events:
        if (current_group
            and current_group["entity_type"] == event["entity_type"]
            and current_group["entity_id"] == event["entity_id"]
            and _time_diff_minutes(current_group["last_at"], event["created_at"]) <= 5):
            current_group["events"].append(event)
            current_group["last_at"] = event["created_at"]
        else:
            if current_group:
                groups.append(current_group)
            current_group = {
                "id": f"group-{event['id']}",
                "entity_type": event["entity_type"],
                "entity_id": event["entity_id"],
                "entity_label": event["entity_label"],
                "events": [event],
                "first_at": event["created_at"],
                "last_at": event["created_at"],
                "actor_name": event["actor_name"],
                "collapsed": False,
            }

    if current_group:
        groups.append(current_group)

    return groups


def _time_diff_minutes(t1, t2):
    if not t1 or not t2:
        return 999
    try:
        dt1 = datetime.fromisoformat(t1.replace("Z", "+00:00"))
        dt2 = datetime.fromisoformat(t2.replace("Z", "+00:00"))
        return abs((dt1 - dt2).total_seconds()) / 60
    except (ValueError, TypeError):
        return 999


@router.get("/analytics")
async def get_analytics(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.AUDIT_VIEW)),
):
    from datetime import timedelta
    since = datetime.now(timezone.utc) - timedelta(days=days)

    actor_alias = aliased(User)
    query = select(AuditLog, actor_alias.full_name.label("actor_name")).outerjoin(
        actor_alias, AuditLog.actor_user_id == actor_alias.id
    ).where(AuditLog.created_at >= since).order_by(AuditLog.created_at.desc())

    result = await db.execute(query)
    rows = result.all()

    events_per_day = defaultdict(int)
    by_action = defaultdict(int)
    by_actor = defaultdict(lambda: {"name": "", "count": 0})
    by_entity = defaultdict(int)
    peak_hours = defaultdict(int)

    for log, actor_name in rows:
        if log.created_at:
            day_key = log.created_at.strftime("%Y-%m-%d")
            events_per_day[day_key] += 1
            hour_key = log.created_at.hour
            peak_hours[hour_key] += 1

        prefix = log.action.split(".")[0] if log.action else "unknown"
        by_action[prefix] += 1

        if log.actor_user_id:
            by_actor[log.actor_user_id]["name"] = actor_name or f"User {log.actor_user_id}"
            by_actor[log.actor_user_id]["count"] += 1

        if log.entity_type:
            by_entity[log.entity_type] += 1

    events_per_day_list = [
        {"date": k, "count": v}
        for k, v in sorted(events_per_day.items())
    ]

    by_action_list = [
        {"prefix": k, "count": v}
        for k, v in sorted(by_action.items(), key=lambda x: -x[1])
    ]

    by_actor_list = [
        {"user_id": k, "name": v["name"], "count": v["count"]}
        for k, v in sorted(by_actor.items(), key=lambda x: -x[1]["count"])
    ][:10]

    by_entity_list = [
        {"type": k, "count": v}
        for k, v in sorted(by_entity.items(), key=lambda x: -x[1])
    ]

    peak_hours_list = [
        {"hour": k, "count": v}
        for k, v in sorted(peak_hours.items())
    ]

    return {
        "events_per_day": events_per_day_list,
        "by_action": by_action_list,
        "by_actor": by_actor_list,
        "by_entity": by_entity_list,
        "peak_hours": peak_hours_list,
        "total_events": len(rows),
    }


@router.get("/export")
async def export_audit_logs(
    action: str = Query(None),
    entity_type: str = Query(None),
    actor_user_id: int = Query(None),
    result_filter: str = Query(None, alias="result"),
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
    if result_filter:
        query = query.where(AuditLog.result == result_filter)
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    query = query.order_by(AuditLog.created_at.desc())
    result = await db.execute(query)
    logs = result.scalars().all()

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
        headers={"Content-Disposition": f"attachment; filename=audit_logs_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"},
    )
