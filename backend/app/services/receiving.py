"""Turning a purchase order into warehouse work.

A purchase order says what the supplier promised. A `ReceivingTask` says who is
standing at the loading bay counting it. This module owns the translation
between the two, and — critically — the arithmetic that stops the same goods
being counted twice.

Why the arithmetic matters: `PurchaseOrderLine.quantity_received` only advances
when a task is **completed**. So between "task issued" and "task completed" the
PO still looks fully outstanding, and a second conversion would issue a
duplicate task for the same cartons. `outstanding_for_po_line` therefore
subtracts whatever is already promised to an open task.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.product import Product
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.models.user import User
from app.models.warehouse import ReceivingTask, ReceivingTaskLine, ReceivingTaskStatus

# A task in one of these states still "holds" the quantity it expects.
OPEN_TASK_STATUSES = (
    ReceivingTaskStatus.DRAFT,
    ReceivingTaskStatus.ASSIGNED,
    ReceivingTaskStatus.IN_PROGRESS,
)


class NoOutstandingLines(Exception):
    """Nothing left on this PO to receive."""


def generate_task_number() -> str:
    import secrets

    return f"RT-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


def parse_due_date(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="due_date must be an ISO date")


async def load_po_for_receiving(db: AsyncSession, po_id: int) -> PurchaseOrder:
    """Load a PO with lines and each line's product eagerly attached.

    Eager loading is not optional: touching a lazy relationship from async
    code raises MissingGreenlet.
    """
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product))
        .where(PurchaseOrder.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


def compute_outstanding(ordered, received, reserved) -> int:
    """How much of a PO line still needs counting.

    ``ordered − received − reserved``, floored at zero. Kept as a pure function
    so the arithmetic that prevents double-conversion can be tested without a
    database.

    ``received`` only advances when a task is *completed*, so ``reserved`` —
    what open tasks have already promised to count — is what stops the same
    cartons being issued to two workers.
    """
    return max(0, int(ordered or 0) - int(received or 0) - int(reserved or 0))


async def reserved_on_open_tasks(db: AsyncSession, po_line_id: int) -> int:
    """Quantity already promised to a task that has not finished or been cancelled."""
    total = await db.scalar(
        select(func.coalesce(func.sum(ReceivingTaskLine.quantity_expected), 0))
        .join(ReceivingTask, ReceivingTask.id == ReceivingTaskLine.task_id)
        .where(
            ReceivingTaskLine.purchase_order_line_id == po_line_id,
            ReceivingTask.status.in_(OPEN_TASK_STATUSES),
        )
    )
    return int(total or 0)


async def outstanding_for_po_line(db: AsyncSession, po_line: PurchaseOrderLine) -> int:
    """How much of this line still needs counting: ordered − received − reserved."""
    reserved = await reserved_on_open_tasks(db, po_line.id)
    return compute_outstanding(po_line.quantity_ordered, po_line.quantity_received, reserved)


async def outstanding_lines_for_po(db: AsyncSession, po: PurchaseOrder) -> list[dict]:
    """Outstanding quantities per line — used by the UI to preview a task."""
    rows = []
    for po_line in po.lines:
        outstanding = await outstanding_for_po_line(db, po_line)

        # What the accounting package believes already arrived. Shown beside our
        # own figure, never merged into it: a PO that OBM considers delivered but
        # this app has no receipt for is a question for a human, not something to
        # reconcile silently. Sending someone to count goods that arrived months
        # ago wastes a trip and teaches them to distrust the task list.
        obm_processed = (
            float(po_line.obm_quantity_processed)
            if po_line.obm_quantity_processed is not None
            else None
        )

        rows.append({
            "purchase_order_line_id": po_line.id,
            "product_id": po_line.product_id,
            "product_name": po_line.product.name if po_line.product else None,
            "product_code": po_line.product.item_code if po_line.product else None,
            "inventory_model": (po_line.product.inventory_model or "BULK").upper() if po_line.product else "BULK",
            "quantity_ordered": po_line.quantity_ordered,
            "quantity_received": po_line.quantity_received,
            "quantity_outstanding": outstanding,
            "unit_cost": float(po_line.unit_cost) if po_line.unit_cost is not None else None,
            "obm_quantity_processed": obm_processed,
            # True when OBM says goods arrived that we have no receipt for.
            "obm_disagrees": bool(
                obm_processed is not None and obm_processed > po_line.quantity_received
            ),
            # True when OBM considers the line fully delivered, so there may be
            # nothing left to count at all.
            "obm_already_complete": bool(
                obm_processed is not None
                and obm_processed >= po_line.quantity_ordered > 0
            ),
        })
    return rows


async def _resolve_assignee(db: AsyncSession, user_id) -> User | None:
    if not user_id:
        return None
    assignee = await db.get(User, int(user_id))
    if not assignee:
        raise HTTPException(status_code=404, detail=f"Assignee {user_id} not found")
    return assignee


async def create_task_from_po(
    db: AsyncSession,
    *,
    po: PurchaseOrder,
    actor: User,
    assigned_to=None,
    priority: str = "NORMAL",
    due_date=None,
    location_id=None,
    instructions=None,
    po_line_ids: list[int] | None = None,
    required: bool = True,
) -> ReceivingTask | None:
    """Create one task covering the given PO lines.

    ``po_line_ids=None`` means "every line that still has an outstanding
    quantity". Returns ``None`` instead of raising when ``required=False`` and
    there is nothing to count — that is how a split assignment whose lines were
    already claimed by a sibling gets skipped instead of failing the request.
    """
    if po_line_ids is not None:
        valid_ids = {line.id for line in po.lines}
        unknown = set(po_line_ids) - valid_ids
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"These lines do not belong to {po.po_number}: {sorted(unknown)}",
            )

    assignee = await _resolve_assignee(db, assigned_to)

    task = ReceivingTask(
        task_number=generate_task_number(),
        purchase_order_id=po.id,
        supplier_name=po.supplier_name,
        status=ReceivingTaskStatus.DRAFT,
        priority=(priority or "NORMAL").upper(),
        location_id=location_id,
        instructions=instructions,
        created_by=actor.id,
    )
    if assignee:
        task.assigned_to = assignee.id
        task.assigned_by = actor.id
        task.assigned_at = datetime.now(timezone.utc)
        task.status = ReceivingTaskStatus.ASSIGNED
    task.due_date = parse_due_date(due_date)

    db.add(task)
    await db.flush()

    added = 0
    for po_line in po.lines:
        if po_line_ids is not None and po_line.id not in po_line_ids:
            continue
        # Recomputed per line: a sibling task created moments ago in this same
        # request is already counted, so it cannot be promised twice.
        outstanding = await outstanding_for_po_line(db, po_line)
        if outstanding <= 0:
            continue
        product = po_line.product or await db.get(Product, po_line.product_id)
        db.add(ReceivingTaskLine(
            task_id=task.id,
            purchase_order_line_id=po_line.id,
            product_id=po_line.product_id,
            quantity_expected=outstanding,
            unit_cost=po_line.unit_cost,
            tracking_mode=(product.inventory_model or "BULK").upper() if product else "BULK",
        ))
        added += 1
    await db.flush()

    if added == 0:
        await db.delete(task)
        await db.flush()
        if required:
            raise NoOutstandingLines()
        return None

    return task


async def create_tasks_from_po(
    db: AsyncSession,
    *,
    po: PurchaseOrder,
    actor: User,
    mode: str = "WHOLE",
    spec: dict | None = None,
    assignments: list[dict] | None = None,
) -> list[ReceivingTask]:
    """Issue one task for the whole PO, or split it across several workers.

    ``mode="WHOLE"`` uses ``spec`` for the single task.
    ``mode="SPLIT"`` creates one task per entry in ``assignments``; each entry
    may name the PO lines it covers, and inherits anything it omits from
    ``spec`` so the dialog can set sensible defaults once.
    """
    spec = spec or {}
    mode = (mode or "WHOLE").upper()

    if mode == "SPLIT":
        entries = assignments or []
        if not entries:
            raise HTTPException(status_code=400, detail="SPLIT mode needs at least one assignment")
        tasks: list[ReceivingTask] = []
        for entry in entries:
            raw_ids = entry.get("purchase_order_line_ids")
            line_ids = [int(i) for i in raw_ids] if raw_ids else None
            task = await create_task_from_po(
                db,
                po=po,
                actor=actor,
                assigned_to=entry.get("assigned_to") if entry.get("assigned_to") is not None else spec.get("assigned_to"),
                priority=entry.get("priority") or spec.get("priority") or "NORMAL",
                due_date=entry.get("due_date") or spec.get("due_date"),
                location_id=entry.get("location_id") if entry.get("location_id") is not None else spec.get("location_id"),
                instructions=entry.get("instructions") or spec.get("instructions"),
                po_line_ids=line_ids,
                required=False,
            )
            if task:
                tasks.append(task)
        if not tasks:
            raise NoOutstandingLines()
        return tasks

    task = await create_task_from_po(
        db,
        po=po,
        actor=actor,
        assigned_to=spec.get("assigned_to"),
        priority=spec.get("priority") or "NORMAL",
        due_date=spec.get("due_date"),
        location_id=spec.get("location_id"),
        instructions=spec.get("instructions"),
        po_line_ids=[int(i) for i in spec["purchase_order_line_ids"]] if spec.get("purchase_order_line_ids") else None,
    )
    return [task] if task else []


async def notify_task_assignee(db: AsyncSession, task: ReceivingTask) -> None:
    if not task.assigned_to:
        return
    from app.api.notifications import create_notification

    await create_notification(
        db, task.assigned_to, "receiving_task.assigned", "New receiving task",
        f"{task.task_number} for {task.supplier_name or 'incoming goods'} has been assigned to you.",
        f"/app/warehouse/tasks/{task.id}",
    )


async def open_tasks_for_po(db: AsyncSession, po_id: int) -> list[dict]:
    """Open tasks on a PO, so the detail page can say "already issued"."""
    result = await db.execute(
        select(ReceivingTask)
        .options(selectinload(ReceivingTask.lines), selectinload(ReceivingTask.assignee))
        .where(
            ReceivingTask.purchase_order_id == po_id,
            ReceivingTask.status.in_(OPEN_TASK_STATUSES),
        )
        .order_by(ReceivingTask.created_at.desc())
    )
    return [
        {
            "id": task.id,
            "task_number": task.task_number,
            "status": task.status,
            "assigned_to": task.assigned_to,
            "assigned_to_name": task.assignee.full_name if task.assignee else None,
            "total_expected": sum(line.quantity_expected for line in task.lines),
            "total_scanned": sum(line.quantity_scanned for line in task.lines),
        }
        for task in result.scalars().unique().all()
    ]
