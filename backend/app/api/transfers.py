"""Stock transfers between locations.

Split like the other warehouse work:

* **Planning a move** (`TRANSFER_CREATE`) is an office decision.
* **Physically moving it** (`TRANSFER_EXECUTE`) is floor work — two people scan,
  one at each end.

The receiver's scan is what relocates a unit. A transfer never changes a
quantity, so it can never be confused with a stock loss.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_any_permission, require_permission
from app.models.product import Product
from app.models.user import User
from app.models.warehouse import (
    StockLocation,
    StockTransfer,
    StockTransferLine,
    StockTransferStatus,
)
from app.permissions import Permissions
from app.services.audit import AuditService
from app.services.transfer import (
    generate_transfer_number,
    load_transfer,
    refresh_counters,
    release_units,
    scan_dispatch,
    scan_receive,
    transfer_report,
    transferable_products,
    units_in_flight,
)

router = APIRouter(prefix="/api/warehouse/transfers", tags=["transfers"])

TRANSFER_READ = (
    Permissions.TRANSFER_CREATE,
    Permissions.TRANSFER_EXECUTE,
    Permissions.STOCK_MOVEMENTS_VIEW,
)


def _line_payload(line: StockTransferLine) -> dict:
    return {
        "id": line.id,
        "product_id": line.product_id,
        "product_name": line.product.name if line.product else None,
        "product_code": (
            (line.product.obm_item_code or line.product.item_code) if line.product else None
        ),
        "tracking_mode": line.tracking_mode,
        "quantity_expected": line.quantity_expected,
        "quantity_dispatched": line.quantity_dispatched,
        "quantity_received": line.quantity_received,
        "notes": line.notes,
    }


def _transfer_payload(transfer: StockTransfer, include_lines: bool = True) -> dict:
    payload = {
        "id": transfer.id,
        "transfer_number": transfer.transfer_number,
        "status": transfer.status,
        "from_location_id": transfer.from_location_id,
        "from_location_name": transfer.from_location.name if transfer.from_location else None,
        "to_location_id": transfer.to_location_id,
        "to_location_name": transfer.to_location.name if transfer.to_location else None,
        "notes": transfer.notes,
        "instructions": transfer.instructions,
        "completion_notes": transfer.completion_notes,
        "total_units": transfer.total_units,
        "dispatched_units": transfer.dispatched_units,
        "received_units": transfer.received_units,
        "created_by_name": transfer.creator.full_name if transfer.creator else None,
        "created_at": transfer.created_at.isoformat() if transfer.created_at else None,
        "dispatched_by_name": transfer.dispatcher.full_name if transfer.dispatcher else None,
        "dispatched_at": transfer.dispatched_at.isoformat() if transfer.dispatched_at else None,
        "received_by_name": transfer.receiver.full_name if transfer.receiver else None,
        "received_at": transfer.received_at.isoformat() if transfer.received_at else None,
    }
    if include_lines:
        payload["lines"] = [_line_payload(line) for line in transfer.lines]
    return payload


async def _get_transfer(db: AsyncSession, transfer_id: int) -> StockTransfer:
    transfer = await load_transfer(db, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return transfer


async def _require_open(transfer: StockTransfer) -> None:
    if transfer.status == StockTransferStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="This transfer is already completed")
    if transfer.status == StockTransferStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="This transfer was cancelled")


@router.get("/transferable")
async def list_transferable(
    from_location_id: int = Query(...),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*TRANSFER_READ)),
):
    """What could actually be sent from a location right now."""
    if not await db.get(StockLocation, from_location_id):
        raise HTTPException(status_code=404, detail="Location not found")
    return await transferable_products(db, from_location_id, search)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transfer(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.TRANSFER_CREATE)),
):
    """Plan a move.

    Body::

        {"from_location_id": int, "to_location_id": int,
         "notes": str?, "instructions": str?,
         "lines": [{"product_id": int, "quantity": int}]}
    """
    from_location_id = body.get("from_location_id")
    to_location_id = body.get("to_location_id")

    if not from_location_id or not to_location_id:
        raise HTTPException(status_code=400, detail="Both locations are required")
    if int(from_location_id) == int(to_location_id):
        raise HTTPException(status_code=400, detail="Source and destination must differ")

    for location_id in (from_location_id, to_location_id):
        if not await db.get(StockLocation, int(location_id)):
            raise HTTPException(status_code=404, detail=f"Location {location_id} not found")

    lines = body.get("lines") or []
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one product to move")

    transfer = StockTransfer(
        transfer_number=generate_transfer_number(),
        status=StockTransferStatus.DRAFT,
        from_location_id=int(from_location_id),
        to_location_id=int(to_location_id),
        notes=body.get("notes"),
        instructions=body.get("instructions"),
        created_by=current_user.id,
    )
    db.add(transfer)
    await db.flush()

    for spec in lines:
        product = await db.get(Product, spec.get("product_id"))
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {spec.get('product_id')} not found")
        if (product.inventory_model or "BULK").upper() != "SERIALIZED":
            # Only serialized goods carry a location, so only they can be moved.
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{product.name} is tracked in bulk and has no location. "
                    "Bulk stock cannot be transferred."
                ),
            )
        try:
            quantity = int(spec.get("quantity") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="quantity must be a whole number")
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="quantity must be greater than zero")

        db.add(StockTransferLine(
            transfer_id=transfer.id,
            product_id=product.id,
            quantity_expected=quantity,
            tracking_mode="SERIALIZED",
            notes=spec.get("notes"),
        ))

    await db.flush()
    await db.refresh(transfer, attribute_names=["lines"])
    refresh_counters(transfer)

    await AuditService.log(
        db=db, action="stock_transfer.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_transfer", entity_id=transfer.id, entity_label=transfer.transfer_number,
        new_values={
            "from_location_id": transfer.from_location_id,
            "to_location_id": transfer.to_location_id,
            "lines": len(lines),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _transfer_payload(await _get_transfer(db, transfer.id))


@router.get("")
async def list_transfers(
    status_filter: str | None = Query(None, alias="status"),
    open_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*TRANSFER_READ)),
):
    query = select(StockTransfer).order_by(StockTransfer.created_at.desc())
    if status_filter:
        query = query.where(StockTransfer.status == status_filter.upper())
    if open_only:
        query = query.where(StockTransfer.status.in_(StockTransferStatus.OPEN))
    result = await db.execute(query.limit(100))
    return [
        _transfer_payload(transfer, include_lines=False)
        for transfer in result.scalars().unique().all()
    ]


@router.get("/{transfer_id}")
async def get_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*TRANSFER_READ)),
):
    transfer = await _get_transfer(db, transfer_id)
    payload = _transfer_payload(transfer)
    payload["report"] = await transfer_report(db, transfer)
    payload["in_flight"] = await units_in_flight(db, transfer.id)
    return payload


@router.post("/{transfer_id}/scan")
async def scan_transfer(
    transfer_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.TRANSFER_EXECUTE)),
):
    """Scan a unit out of the source, or into the destination.

    Body: ``{"code": str, "phase": "DISPATCH" | "RECEIVE"}``

    Receiving is the scan that actually relocates the unit.
    """
    transfer = await _get_transfer(db, transfer_id)
    await _require_open(transfer)

    phase = str(body.get("phase") or "DISPATCH").upper()
    if phase not in ("DISPATCH", "RECEIVE"):
        raise HTTPException(status_code=400, detail="phase must be DISPATCH or RECEIVE")

    if phase == "RECEIVE" and transfer.status != StockTransferStatus.IN_TRANSIT:
        raise HTTPException(
            status_code=400,
            detail="Dispatch the transfer before receiving it",
        )

    code = str(body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    if phase == "DISPATCH":
        result = await scan_dispatch(db, transfer, code)
    else:
        result = await scan_receive(db, transfer, code)

    await db.commit()
    result["transfer"] = _transfer_payload(await _get_transfer(db, transfer_id), include_lines=False)
    return result


@router.post("/{transfer_id}/dispatch")
async def dispatch_transfer(
    transfer_id: int,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.TRANSFER_EXECUTE)),
):
    """Mark the goods as on their way. Requires at least one unit scanned out."""
    body = body or {}
    transfer = await _get_transfer(db, transfer_id)
    await _require_open(transfer)

    if transfer.status == StockTransferStatus.IN_TRANSIT:
        raise HTTPException(status_code=400, detail="This transfer is already in transit")
    if transfer.dispatched_units == 0:
        raise HTTPException(
            status_code=400,
            detail="Scan the units leaving the source location first",
        )

    transfer.status = StockTransferStatus.IN_TRANSIT
    transfer.dispatched_by = current_user.id
    transfer.dispatched_at = datetime.now(timezone.utc)
    if body.get("notes"):
        transfer.notes = f"{transfer.notes or ''}\n{body['notes']}".strip()

    await AuditService.log(
        db=db, action="stock_transfer.dispatch",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_transfer", entity_id=transfer.id, entity_label=transfer.transfer_number,
        new_values={"dispatched_units": transfer.dispatched_units, "of": transfer.total_units},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _transfer_payload(await _get_transfer(db, transfer.id))


@router.post("/{transfer_id}/complete")
async def complete_transfer(
    transfer_id: int,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.TRANSFER_EXECUTE)),
):
    """Close the transfer. Anything not received stays where it was."""
    body = body or {}
    transfer = await _get_transfer(db, transfer_id)
    await _require_open(transfer)

    if transfer.status != StockTransferStatus.IN_TRANSIT:
        raise HTTPException(status_code=400, detail="Dispatch the transfer first")

    in_flight = transfer.dispatched_units - transfer.received_units
    completion_notes = str(body.get("completion_notes") or "").strip()

    if in_flight > 0 and not completion_notes:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "IN_FLIGHT_UNCONFIRMED",
                "message": (
                    f"{in_flight} unit(s) were sent but never confirmed as arrived. "
                    "They are still recorded at the source. Say what happened before closing."
                ),
                "in_flight": in_flight,
            },
        )

    # Anything never received is released so it can be moved again later, and it
    # stays at the source location — which is where it physically is.
    released = await release_units(db, transfer.id)

    transfer.status = StockTransferStatus.COMPLETED
    transfer.received_by = current_user.id
    transfer.received_at = datetime.now(timezone.utc)
    transfer.completion_notes = completion_notes or None

    await AuditService.log(
        db=db, action="stock_transfer.complete",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_transfer", entity_id=transfer.id, entity_label=transfer.transfer_number,
        new_values={
            "received_units": transfer.received_units,
            "dispatched_units": transfer.dispatched_units,
            "of": transfer.total_units,
            "released_unconfirmed": released,
            "notes": completion_notes,
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    return {
        "transfer": _transfer_payload(await _get_transfer(db, transfer.id)),
        "received_units": transfer.received_units,
        "in_flight_released": released,
        "message": (
            f"{transfer.received_units} of {transfer.total_units} unit(s) moved to "
            f"{transfer.to_location.name if transfer.to_location else 'the destination'}."
            + (f" {released} unit(s) never confirmed and stayed put." if released else "")
        ),
    }


@router.post("/{transfer_id}/cancel")
async def cancel_transfer(
    transfer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.TRANSFER_CREATE)),
):
    """Abandon a transfer. Nothing moved, so nothing changes."""
    transfer = await _get_transfer(db, transfer_id)
    if transfer.status == StockTransferStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="A completed transfer cannot be cancelled")

    released = await release_units(db, transfer.id)
    transfer.status = StockTransferStatus.CANCELLED
    transfer.completion_notes = transfer.completion_notes or "Cancelled"

    await AuditService.log(
        db=db, action="stock_transfer.cancel",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_transfer", entity_id=transfer.id, entity_label=transfer.transfer_number,
        new_values={"released_units": released},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _transfer_payload(await _get_transfer(db, transfer.id))
