from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.location_log import LocationLog
from app.models.user import User
from app.permissions import Permissions

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

VALID_SOURCES = {"APP_OPEN", "ORDER_CREATE", "ORDER_VIEW", "CHECK_IN", "CUSTOMER_CHECK_IN", "HEARTBEAT"}


@router.post("/location", status_code=status.HTTP_201_CREATED)
async def record_location(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    latitude = body.get("latitude")
    longitude = body.get("longitude")
    accuracy = body.get("accuracy")
    source = body.get("source", "APP_OPEN")
    order_id = body.get("order_id")
    customer_id = body.get("customer_id")

    if latitude is None or longitude is None:
        raise HTTPException(status_code=400, detail="latitude and longitude are required")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    if latitude < -90 or latitude > 90:
        raise HTTPException(status_code=400, detail="latitude must be between -90 and 90")
    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="longitude must be between -180 and 180")
    if source not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of: {VALID_SOURCES}")

    log = LocationLog(
        user_id=current_user.id,
        latitude=latitude,
        longitude=longitude,
        accuracy=accuracy,
        source=source,
        order_id=order_id,
        customer_id=customer_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(log)
    await db.commit()

    return {"message": "Location recorded", "id": log.id}


@router.get("/visits/today")
async def get_customer_visits_today(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_VIEW_ALL)),
):
    if current_user.role not in ["IT_ADMIN", "DEVELOPER", "MANAGER"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    from app.models.customer import Customer
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(LocationLog)
        .where(
            LocationLog.source == "CUSTOMER_CHECK_IN",
            LocationLog.created_at >= start_of_day,
        )
        .order_by(desc(LocationLog.created_at))
        .limit(200)
    )
    logs = result.scalars().all()

    user_ids = {log.user_id for log in logs}
    customer_ids = {log.customer_id for log in logs if log.customer_id}
    users_result = await db.execute(select(User).where(User.id.in_(user_ids))) if user_ids else None
    users = {u.id: u for u in users_result.scalars().all()} if users_result else {}
    customers_result = await db.execute(select(Customer).where(Customer.id.in_(customer_ids))) if customer_ids else None
    customers = {c.id: c for c in customers_result.scalars().all()} if customers_result else {}

    return {
        "visits": [
            {
                "id": log.id,
                "salesman_name": users[log.user_id].full_name if log.user_id in users else "Unknown",
                "customer_name": customers[log.customer_id].name if log.customer_id in customers else "Unknown",
                "customer_id": log.customer_id,
                "latitude": log.latitude,
                "longitude": log.longitude,
                "accuracy": log.accuracy,
                "visited_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
    }


@router.get("/salesmen")
async def get_salesmen_locations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_VIEW_ALL)),
):
    if current_user.role not in ["IT_ADMIN", "DEVELOPER", "MANAGER"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    salesman_roles = ["OUTSIDE_SALES", "INSIDE_SALES"]
    users_result = await db.execute(
        select(User).where(User.role.in_(salesman_roles), User.is_active == True)
    )
    users = {u.id: u for u in users_result.scalars().all()}

    results = []
    for uid, user in users.items():
        loc_result = await db.execute(
            select(LocationLog)
            .where(LocationLog.user_id == uid)
            .order_by(desc(LocationLog.created_at))
            .limit(1)
        )
        last_loc = loc_result.scalar_one_or_none()

        results.append({
            "user_id": uid,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role,
            "latitude": last_loc.latitude if last_loc else None,
            "longitude": last_loc.longitude if last_loc else None,
            "accuracy": last_loc.accuracy if last_loc else None,
            "source": last_loc.source if last_loc else None,
            "last_seen_at": last_loc.created_at.isoformat() if last_loc else None,
            "is_online": (
                last_loc.created_at > datetime.now(timezone.utc) - timedelta(minutes=10)
                if last_loc else False
            ),
        })

    results.sort(key=lambda x: x["last_seen_at"] or "", reverse=True)
    return {"salesmen": results}


@router.get("/history/{user_id}")
async def get_location_history(
    user_id: int,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SALES_ORDER_VIEW_ALL)),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(LocationLog)
        .where(LocationLog.user_id == user_id, LocationLog.created_at >= since)
        .order_by(desc(LocationLog.created_at))
        .limit(200)
    )
    logs = result.scalars().all()

    return {
        "locations": [
            {
                "id": log.id,
                "latitude": log.latitude,
                "longitude": log.longitude,
                "accuracy": log.accuracy,
                "source": log.source,
                "order_id": log.order_id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": len(logs),
    }


@router.get("/order/{order_id}")
async def get_order_location(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["IT_ADMIN", "DEVELOPER", "MANAGER"]:
        from app.models.sales_order import SalesOrder
        order_result = await db.execute(
            select(SalesOrder).where(
                SalesOrder.id == order_id,
                SalesOrder.salesman_id == current_user.id,
            )
        )
        if not order_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.execute(
        select(LocationLog)
        .where(LocationLog.order_id == order_id, LocationLog.source == "ORDER_CREATE")
        .order_by(desc(LocationLog.created_at))
        .limit(1)
    )
    log = result.scalar_one_or_none()
    if not log:
        return {"latitude": None, "longitude": None, "accuracy": None}

    return {
        "latitude": log.latitude,
        "longitude": log.longitude,
        "accuracy": log.accuracy,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }
