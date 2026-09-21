"""Warehouse operations: receiving tasks, phone scanning, stock overview and
the warranty trail.

The task flow exists so a purchase manager can hand a delivery to a worker
("PO-20260916-AB has arrived, go count it") and the worker can do the whole
count on a phone: scan each barcode, and the serial numbers land in the
system without anyone typing. Stock only moves when the task is completed,
so a half-finished count never corrupts inventory.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_any_permission, require_permission
from app.models.inventory_receipt import InventoryReceipt, InventoryReceiptLine
from app.models.master_data import normalize_supplier_name
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.models.settings import Setting
from app.models.user import User
from app.models.warehouse import (
    ReceivingDiscrepancy,
    ReceivingDiscrepancyStatus,
    ReceivingTask,
    ReceivingTaskLine,
    ReceivingTaskScan,
    ReceivingTaskStatus,
    StockLocation,
    WarrantyClaim,
    WarrantyClaimStatus,
)
from app.permissions import ROLE_PERMISSIONS, Permissions
from app.services.audit import AuditService
from app.services.receiving import (
    NoOutstandingLines,
    create_tasks_from_po,
    generate_task_number,
    load_po_for_receiving,
    notify_task_assignee,
    open_tasks_for_po,
    outstanding_lines_for_po,
    parse_due_date,
)
from app.services.stock import receive_stock, recompute_serialized_stock

router = APIRouter(prefix="/api/warehouse", tags=["warehouse"])

# A unit that has been counted but whose receipt has not been posted yet.
UNIT_PENDING = "PENDING"
DEFAULT_WARRANTY_MONTHS = 12


async def _resolve_supplier_id(db: AsyncSession, supplier_name: str | None) -> int | None:
    """Match a free-text supplier name to a supplier master row.

    This is the bridge that lets old free-text data keep working. It matches on
    the NORMALIZED name, so "Mismatch Supplier", "mismatch supplier" and
    " Mismatch  Supplier " all resolve to the same vendor.

    Returns None rather than inventing a supplier: creating master data silently
    as a side effect of receiving goods is how a supplier list ends up full of
    typos. Unknown names are picked up deliberately, by the master-data screen or
    the v6 migration's backfill.
    """
    normalized = normalize_supplier_name(supplier_name)
    if not normalized:
        return None
    from app.models.master_data import Supplier

    result = await db.execute(select(Supplier.id).where(Supplier.normalized_name == normalized))
    return result.scalar_one_or_none()


# --- helpers ---------------------------------------------------------------


def _receipt_number() -> str:
    return f"GRN-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


def _claim_number() -> str:
    return f"WC-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


def _iso(value) -> str | None:
    return value.isoformat() if value else None


async def _default_warranty_months(db: AsyncSession) -> int:
    result = await db.execute(select(Setting).where(Setting.key == "default_warranty_months"))
    setting = result.scalar_one_or_none()
    if setting and isinstance(setting.value_json, dict):
        try:
            return int(setting.value_json.get("value", DEFAULT_WARRANTY_MONTHS))
        except (TypeError, ValueError):
            pass
    return DEFAULT_WARRANTY_MONTHS


async def _load_task(db: AsyncSession, task_id: int) -> ReceivingTask:
    result = await db.execute(
        select(ReceivingTask)
        .options(
            selectinload(ReceivingTask.lines).selectinload(ReceivingTaskLine.product),
            selectinload(ReceivingTask.lines).selectinload(ReceivingTaskLine.units),
            selectinload(ReceivingTask.assignee),
            selectinload(ReceivingTask.assigner),
            selectinload(ReceivingTask.location),
            selectinload(ReceivingTask.purchase_order),
        )
        .where(ReceivingTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Receiving task not found")
    return task


def _line_payload(line: ReceivingTaskLine) -> dict:
    units = sorted(line.units or [], key=lambda u: u.id or 0)
    return {
        "id": line.id,
        "product_id": line.product_id,
        "product_name": line.product.name if line.product else None,
        "product_code": (line.product.item_code if line.product else None),
        "obm_item_code": (line.product.obm_item_code if line.product else None),
        "quantity_expected": line.quantity_expected,
        "quantity_scanned": line.quantity_scanned,
        "quantity_rejected": line.quantity_rejected,
        "quantity_outstanding": max(0, line.quantity_expected - line.quantity_scanned),
        "unit_cost": float(line.unit_cost) if line.unit_cost is not None else None,
        "tracking_mode": line.tracking_mode,
        "notes": line.notes,
        "units": [
            {
                "id": u.id,
                "serial_number": u.serial_number,
                "barcode": u.barcode,
                "unit_code": u.unit_code,
                "manufacturer_serial": u.manufacturer_serial,
                "status": u.status,
                "condition": u.condition,
                "warehouse_location": u.warehouse_location,
                "warranty_months": u.warranty_months,
            }
            for u in units
        ],
    }


def _task_payload(task: ReceivingTask, include_lines: bool = True) -> dict:
    payload = {
        "id": task.id,
        "task_number": task.task_number,
        "purchase_order_id": task.purchase_order_id,
        "po_number": task.purchase_order.po_number if task.purchase_order else None,
        "supplier_name": task.supplier_name,
        "status": task.status,
        "priority": task.priority,
        "assigned_to": task.assigned_to,
        "assigned_to_name": task.assignee.full_name if task.assignee else None,
        "assigned_by_name": task.assigner.full_name if task.assigner else None,
        "assigned_at": _iso(task.assigned_at),
        "due_date": _iso(task.due_date),
        "started_at": _iso(task.started_at),
        "completed_at": _iso(task.completed_at),
        "location_id": task.location_id,
        "location_name": task.location.name if task.location else None,
        "instructions": task.instructions,
        "completion_notes": task.completion_notes,
        "inventory_receipt_id": task.inventory_receipt_id,
        "created_at": _iso(task.created_at),
    }
    if include_lines:
        lines = [_line_payload(line) for line in task.lines]
        payload["lines"] = lines
        payload["total_expected"] = sum(line["quantity_expected"] for line in lines)
        payload["total_scanned"] = sum(line["quantity_scanned"] for line in lines)
        payload["progress_percent"] = (
            round(payload["total_scanned"] / payload["total_expected"] * 100)
            if payload["total_expected"] else 0
        )
    return payload


# --- stock locations -------------------------------------------------------


WAREHOUSE_READ = (
    Permissions.STOCK_MOVEMENTS_VIEW,
    Permissions.RECEIVING_TASK_ASSIGN,
    Permissions.RECEIVING_TASK_EXECUTE,
)


@router.get("/locations")
async def list_locations(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    query = select(StockLocation).order_by(StockLocation.code)
    if not include_inactive:
        query = query.where(StockLocation.is_active == True)
    result = await db.execute(query)
    return [
        {
            "id": loc.id,
            "code": loc.code,
            "name": loc.name,
            "zone": loc.zone,
            "parent_id": loc.parent_id,
            "address": loc.address,
            "is_active": loc.is_active,
            "notes": loc.notes,
        }
        for loc in result.scalars().all()
    ]


@router.post("/locations", status_code=status.HTTP_201_CREATED)
async def create_location(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_LOCATION_MANAGE)),
):
    code = (body.get("code") or "").strip().upper()
    name = (body.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")

    existing = await db.execute(select(StockLocation).where(StockLocation.code == code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A location with that code already exists")

    location = StockLocation(
        code=code,
        name=name,
        zone=(body.get("zone") or "WAREHOUSE").upper(),
        parent_id=body.get("parent_id"),
        address=body.get("address"),
        notes=body.get("notes"),
        is_active=bool(body.get("is_active", True)),
    )
    db.add(location)
    await db.flush()
    await AuditService.log(
        db=db, action="stock_location.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_location", entity_id=location.id, entity_label=code,
        new_values={"name": name, "zone": location.zone},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"id": location.id, "code": location.code, "name": location.name, "zone": location.zone}


@router.patch("/locations/{location_id}")
async def update_location(
    location_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_LOCATION_MANAGE)),
):
    location = await db.get(StockLocation, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    old_values = {"name": location.name, "zone": location.zone, "is_active": location.is_active}
    for field in ("name", "zone", "address", "notes"):
        if field in body and body[field] is not None:
            setattr(location, field, body[field])
    if "is_active" in body:
        location.is_active = bool(body["is_active"])

    await AuditService.log(
        db=db, action="stock_location.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="stock_location", entity_id=location.id, entity_label=location.code,
        old_values=old_values,
        new_values={"name": location.name, "zone": location.zone, "is_active": location.is_active},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"message": "Location updated"}


# --- receiving tasks -------------------------------------------------------


@router.get("/receiving-tasks")
async def list_receiving_tasks(
    status_filter: str | None = Query(None, alias="status"),
    mine: bool = Query(False),
    assigned_to: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    query = select(ReceivingTask).options(
        selectinload(ReceivingTask.lines).selectinload(ReceivingTaskLine.units),
        selectinload(ReceivingTask.assignee),
        selectinload(ReceivingTask.purchase_order),
    )

    can_assign = Permissions.RECEIVING_TASK_ASSIGN in ROLE_PERMISSIONS.get(current_user.role, [])

    if mine or not can_assign:
        query = query.where(ReceivingTask.assigned_to == current_user.id)
    elif assigned_to:
        query = query.where(ReceivingTask.assigned_to == assigned_to)

    if status_filter:
        query = query.where(ReceivingTask.status == status_filter)

    query = query.order_by(
        ReceivingTask.status,
        ReceivingTask.due_date.asc().nullslast(),
        ReceivingTask.created_at.desc(),
    ).limit(200)

    result = await db.execute(query)
    return [_task_payload(task, include_lines=True) for task in result.scalars().unique().all()]


@router.post("/receiving-tasks", status_code=status.HTTP_201_CREATED)
async def create_receiving_task(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_ASSIGN)),
):
    """Create a counting job, optionally from an existing purchase order.

    Body: {purchase_order_id?, supplier_name?, assigned_to?, due_date?,
           priority?, location_id?, instructions?, lines?, purchase_order_line_ids?}

    With a ``purchase_order_id`` the lines are copied from whatever is still
    outstanding on that PO (already-issued open tasks are subtracted, so the
    same cartons can never be promised twice). Without one, ``lines`` must be
    supplied — that is the ad-hoc delivery path.
    """
    po_id = body.get("purchase_order_id")

    if po_id:
        po = await load_po_for_receiving(db, po_id)
        try:
            tasks = await create_tasks_from_po(
                db,
                po=po,
                actor=current_user,
                mode="WHOLE",
                spec={
                    "assigned_to": body.get("assigned_to"),
                    "priority": body.get("priority"),
                    "due_date": body.get("due_date"),
                    "location_id": body.get("location_id"),
                    "instructions": body.get("instructions"),
                    "purchase_order_line_ids": body.get("purchase_order_line_ids"),
                },
            )
        except NoOutstandingLines:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "NO_OUTSTANDING_LINES",
                    "message": (
                        f"Nothing left to receive on {po.po_number}. Either it is fully "
                        "received, or an open task already covers the balance."
                    ),
                },
            )

        task = tasks[0]
        await notify_task_assignee(db, task)
        await AuditService.log(
            db=db, action="receiving_task.create",
            actor_user_id=current_user.id, actor_role_at_time=current_user.role,
            entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
            new_values={"po": po.po_number, "assigned_to": task.assigned_to},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        return _task_payload(await _load_task(db, task.id))

    task = ReceivingTask(
        task_number=generate_task_number(),
        supplier_name=body.get("supplier_name"),
        status=ReceivingTaskStatus.DRAFT,
        priority=(body.get("priority") or "NORMAL").upper(),
        location_id=body.get("location_id"),
        instructions=body.get("instructions"),
        created_by=current_user.id,
    )
    task.due_date = parse_due_date(body.get("due_date"))

    assigned_to = body.get("assigned_to")
    if assigned_to:
        assignee = await db.get(User, int(assigned_to))
        if not assignee:
            raise HTTPException(status_code=404, detail="Assignee not found")
        task.assigned_to = assignee.id
        task.assigned_by = current_user.id
        task.assigned_at = datetime.now(timezone.utc)
        task.status = ReceivingTaskStatus.ASSIGNED

    db.add(task)
    await db.flush()

    for spec in body.get("lines") or []:
        product = await db.get(Product, spec.get("product_id"))
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {spec.get('product_id')} not found")
        db.add(ReceivingTaskLine(
            task_id=task.id,
            purchase_order_line_id=spec.get("purchase_order_line_id"),
            product_id=product.id,
            quantity_expected=int(spec.get("quantity_expected") or 0),
            unit_cost=spec.get("unit_cost"),
            tracking_mode=(product.inventory_model or "BULK").upper(),
            notes=spec.get("notes"),
        ))

    await db.flush()
    await notify_task_assignee(db, task)

    await AuditService.log(
        db=db, action="receiving_task.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
        new_values={"po": None, "assigned_to": task.assigned_to},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _task_payload(await _load_task(db, task.id))


@router.get("/receiving-tasks/{task_id}")
async def get_receiving_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    task = await _load_task(db, task_id)
    payload = _task_payload(task)

    scans_result = await db.execute(
        select(ReceivingTaskScan)
        .where(ReceivingTaskScan.task_id == task_id)
        .order_by(ReceivingTaskScan.created_at.desc())
        .limit(50)
    )
    payload["recent_scans"] = [
        {
            "id": s.id,
            "scanned_code": s.scanned_code,
            "result": s.result,
            "note": s.note,
            "created_at": _iso(s.created_at),
        }
        for s in scans_result.scalars().all()
    ]
    return payload


@router.patch("/receiving-tasks/{task_id}")
async def update_receiving_task(
    task_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_ASSIGN)),
):
    task = await _load_task(db, task_id)
    if task.status in (ReceivingTaskStatus.COMPLETED, ReceivingTaskStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Task is {task.status} and can no longer be edited")

    old_values = {"status": task.status, "assigned_to": task.assigned_to, "priority": task.priority}
    newly_assigned = None

    if "assigned_to" in body and body["assigned_to"]:
        assignee = await db.get(User, int(body["assigned_to"]))
        if not assignee:
            raise HTTPException(status_code=404, detail="Assignee not found")
        if task.assigned_to != assignee.id:
            newly_assigned = assignee.id
        task.assigned_to = assignee.id
        task.assigned_by = current_user.id
        task.assigned_at = datetime.now(timezone.utc)
        if task.status == ReceivingTaskStatus.DRAFT:
            task.status = ReceivingTaskStatus.ASSIGNED

    if "priority" in body and body["priority"]:
        task.priority = str(body["priority"]).upper()
    if "location_id" in body:
        task.location_id = body["location_id"]
    if "instructions" in body:
        task.instructions = body["instructions"]
    if "due_date" in body and body["due_date"]:
        try:
            task.due_date = datetime.fromisoformat(str(body["due_date"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="due_date must be an ISO date")

    await AuditService.log(
        db=db, action="receiving_task.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
        old_values=old_values,
        new_values={"status": task.status, "assigned_to": task.assigned_to, "priority": task.priority},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    if newly_assigned:
        from app.api.notifications import create_notification

        await create_notification(
            db, newly_assigned, "receiving_task.assigned", "New receiving task",
            f"{task.task_number} for {task.supplier_name or 'incoming goods'} has been assigned to you.",
            f"/app/warehouse/tasks/{task.id}",
        )
        await db.commit()

    return _task_payload(await _load_task(db, task.id))


@router.post("/receiving-tasks/{task_id}/start")
async def start_receiving_task(
    task_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_EXECUTE)),
):
    task = await _load_task(db, task_id)
    if task.status not in (ReceivingTaskStatus.ASSIGNED, ReceivingTaskStatus.DRAFT):
        raise HTTPException(status_code=400, detail=f"Cannot start a task in status {task.status}")

    task.status = ReceivingTaskStatus.IN_PROGRESS
    task.started_at = task.started_at or datetime.now(timezone.utc)
    if not task.assigned_to:
        task.assigned_to = current_user.id

    await AuditService.log(
        db=db, action="receiving_task.start",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _task_payload(await _load_task(db, task.id))


@router.post("/receiving-tasks/{task_id}/scan")
async def scan_receiving_task(
    task_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_EXECUTE)),
):
    """Record one scan against a task line.

    Body: {task_line_id, code, quantity?, condition?, note?}
    For SERIALIZED lines each scan creates one pending unit. For BULK lines
    pass ``quantity`` instead of relying on one-scan-per-item.
    """
    task = await _load_task(db, task_id)
    if task.status in (ReceivingTaskStatus.COMPLETED, ReceivingTaskStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Task is {task.status}; nothing more to scan")
    if task.status == ReceivingTaskStatus.DRAFT:
        task.status = ReceivingTaskStatus.IN_PROGRESS
        task.started_at = task.started_at or datetime.now(timezone.utc)
        if not task.assigned_to:
            task.assigned_to = current_user.id

    code = str(body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    line_id = body.get("task_line_id")
    line = next((l for l in task.lines if l.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Task line not found")

    note = body.get("note")
    condition = (body.get("condition") or "NEW").upper()

    def _log(result: str, message: str | None = None):
        db.add(ReceivingTaskScan(
            task_id=task.id,
            task_line_id=line.id,
            scanned_code=code[:200],
            result=result,
            product_id=line.product_id,
            note=message or note,
            scanned_by=current_user.id,
        ))

    if line.tracking_mode == "SERIALIZED":
        # Already in the system (either this task or another one)?
        existing = await db.execute(
            select(ProductUnit).where(
                or_(ProductUnit.serial_number == code, ProductUnit.barcode == code)
            )
        )
        duplicate = existing.scalars().first()
        if duplicate:
            already_here = duplicate.receiving_task_line_id == line.id
            message = (
                "This serial is already counted on this task."
                if already_here
                else f"Serial already registered against {duplicate.product.name if duplicate.product else 'another product'}."
            )
            _log("DUPLICATE", message)
            await db.commit()
            return {
                "result": "DUPLICATE",
                "message": message,
                "quantity_scanned": line.quantity_scanned,
                "quantity_expected": line.quantity_expected,
            }

        warranty_months = line.product.warranty_months if line.product else None
        if warranty_months is None:
            warranty_months = await _default_warranty_months(db)

        unit = ProductUnit(
            product_id=line.product_id,
            serial_number=code,
            barcode=code if not code.upper().startswith("TBXU") else None,
            status=UNIT_PENDING,
            condition=condition,
            unit_cost=line.unit_cost,
            warranty_months=int(warranty_months),
            warehouse_location=task.location.name if task.location else None,
            location_id=task.location_id,
            receiving_task_line_id=line.id,
            created_by=current_user.id,
            notes=note,
        )
        db.add(unit)
        line.quantity_scanned += 1
        _log("OK")

        await db.flush()
        await AuditService.log(
            db=db, action="receiving_task.scan",
            actor_user_id=current_user.id, actor_role_at_time=current_user.role,
            entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
            new_values={"serial": code, "line_id": line.id, "unit_id": unit.id},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        return {
            "result": "OK",
            "message": f"{code} counted",
            "unit": {"id": unit.id, "serial_number": unit.serial_number},
            "quantity_scanned": line.quantity_scanned,
            "quantity_expected": line.quantity_expected,
        }

    # BULK line: quantity-driven.
    try:
        quantity = int(body.get("quantity") or 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="quantity must be a whole number")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be greater than zero")

    line.quantity_scanned += quantity
    _log("OK", f"+{quantity}")
    await db.commit()
    return {
        "result": "OK",
        "message": f"{quantity} added",
        "quantity_scanned": line.quantity_scanned,
        "quantity_expected": line.quantity_expected,
    }


@router.post("/receiving-tasks/{task_id}/lines/{line_id}/quantity")
async def set_line_quantity(
    task_id: int,
    line_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_EXECUTE)),
):
    """Directly set the counted quantity for a bulk line (keyboard entry)."""
    task = await _load_task(db, task_id)
    if task.status in (ReceivingTaskStatus.COMPLETED, ReceivingTaskStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Task is {task.status}")

    line = next((l for l in task.lines if l.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Task line not found")
    if line.tracking_mode == "SERIALIZED":
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

    line.quantity_scanned = quantity
    line.quantity_rejected = int(body.get("quantity_rejected") or line.quantity_rejected or 0)
    if body.get("notes") is not None:
        line.notes = body["notes"]

    await db.commit()
    return _line_payload(line)


@router.post("/receiving-tasks/{task_id}/complete")
async def complete_receiving_task(
    task_id: int,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_EXECUTE)),
):
    """Post the counted goods: create the GRN, release units, move stock.

    Body::

        {enforce_match?: bool, completion_notes?: str}

    By default a count that does not match the expected quantity **still
    posts** at the counted figure — stock must reflect what is physically on
    the shelf — and the difference is recorded as a discrepancy for the
    purchase manager to chase the supplier with. The worker is never asked to
    adjudicate a supplier problem.

    Pass ``enforce_match: true`` for the strict behaviour (409 on a mismatch);
    that is what the automated checks use to prove the difference is detected.
    ``allow_shortfall`` is still accepted for backwards compatibility and is
    now a no-op.
    """
    body = body or {}
    task = await _load_task(db, task_id)
    if task.status == ReceivingTaskStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Task is already completed")
    if task.status == ReceivingTaskStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Task was cancelled")

    shortfalls = [
        line for line in task.lines
        if line.quantity_scanned < line.quantity_expected and line.quantity_expected > 0
    ]
    overages = [
        line for line in task.lines
        if line.quantity_scanned > line.quantity_expected and line.quantity_expected > 0
    ]
    differences = shortfalls + overages

    # Only block when the caller explicitly asked for a strict match. The
    # default is to post what was counted and report the difference.
    if differences and body.get("enforce_match"):
        details = []
        for line in shortfalls:
            details.append(
                f"short {line.quantity_expected - line.quantity_scanned} x "
                f"{line.product.name if line.product else line.product_id}"
            )
        for line in overages:
            details.append(
                f"over {line.quantity_scanned - line.quantity_expected} x "
                f"{line.product.name if line.product else line.product_id}"
            )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "COUNT_MISMATCH",
                "message": "Counted quantity does not match the expected quantity",
                "differences": details,
            },
        )

    receipt = InventoryReceipt(
        receipt_number=_receipt_number(),
        status="POSTED",
        supplier_name=task.supplier_name,
        reference_number=task.purchase_order.po_number if task.purchase_order else None,
        warehouse_location=task.location.name if task.location else None,
        notes=body.get("completion_notes") or task.instructions,
        received_at=datetime.now(timezone.utc),
        created_by=current_user.id,
        posted_by=current_user.id,
        posted_at=datetime.now(timezone.utc),
        purchase_order_id=task.purchase_order_id,
    )
    db.add(receipt)
    await db.flush()

    now = datetime.now(timezone.utc)
    moved_lines = 0

    for line in task.lines:
        if line.quantity_scanned <= 0:
            continue
        moved_lines += 1
        receipt_line = InventoryReceiptLine(
            receipt_id=receipt.id,
            product_id=line.product_id,
            quantity=line.quantity_scanned,
            tracking_mode=line.tracking_mode,
            unit_cost=line.unit_cost,
            purchase_order_line_id=line.purchase_order_line_id,
        )
        db.add(receipt_line)
        await db.flush()

        if line.tracking_mode == "SERIALIZED":
            for unit in line.units or []:
                unit.status = "AVAILABLE"
                unit.received_at = now
                unit.receipt_id = receipt.id
                unit.receipt_line_id = receipt_line.id
                if unit.warranty_months:
                    unit.warranty_start = now
                    from app.api.sales_orders import _months_delta

                    unit.warranty_end = now + _months_delta(int(unit.warranty_months))
            await recompute_serialized_stock(db, line.product_id)
        else:
            await receive_stock(
                db, line.product_id, line.quantity_scanned, "GOODS_RECEIPT", receipt.id,
                performed_by=current_user.id,
                reason=f"Received on {task.task_number}",
                idempotency_key=f"GOODS_RECEIPT:{receipt.id}:{line.product_id}",
            )

        if line.purchase_order_line_id:
            po_line = await db.get(PurchaseOrderLine, line.purchase_order_line_id)
            if po_line:
                po_line.quantity_received = (po_line.quantity_received or 0) + line.quantity_scanned

    # Refresh the purchase order status.
    if task.purchase_order_id:
        po = await _reload_po(db, task.purchase_order_id)
        if po:
            ordered = sum(l.quantity_ordered for l in po.lines)
            received = sum(l.quantity_received or 0 for l in po.lines)
            if received >= ordered and ordered > 0:
                po.status = "COMPLETED"
            elif received > 0:
                po.status = "PARTIALLY_RECEIVED"

    task.status = ReceivingTaskStatus.COMPLETED
    task.completed_at = now
    task.inventory_receipt_id = receipt.id
    if body.get("completion_notes"):
        task.completion_notes = body["completion_notes"]
    elif shortfalls or overages:
        task.completion_notes = "Completed with count differences: " + "; ".join(
            [
                f"{l.product.name if l.product else l.product_id} expected {l.quantity_expected} got {l.quantity_scanned}"
                for l in (shortfalls + overages)
            ]
        )

    # Record one discrepancy per differing line. This is the short-ship /
    # over-ship note the purchase manager chases the supplier with — the
    # worker reports it, they resolve it.
    discrepancies: list[ReceivingDiscrepancy] = []
    for line in differences:
        short = line.quantity_scanned < line.quantity_expected
        row = ReceivingDiscrepancy(
            task_id=task.id,
            task_line_id=line.id,
            purchase_order_id=task.purchase_order_id,
            purchase_order_line_id=line.purchase_order_line_id,
            product_id=line.product_id,
            # Link to the supplier master row when we can resolve it, and keep
            # the snapshot name either way. Resolving here (rather than at read
            # time) is what makes the queue group correctly from now on; a
            # supplier renamed later must not rewrite this document's history.
            supplier_id=task.supplier_id or await _resolve_supplier_id(db, task.supplier_name),
            supplier_name=task.supplier_name,
            quantity_expected=line.quantity_expected,
            quantity_scanned=line.quantity_scanned,
            difference=abs(line.quantity_expected - line.quantity_scanned),
            direction="SHORT" if short else "OVER",
            status=ReceivingDiscrepancyStatus.OPEN,
        )
        db.add(row)
        discrepancies.append(row)

    if discrepancies:
        short_count = sum(1 for row in discrepancies if row.direction == "SHORT")
        over_count = len(discrepancies) - short_count
        task.has_discrepancy = True
        task.discrepancy_summary = f"{short_count} short, {over_count} over"

    await AuditService.log(
        db=db, action="receiving_task.complete",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
        new_values={
            "receipt": receipt.receipt_number,
            "lines_moved": moved_lines,
            "shortfalls": len(shortfalls),
            "overages": len(overages),
            "discrepancies": len(discrepancies),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    from app.api.notifications import create_notification

    # Tell whoever issued the task that it is done.
    if task.assigned_by:
        await create_notification(
            db, task.assigned_by, "receiving_task.completed", "Receiving task completed",
            f"{task.task_number} was completed and stock posted ({receipt.receipt_number}).",
            "/app/warehouse/receipts",
        )

    # If the count did not match, the purchase manager needs to know — that is
    # their conversation with the supplier, not the storekeeper's.
    if discrepancies:
        recipients = {task.assigned_by} if task.assigned_by else set()
        managers = await db.execute(
            select(User).where(User.role == "PURCHASE_MANAGER", User.is_active == True)
        )
        recipients.update(user.id for user in managers.scalars().all())
        recipients.discard(current_user.id)

        detail = "; ".join(
            f"{'short' if row.direction == 'SHORT' else 'over'} {row.difference} x "
            f"{row.product.name if row.product else row.product_id}"
            for row in discrepancies
        )
        for user_id in recipients:
            await create_notification(
                db, user_id, "receiving_task.discrepancy", "Count difference to chase",
                f"{task.task_number} ({task.supplier_name or 'unknown supplier'}): {detail}. "
                f"Stock posted at the counted quantity.",
                "/app/purchase-orders/discrepancies",
            )

    await db.commit()

    return {
        "task": _task_payload(await _load_task(db, task.id)),
        "receipt_number": receipt.receipt_number,
        "receipt_id": receipt.id,
        "lines_moved": moved_lines,
        "shortfalls": len(shortfalls),
        "overages": len(overages),
        "has_discrepancy": bool(discrepancies),
        "discrepancy_count": len(discrepancies),
        "discrepancy_summary": task.discrepancy_summary,
    }


async def _reload_po(db: AsyncSession, po_id: int) -> PurchaseOrder | None:
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
        .where(PurchaseOrder.id == po_id)
    )
    return result.scalar_one_or_none()


# --- receiving discrepancies (the purchase manager's chase list) -----------


def _discrepancy_payload(row: ReceivingDiscrepancy) -> dict:
    return {
        "id": row.id,
        "task_id": row.task_id,
        "task_number": row.task.task_number if row.task else None,
        "purchase_order_id": row.purchase_order_id,
        "product_id": row.product_id,
        "product_name": row.product.name if row.product else None,
        "product_code": row.product.item_code if row.product else None,
        "supplier_name": row.supplier_name,
        "quantity_expected": row.quantity_expected,
        "quantity_scanned": row.quantity_scanned,
        "difference": row.difference,
        "direction": row.direction,
        "status": row.status,
        "resolution_note": row.resolution_note,
        "resolved_by_name": row.resolver.full_name if row.resolver else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/discrepancies")
async def list_discrepancies(
    status_filter: str | None = Query(None, alias="status"),
    supplier: str | None = Query(None),
    purchase_order_id: int | None = Query(None),
    open_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_DISCREPANCY_REVIEW)),
):
    """Count differences the warehouse reported, for chasing the supplier."""
    query = select(ReceivingDiscrepancy).order_by(ReceivingDiscrepancy.created_at.desc())
    if status_filter:
        query = query.where(ReceivingDiscrepancy.status == status_filter.upper())
    if open_only:
        query = query.where(ReceivingDiscrepancy.status.notin_(ReceivingDiscrepancyStatus.CLOSED))
    if supplier:
        query = query.where(ReceivingDiscrepancy.supplier_name.ilike(f"%{supplier}%"))
    if purchase_order_id:
        query = query.where(ReceivingDiscrepancy.purchase_order_id == purchase_order_id)

    result = await db.execute(query.limit(500))
    rows = result.scalars().unique().all()

    by_supplier: dict = {}
    for row in rows:
        # Group by the real supplier where we have the link, so one vendor cannot
        # appear twice. Fall back to the NORMALIZED name (not the raw string) for
        # rows created before suppliers existed, so "Mismatch Supplier" and
        # "mismatch supplier" still land in the same bucket instead of two.
        if row.supplier_id:
            key = ("id", row.supplier_id)
        else:
            key = ("name", normalize_supplier_name(row.supplier_name) or "unknownsupplier")
        entry = by_supplier.setdefault(
            key,
            {
                "supplier_id": row.supplier_id,
                "supplier_name": row.supplier_name or "Unknown supplier",
                "open": 0,
                "short": 0,
                "over": 0,
            },
        )
        if row.status not in ReceivingDiscrepancyStatus.CLOSED:
            entry["open"] += 1
        if row.direction == "SHORT":
            entry["short"] += row.difference
        else:
            entry["over"] += row.difference

    return {
        "items": [_discrepancy_payload(row) for row in rows],
        "total": len(rows),
        "open_count": sum(1 for row in rows if row.status not in ReceivingDiscrepancyStatus.CLOSED),
        "by_supplier": sorted(by_supplier.values(), key=lambda entry: -entry["open"]),
    }


@router.patch("/discrepancies/{discrepancy_id}")
async def update_discrepancy(
    discrepancy_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_DISCREPANCY_REVIEW)),
):
    """Move a discrepancy along: ACKNOWLEDGED -> CHASED -> RESOLVED/IGNORED."""
    row = await db.get(ReceivingDiscrepancy, discrepancy_id)
    if not row:
        raise HTTPException(status_code=404, detail="Discrepancy not found")

    old_status = row.status
    if body.get("status"):
        new_status = str(body["status"]).upper()
        if new_status not in ReceivingDiscrepancyStatus.ALL:
            raise HTTPException(status_code=400, detail=f"Unknown status {new_status}")
        row.status = new_status
        if new_status in ReceivingDiscrepancyStatus.CLOSED:
            row.resolved_at = datetime.now(timezone.utc)
            row.resolved_by = current_user.id

    if body.get("resolution_note") is not None:
        row.resolution_note = str(body["resolution_note"])[:500]

    await AuditService.log(
        db=db, action="receiving_discrepancy.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_discrepancy", entity_id=row.id,
        entity_label=f"{row.supplier_name or 'unknown'} / product {row.product_id}",
        old_values={"status": old_status},
        new_values={"status": row.status, "note": row.resolution_note},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _discrepancy_payload(row)


@router.get("/receiving-tasks/{task_id}/discrepancies")
async def task_discrepancies(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    result = await db.execute(
        select(ReceivingDiscrepancy)
        .where(ReceivingDiscrepancy.task_id == task_id)
        .order_by(ReceivingDiscrepancy.id)
    )
    return [_discrepancy_payload(row) for row in result.scalars().unique().all()]


@router.post("/receiving-tasks/{task_id}/cancel")
async def cancel_receiving_task(
    task_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_ASSIGN)),
):
    task = await _load_task(db, task_id)
    if task.status == ReceivingTaskStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="A completed task cannot be cancelled")

    # Drop anything counted but not yet posted.
    for line in task.lines:
        for unit in line.units or []:
            if unit.status == UNIT_PENDING:
                await db.delete(unit)
    task.status = ReceivingTaskStatus.CANCELLED

    await AuditService.log(
        db=db, action="receiving_task.cancel",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="receiving_task", entity_id=task.id, entity_label=task.task_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _task_payload(await _load_task(db, task.id))


# --- stock overview --------------------------------------------------------


@router.get("/stock-overview")
async def stock_overview(
    search: str | None = Query(None),
    low_stock_only: bool = Query(False),
    low_stock_threshold: int = Query(10, ge=0),
    include_inactive: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    """One clean view of what is on hand, replacing the scattered pages.

    For each product: on-hand quantity, how it is tracked, and — for
    serialized goods — a breakdown of available / reserved / sold units and
    which locations they sit in.
    """
    # Discontinued models still sit on a shelf and still tie up money, so
    # inactive products can be included rather than silently vanishing.
    filters = [] if include_inactive else [Product.is_active == True]
    if search:
        like = f"%{search}%"
        filters.append(or_(Product.name.ilike(like), Product.item_code.ilike(like), Product.obm_item_code.ilike(like)))
    if low_stock_only:
        filters.append(func.coalesce(Product.stock_qty, 0) <= low_stock_threshold)

    # Count everything that matches, so the UI can say "showing 500 of 812"
    # rather than silently pretending the list is complete.
    matched_total = await db.scalar(
        select(func.count()).select_from(Product).where(*filters)
    )

    query = select(Product).where(*filters).order_by(Product.name).limit(limit)
    result = await db.execute(query)
    products = result.scalars().unique().all()

    unit_rows = await db.execute(
        select(
            ProductUnit.product_id,
            ProductUnit.status,
            ProductUnit.warehouse_location,
            func.count().label("count"),
        ).group_by(ProductUnit.product_id, ProductUnit.status, ProductUnit.warehouse_location)
    )
    unit_index: dict[int, dict] = {}
    for product_id, unit_status, location, count in unit_rows.all():
        entry = unit_index.setdefault(product_id, {"by_status": {}, "by_location": {}})
        entry["by_status"][unit_status] = entry["by_status"].get(unit_status, 0) + count
        if location:
            entry["by_location"][location] = entry["by_location"].get(location, 0) + count

    items = []
    for product in products:
        model = (product.inventory_model or "BULK").upper()
        units = unit_index.get(product.id, {"by_status": {}, "by_location": {}})
        items.append({
            "id": product.id,
            "name": product.name,
            "item_code": product.item_code,
            "obm_item_code": product.obm_item_code,
            "category": product.category,
            "brand": product.brand,
            "uom": product.uom,
            "inventory_model": model,
            "stock_qty": product.stock_qty or 0,
            "selling_price": float(product.selling_price or 0),
            "cost_price": float(product.cost_price or 0),
            "is_low_stock": (product.stock_qty or 0) <= low_stock_threshold,
            "units_by_status": units["by_status"],
            "units_by_location": units["by_location"],
            "unit_count": sum(units["by_status"].values()),
        })

    return {
        "items": items,
        "total_products": len(items),
        "matched_products": int(matched_total or 0),
        "truncated": int(matched_total or 0) > len(items),
        "low_stock_count": sum(1 for i in items if i["is_low_stock"]),
        "serialized_count": sum(1 for i in items if i["inventory_model"] == "SERIALIZED"),
        "total_units": sum(i["unit_count"] for i in items),
        "low_stock_threshold": low_stock_threshold,
        "include_inactive": include_inactive,
    }


@router.get("/stock-movements")
async def recent_stock_movements(
    product_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.STOCK_MOVEMENTS_VIEW)),
):
    from app.models.stock_movement import StockMovement

    query = select(StockMovement).order_by(StockMovement.created_at.desc()).limit(limit)
    if product_id:
        query = query.where(StockMovement.product_id == product_id)
    result = await db.execute(query)
    return [
        {
            "id": m.id,
            "product_id": m.product_id,
            "quantity_delta": m.quantity_delta,
            "movement_type": m.movement_type,
            "source_type": m.source_type,
            "source_id": m.source_id,
            "reason": m.reason,
            "created_at": _iso(m.created_at),
        }
        for m in result.scalars().all()
    ]


# --- warranty --------------------------------------------------------------


def _unit_warranty_payload(unit: ProductUnit) -> dict:
    now = datetime.now(timezone.utc)
    end = unit.warranty_end
    days_left = None
    if end:
        days_left = (end.replace(tzinfo=timezone.utc) - now).days
    return {
        "id": unit.id,
        "serial_number": unit.serial_number,
        "barcode": unit.barcode,
        "status": unit.status,
        "condition": unit.condition,
        "warehouse_location": unit.warehouse_location,
        "location_name": unit.location.name if unit.location else None,
        "batch_number": unit.batch_number,
        "received_at": _iso(unit.received_at),
        "sold_at": _iso(unit.sold_at),
        "order_id": unit.order_id,
        "warranty_months": unit.warranty_months,
        "warranty_start": _iso(unit.warranty_start),
        "warranty_end": _iso(unit.warranty_end),
        "warranty_days_left": days_left,
        "warranty_active": bool(end and days_left is not None and days_left >= 0 and not unit.warranty_void_reason),
        "warranty_void_reason": unit.warranty_void_reason,
    }


@router.get("/warranty/lookup/{code}")
async def warranty_lookup(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WARRANTY_VIEW)),
):
    """Scan or type a serial and see the whole story of that item."""
    result = await db.execute(
        select(ProductUnit).where(
            or_(
                ProductUnit.serial_number == code,
                ProductUnit.barcode == code,
                ProductUnit.unit_code == code,
                ProductUnit.manufacturer_serial == code,
            )
        )
    )
    unit = result.scalars().first()
    if not unit:
        return {"found": False, "code": code}

    product = await db.get(Product, unit.product_id)
    customer = None
    if unit.customer_id:
        from app.models.customer import Customer

        customer = await db.get(Customer, unit.customer_id)

    order_number = None
    if unit.order_id:
        from app.models.sales_order import SalesOrder

        order = await db.get(SalesOrder, unit.order_id)
        order_number = order.order_number if order else None

    claims_result = await db.execute(
        select(WarrantyClaim)
        .where(WarrantyClaim.product_unit_id == unit.id)
        .order_by(WarrantyClaim.created_at.desc())
    )

    return {
        "found": True,
        "code": code,
        "unit": _unit_warranty_payload(unit),
        "product": {
            "id": product.id,
            "name": product.name,
            "item_code": product.item_code,
            "obm_item_code": product.obm_item_code,
            "brand": product.brand,
            "category": product.category,
        } if product else None,
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "code": customer.code,
            "phone": customer.phone,
        } if customer else None,
        "sales_order_number": order_number,
        "claims": [
            {
                "id": c.id,
                "claim_number": c.claim_number,
                "issue": c.issue,
                "status": c.status,
                "resolution": c.resolution,
                "in_warranty_at_claim": c.in_warranty_at_claim,
                "created_at": _iso(c.created_at),
            }
            for c in claims_result.scalars().all()
        ],
    }


@router.get("/warranty/claims")
async def list_warranty_claims(
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WARRANTY_VIEW)),
):
    query = select(WarrantyClaim).order_by(WarrantyClaim.created_at.desc()).limit(200)
    if status_filter:
        query = query.where(WarrantyClaim.status == status_filter)
    result = await db.execute(query)
    return [
        {
            "id": c.id,
            "claim_number": c.claim_number,
            "status": c.status,
            "issue": c.issue,
            "resolution": c.resolution,
            "in_warranty_at_claim": c.in_warranty_at_claim,
            "serial_number": c.unit.serial_number if c.unit else None,
            "product_name": c.unit.product.name if c.unit and c.unit.product else None,
            "customer_name": c.customer.name if c.customer else None,
            "created_at": _iso(c.created_at),
            "closed_at": _iso(c.closed_at),
        }
        for c in result.scalars().unique().all()
    ]


@router.post("/warranty/claims", status_code=status.HTTP_201_CREATED)
async def create_warranty_claim(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WARRANTY_MANAGE)),
):
    code = str(body.get("code") or body.get("serial_number") or "").strip()
    issue = str(body.get("issue") or "").strip()
    if not code or not issue:
        raise HTTPException(status_code=400, detail="code and issue are required")

    result = await db.execute(
        select(ProductUnit).where(
            or_(ProductUnit.serial_number == code, ProductUnit.barcode == code)
        )
    )
    unit = result.scalars().first()
    if not unit:
        raise HTTPException(status_code=404, detail="No unit found for that serial number")

    now = datetime.now(timezone.utc)
    in_warranty = bool(
        unit.warranty_end
        and unit.warranty_end.replace(tzinfo=timezone.utc) >= now
        and not unit.warranty_void_reason
    )

    claim = WarrantyClaim(
        claim_number=_claim_number(),
        product_unit_id=unit.id,
        customer_id=unit.customer_id,
        sales_order_id=unit.order_id,
        issue=issue,
        status=WarrantyClaimStatus.OPEN,
        in_warranty_at_claim=in_warranty,
        received_at=now,
        created_by=current_user.id,
    )
    db.add(claim)

    if unit.status == "SOLD":
        unit.status = "RETURNED"

    await db.flush()
    await AuditService.log(
        db=db, action="warranty_claim.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="warranty_claim", entity_id=claim.id, entity_label=claim.claim_number,
        new_values={"serial": unit.serial_number, "in_warranty": in_warranty},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {
        "id": claim.id,
        "claim_number": claim.claim_number,
        "status": claim.status,
        "in_warranty_at_claim": in_warranty,
        "message": (
            "Claim opened — still inside warranty."
            if in_warranty
            else "Claim opened — outside warranty. Decide as a goodwill case."
        ),
    }


@router.patch("/warranty/claims/{claim_id}")
async def update_warranty_claim(
    claim_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.WARRANTY_MANAGE)),
):
    claim = await db.get(WarrantyClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    old_status = claim.status
    if "status" in body and body["status"]:
        new_status = str(body["status"]).upper()
        if new_status not in WarrantyClaimStatus.ALL:
            raise HTTPException(status_code=400, detail=f"Unknown status {new_status}")
        claim.status = new_status
        if new_status in (WarrantyClaimStatus.CLOSED, WarrantyClaimStatus.REJECTED, WarrantyClaimStatus.REPLACED):
            claim.closed_at = datetime.now(timezone.utc)

    if body.get("resolution") is not None:
        claim.resolution = body["resolution"]
    claim.handled_by = current_user.id

    if claim.status == WarrantyClaimStatus.REPLACED and body.get("replacement_serial"):
        replacement = await db.execute(
            select(ProductUnit).where(ProductUnit.serial_number == body["replacement_serial"])
        )
        replacement_unit = replacement.scalars().first()
        if not replacement_unit:
            raise HTTPException(status_code=404, detail="Replacement serial not found")
        claim.replacement_unit_id = replacement_unit.id
        replacement_unit.status = "SOLD"
        replacement_unit.sold_at = datetime.now(timezone.utc)
        replacement_unit.customer_id = claim.customer_id
        replacement_unit.order_id = claim.sales_order_id
        if replacement_unit.warranty_months:
            from app.api.sales_orders import _months_delta

            replacement_unit.warranty_start = datetime.now(timezone.utc)
            replacement_unit.warranty_end = datetime.now(timezone.utc) + _months_delta(
                int(replacement_unit.warranty_months)
            )
        await recompute_serialized_stock(db, replacement_unit.product_id)

    await AuditService.log(
        db=db, action="warranty_claim.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="warranty_claim", entity_id=claim.id, entity_label=claim.claim_number,
        old_values={"status": old_status},
        new_values={"status": claim.status, "resolution": claim.resolution},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"message": "Claim updated", "status": claim.status}
