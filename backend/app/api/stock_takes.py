"""Stock take sessions — counting the shelf against the system.

Split deliberately:

* **Running the count** (`STOCK_TAKE_RUN`) is floor work — a store keeper scans.
* **Starting and posting a session** (`STOCK_TAKE_MANAGE`) writes inventory off.
  That is a financial event, so it is not the counter's call.

Posting requires a reason whenever there are differences, because "3 rods
vanished" needs a sentence attached to it.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_any_permission, require_permission
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.user import User
from app.models.warehouse import (
    StockLocation,
    StockTakeCount,
    StockTakeScope,
    StockTakeSession,
    StockTakeStatus,
)
from app.permissions import Permissions
from app.services.audit import AuditService
from app.services.stock_take import (
    apply_line_variance,
    build_session_lines,
    clear_session_marks,
    generate_session_number,
    load_session,
    refresh_session_counters,
)

router = APIRouter(prefix="/api/warehouse/stock-takes", tags=["stock-takes"])

STOCK_TAKE_READ = (
    Permissions.STOCK_TAKE_RUN,
    Permissions.STOCK_TAKE_MANAGE,
    Permissions.STOCK_MOVEMENTS_VIEW,
)


def _count_payload(count: StockTakeCount) -> dict:
    return {
        "id": count.id,
        "product_id": count.product_id,
        "product_name": count.product.name if count.product else None,
        "product_code": count.product.item_code if count.product else None,
        "tracking_mode": count.tracking_mode,
        "expected_qty": count.expected_qty,
        "counted_qty": count.counted_qty,
        "variance": count.variance,
        "notes": count.notes,
        "counted_at": count.counted_at.isoformat() if count.counted_at else None,
        "adjustment_id": count.adjustment_id,
    }


def _session_payload(session: StockTakeSession, include_counts: bool = True) -> dict:
    payload = {
        "id": session.id,
        "session_number": session.session_number,
        "status": session.status,
        "scope": session.scope,
        "location_id": session.location_id,
        "location_name": session.location.name if session.location else None,
        "product_id": session.product_id,
        "notes": session.notes,
        "instructions": session.instructions,
        "completion_notes": session.completion_notes,
        "total_lines": session.total_lines,
        "counted_lines": session.counted_lines,
        "variance_lines": session.variance_lines,
        "net_variance": session.net_variance,
        "started_by_name": session.starter.full_name if session.starter else None,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "progress_percent": (
            round(100 * session.counted_lines / session.total_lines) if session.total_lines else 0
        ),
    }
    if include_counts:
        payload["counts"] = [_count_payload(count) for count in session.counts]
    return payload


async def _get_session(db: AsyncSession, session_id: int) -> StockTakeSession:
    session = await load_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Stock take not found")
    return session


async def _require_open(session: StockTakeSession) -> None:
    if session.status == StockTakeStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="This stock take has already been posted")
    if session.status == StockTakeStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="This stock take was cancelled")


@router.post("", status_code=status.HTTP_201_CREATED)
async def start_stock_take(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_TAKE_MANAGE)),
):
    """Open a session and freeze what the system currently believes.

    Body::

        {"scope": "LOCATION" | "PRODUCT" | "ALL",
         "location_id": int?, "product_id": int?, "notes": str?, "instructions": str?}
    """
    scope = str(body.get("scope") or StockTakeScope.LOCATION).upper()
    if scope not in StockTakeScope.ALL_SCOPES:
        raise HTTPException(status_code=400, detail=f"Unknown scope {scope}")

    location_id = body.get("location_id")
    product_id = body.get("product_id")

    if scope == StockTakeScope.LOCATION:
        if not location_id:
            raise HTTPException(status_code=400, detail="A location-scoped count needs a location")
        if not await db.get(StockLocation, int(location_id)):
            raise HTTPException(status_code=404, detail="Location not found")
    if scope == StockTakeScope.PRODUCT:
        if not product_id:
            raise HTTPException(status_code=400, detail="A product-scoped count needs a product")
        if not await db.get(Product, int(product_id)):
            raise HTTPException(status_code=404, detail="Product not found")

    session = StockTakeSession(
        session_number=generate_session_number(),
        status=StockTakeStatus.IN_PROGRESS,
        scope=scope,
        location_id=int(location_id) if location_id else None,
        product_id=int(product_id) if product_id else None,
        notes=body.get("notes"),
        instructions=body.get("instructions"),
        started_by=current_user.id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.flush()

    created = await build_session_lines(db, session)

    await AuditService.log(
        db=db, action="stock_take.start",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_take_session", entity_id=session.id, entity_label=session.session_number,
        new_values={"scope": scope, "location_id": session.location_id, "lines": created},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _session_payload(await _get_session(db, session.id))


@router.get("")
async def list_stock_takes(
    status_filter: str | None = Query(None, alias="status"),
    open_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*STOCK_TAKE_READ)),
):
    query = select(StockTakeSession).order_by(StockTakeSession.started_at.desc())
    if status_filter:
        query = query.where(StockTakeSession.status == status_filter.upper())
    if open_only:
        query = query.where(StockTakeSession.status.in_(StockTakeStatus.OPEN))
    result = await db.execute(query.limit(100))
    return [_session_payload(session, include_counts=False) for session in result.scalars().unique().all()]


@router.get("/{session_id}")
async def get_stock_take(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*STOCK_TAKE_READ)),
):
    return _session_payload(await _get_session(db, session_id))


@router.post("/{session_id}/scan")
async def scan_into_stock_take(
    session_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_TAKE_RUN)),
):
    """Record a scanned unit as present.

    Scanning the same rod twice is harmless — it is already recorded as present,
    which is the point of a stock take.
    """
    session = await _get_session(db, session_id)
    await _require_open(session)

    code = str(body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    result = await db.execute(
        select(ProductUnit)
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
        return {
            "result": "UNKNOWN",
            "message": f"No unit matches {code}. If this is a new product, raise a new-item request.",
        }

    count = next((c for c in session.counts if c.product_id == unit.product_id), None)
    if count is None:
        return {
            "result": "NOT_IN_SCOPE",
            "message": (
                f"{unit.serial_number} belongs to a product that is not part of this count."
            ),
            "product_id": unit.product_id,
        }

    if unit.stock_take_session_id == session.id:
        return {
            "result": "ALREADY_COUNTED",
            "message": f"{unit.serial_number} was already counted.",
            "counted_qty": count.counted_qty,
            "expected_qty": count.expected_qty,
        }

    unit.stock_take_session_id = session.id
    unit.stock_take_counted_at = datetime.now(timezone.utc)
    # A scan during a location-scoped count also asserts "this rod is here",
    # which is worth recording — it is how a misplaced rod gets found.
    unit.location_id = session.location_id or unit.location_id

    # For a serialized line the counted quantity is simply how many units have
    # been scanned into this session.
    scanned_total = await db.scalar(
        select(func.count())
        .select_from(ProductUnit)
        .where(
            ProductUnit.product_id == unit.product_id,
            ProductUnit.stock_take_session_id == session.id,
        )
    )
    count.counted_qty = int(scanned_total or 0)
    count.variance = (count.counted_qty or 0) - count.expected_qty
    count.counted_by = current_user.id
    count.counted_at = datetime.now(timezone.utc)

    await refresh_session_counters(db, session)
    await db.commit()

    return {
        "result": "OK",
        "message": f"{unit.serial_number} counted.",
        "product_id": unit.product_id,
        "counted_qty": count.counted_qty,
        "expected_qty": count.expected_qty,
        "variance": count.variance,
    }


@router.post("/{session_id}/lines/{line_id}/quantity")
async def set_stock_take_quantity(
    session_id: int,
    line_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_TAKE_RUN)),
):
    """Set the counted quantity for a bulk line (keyboard entry)."""
    session = await _get_session(db, session_id)
    await _require_open(session)

    count = next((c for c in session.counts if c.id == line_id), None)
    if count is None:
        raise HTTPException(status_code=404, detail="Count line not found")
    if (count.tracking_mode or "BULK").upper() == "SERIALIZED":
        raise HTTPException(
            status_code=400,
            detail="Serialized lines are counted by scanning, not by typing a quantity",
        )

    try:
        quantity = int(body.get("quantity"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="quantity must be a whole number")
    if quantity < 0:
        raise HTTPException(status_code=400, detail="quantity cannot be negative")

    count.counted_qty = quantity
    count.variance = quantity - count.expected_qty
    count.notes = body.get("notes") if body.get("notes") is not None else count.notes
    count.counted_by = current_user.id
    count.counted_at = datetime.now(timezone.utc)

    await refresh_session_counters(db, session)
    await db.commit()
    return _count_payload(count)


@router.post("/{session_id}/complete")
async def complete_stock_take(
    session_id: int,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_TAKE_MANAGE)),
):
    """Post every difference as a documented adjustment.

    Body: ``{"completion_notes": str}`` — required when anything differs, because
    writing inventory off without a reason is how stock problems stay unfixable.
    """
    body = body or {}
    session = await _get_session(db, session_id)
    await _require_open(session)

    completion_notes = str(body.get("completion_notes") or "").strip()
    uncounted = [count for count in session.counts if count.counted_qty is None]
    varying = [count for count in session.counts if count.variance not in (None, 0)]

    if varying and not completion_notes:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "REASON_REQUIRED",
                "message": (
                    f"{len(varying)} line(s) differ from the system. Say why before posting — "
                    "this writes inventory off."
                ),
            },
        )

    applied: list[dict] = []
    net = 0
    for count in varying:
        report = await apply_line_variance(db, session, count, current_user)
        if report.get("applied"):
            net += int(report.get("delta") or 0)
        applied.append(report)

    session.net_variance = net
    session.variance_lines = len(varying)
    session.counted_lines = len([c for c in session.counts if c.counted_qty is not None])
    session.completion_notes = completion_notes or None
    session.status = StockTakeStatus.COMPLETED
    session.completed_by = current_user.id
    session.completed_at = datetime.now(timezone.utc)

    await clear_session_marks(db, session.id)

    await AuditService.log(
        db=db, action="stock_take.complete",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_take_session", entity_id=session.id, entity_label=session.session_number,
        new_values={
            "counted_lines": session.counted_lines,
            "variance_lines": session.variance_lines,
            "net_variance": net,
            "uncounted_lines": len(uncounted),
            "notes": completion_notes,
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    return {
        "session": _session_payload(await _get_session(db, session.id)),
        "applied": applied,
        "net_variance": net,
        "uncounted_lines": len(uncounted),
        "message": (
            f"Posted {len(applied)} adjustment(s), net {net:+d} units."
            + (f" {len(uncounted)} line(s) were never counted." if uncounted else "")
        ),
    }


@router.post("/{session_id}/cancel")
async def cancel_stock_take(
    session_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_TAKE_MANAGE)),
):
    """Abandon a session. Nothing is posted and no stock moves."""
    session = await _get_session(db, session_id)
    if session.status == StockTakeStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="A posted stock take cannot be cancelled")

    await clear_session_marks(db, session.id)
    session.status = StockTakeStatus.CANCELLED
    session.completed_by = current_user.id
    session.completed_at = datetime.now(timezone.utc)

    await AuditService.log(
        db=db, action="stock_take.cancel",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_take_session", entity_id=session.id, entity_label=session.session_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _session_payload(await _get_session(db, session.id))
