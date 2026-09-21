import asyncio
import json
import os
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import require_any_permission, require_permission
from app.models.product import Product
from app.models.purchase_order import PurchaseDocument, PurchaseOrder, PurchaseOrderLine
from app.models.user import User
from app.permissions import Permissions
from app.schemas.purchase_order import PurchaseOrderCreate
from app.services.audit import AuditService
from app.services.ai import extract_purchase_order
from app.services import obm_firebird
from app.services.obm import get_obm_config, import_purchase_orders
from app.services.po_import import parse_po_csv
from app.services.receiving import (
    NoOutstandingLines,
    create_tasks_from_po,
    load_po_for_receiving,
    notify_task_assignee,
    open_tasks_for_po,
    outstanding_lines_for_po,
)

# Kept in step with the warehouse read guard: reading receiving data needs a
# warehouse-flavoured permission, not merely products.view.
WAREHOUSE_READ = (
    Permissions.STOCK_MOVEMENTS_VIEW,
    Permissions.RECEIVING_TASK_ASSIGN,
    Permissions.RECEIVING_TASK_EXECUTE,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])

VALID_TRANSITIONS = {
    "DRAFT": {"SENT", "CANCELLED"},
    "SENT": {"PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"},
    "PARTIALLY_RECEIVED": {"COMPLETED", "CANCELLED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
}


def _po_number() -> str:
    return f"PO-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


def _line_payload(line: PurchaseOrderLine) -> dict:
    return {
        "id": line.id,
        "product_id": line.product_id,
        "product_name": line.product.name if line.product else None,
        "product_code": (line.product.item_code if line.product else None),
        "evidence_policy": (line.product.evidence_policy if line.product else "RECEIPT"),
        "inventory_model": (line.product.inventory_model if line.product else "BULK"),
        "quantity_ordered": line.quantity_ordered,
        "quantity_received": line.quantity_received,
        "quantity_outstanding": max(0, line.quantity_ordered - line.quantity_received),
        "unit_cost": float(line.unit_cost) if line.unit_cost is not None else None,
        # What OBM believes was received, kept beside our own figure. The UI uses
        # the gap to warn before sending someone to receive goods the accounting
        # package already considers delivered.
        "obm_quantity_processed": (
            float(line.obm_quantity_processed)
            if line.obm_quantity_processed is not None
            else None
        ),
    }


def _po_payload(po: PurchaseOrder) -> dict:
    return {
        "id": po.id,
        "po_number": po.po_number,
        # Both, deliberately. `supplier_name` is the snapshot of what the
        # document said; `supplier_id` is the live link to master data. The UI
        # needs both to show "Shimano SEA (not in the supplier list)" because
        # renaming a supplier must never rewrite an issued PO.
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier_name,
        "status": po.status,
        "source": po.source or "MANUAL",
        "external_reference": po.external_reference,
        "expected_date": po.expected_date.isoformat() if po.expected_date else None,
        "notes": po.notes,
        "created_by": po.created_by,
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "lines": [_line_payload(line) for line in po.lines],
        "documents": [
            {
                "id": doc.id,
                "original_filename": doc.original_filename,
                "extraction_status": doc.extraction_status,
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
            }
            for doc in po.documents
        ],
    }


async def _load_po(po_id: int, db: AsyncSession) -> PurchaseOrder:
    result = await db.execute(
        select(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product),
            selectinload(PurchaseOrder.documents),
        )
        .where(PurchaseOrder.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    body: PurchaseOrderCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    product_ids = {line.product_id for line in body.lines}
    products_result = await db.execute(select(Product.id).where(Product.id.in_(product_ids)))
    found = {row[0] for row in products_result.all()}
    missing = product_ids - found
    if missing:
        raise HTTPException(status_code=404, detail=f"Product not found: {sorted(missing)}")

    po = PurchaseOrder(
        po_number=_po_number(),
        supplier_name=body.supplier_name.strip(),
        status="DRAFT",
        expected_date=body.expected_date,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(po)
    await db.flush()
    for line_data in body.lines:
        db.add(PurchaseOrderLine(
            purchase_order_id=po.id,
            product_id=line_data.product_id,
            quantity_ordered=line_data.quantity_ordered,
            quantity_received=0,
            unit_cost=line_data.unit_cost,
        ))
    await db.flush()

    await AuditService.log(
        db=db,
        action="purchase_order.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="purchase_order",
        entity_id=po.id,
        entity_label=po.po_number,
        new_values={"supplier": po.supplier_name, "lines": len(body.lines)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _po_payload(await _load_po(po.id, db))


@router.get("")
async def list_purchase_orders(
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    source: str | None = Query(None, description="MANUAL | OBM_IMPORT"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    query = select(PurchaseOrder).options(selectinload(PurchaseOrder.lines))
    if status_filter:
        query = query.where(PurchaseOrder.status == status_filter)
    if source:
        query = query.where(PurchaseOrder.source == source.upper())
    if search:
        like = f"%{search}%"
        query = query.where(or_(PurchaseOrder.po_number.ilike(like), PurchaseOrder.supplier_name.ilike(like)))
    query = query.order_by(PurchaseOrder.created_at.desc()).limit(100)
    result = await db.execute(query)
    pos = result.scalars().all()
    return [
        {
            "id": po.id,
            "po_number": po.po_number,
            # Keep this in step with `_po_payload`. The list is what the PO
            # table renders, so a missing `supplier_id` here would leave every
            # row looking unlinked even though the master row is set.
            "supplier_id": po.supplier_id,
            "supplier_name": po.supplier_name,
            "status": po.status,
            "source": po.source or "MANUAL",
            "external_reference": po.external_reference,
            "expected_date": po.expected_date.isoformat() if po.expected_date else None,
            "line_count": len(po.lines),
            "total_ordered": sum(line.quantity_ordered for line in po.lines),
            "total_received": sum(line.quantity_received for line in po.lines),
            "total_outstanding": sum(max(0, line.quantity_ordered - line.quantity_received) for line in po.lines),
        }
        for po in pos
    ]


@router.get("/open")
async def list_open_purchase_orders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    """Purchase orders warehouse staff can still receive against."""
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product))
        .where(PurchaseOrder.status.in_(["SENT", "PARTIALLY_RECEIVED"]))
        .order_by(PurchaseOrder.created_at.desc())
        .limit(100)
    )
    return [_po_payload(po) for po in result.scalars().unique().all()]


@router.get("/obm-status")
async def obm_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    """Whether the OBM link is configured, and whether it actually answers.

    Two different questions, deliberately reported separately. "Configured but
    not reachable" (wrong path, OBM's database moved, credentials changed) is the
    common failure, and collapsing it into a single "not configured" would send
    someone looking for the wrong problem.
    """
    config = await get_obm_config(db)
    firebird = obm_firebird.ObmFirebirdConfig.from_settings()

    # Reading OBM shells out to isql, which blocks. Push it off the event loop so
    # one status check cannot stall every other request.
    link = await asyncio.to_thread(obm_firebird.test_connection, firebird)

    return {
        "configured": config["configured"],
        "enabled": config["enabled"],
        "api_url": config["api_url"],
        # The direct Firebird link. This is the one that does the work.
        "direct_configured": firebird.configured,
        "direct_connected": link["connected"],
        "engine_version": link.get("engine_version"),
        "purchase_order_count": link.get("purchase_order_count"),
        "import_available": True,
        "import_formats": ["obm", "csv"],
        "message": (
            link["message"]
            if link["connected"]
            else (
                f"{link['message']} You can still import a CSV export."
                if firebird.configured
                else (
                    "OBM's database is not linked yet, so purchase orders must be "
                    "imported from a CSV export. Set OBM_FIREBIRD_DATABASE to read "
                    "them directly."
                )
            )
        ),
    }


@router.post("/import-obm")
async def import_purchase_orders_from_obm(
    request: Request,
    limit: int = Query(50, ge=1, le=500, description="How many recent POs to look at"),
    since: str | None = Query(None, description="Only POs on/after this date (YYYY-MM-DD)"),
    include_cancelled: bool = Query(False),
    commit: bool = Query(False, description="False previews the read; true writes the POs"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ, Permissions.PRODUCTS_MANAGE)),
):
    """Read purchase orders straight from OBM's database (preview by default).

    **Read-only against OBM.** Every statement issued to the accounting package
    is a SELECT - it is the legal record of the business and this app never
    writes to it. Only this app's own database is written, and only when
    `commit=true`.

    The preview-first rule is the same as the CSV importer, for the same reason:
    pulling 40 purchase orders sight-unseen is how a bad link quietly creates 40
    wrong drafts.
    """
    config = obm_firebird.ObmFirebirdConfig.from_settings()
    if not config.configured:
        raise HTTPException(
            status_code=400,
            detail=(
                "OBM's database is not configured. Set OBM_FIREBIRD_DATABASE "
                "(and OBM_FIREBIRD_ISQL if isql is not in the default location)."
            ),
        )

    try:
        read = await asyncio.to_thread(
            obm_firebird.read_purchase_orders,
            config,
            limit=limit,
            since=since,
            include_cancelled=include_cancelled,
        )
    except obm_firebird.ObmFirebirdError as exc:
        # A link problem is the caller's to fix, and the message says how.
        raise HTTPException(status_code=502, detail=str(exc))

    result: dict = {
        "source": "OBM",
        "counts": read["counts"],
        "skipped": read["skipped"],
        "committed": False,
        "orders_found": len(read["orders"]),
    }

    if not read["orders"]:
        result["message"] = (
            "OBM returned no importable purchase orders. "
            + (
                f"{len(read['skipped'])} were read but had no usable lines "
                "(expense or allocation lines carry no stock item)."
                if read["skipped"]
                else "There may be nothing new since the last import."
            )
        )
        return result

    if not commit:
        result["preview"] = [
            {
                "external_reference": order["external_reference"],
                "supplier_name": order["supplier_name"],
                "expected_date": order["expected_date"],
                "line_count": len(order["lines"]),
            }
            for order in read["orders"]
        ]
        total_lines = sum(len(order["lines"]) for order in read["orders"])
        result["message"] = (
            f"Preview only — {read['counts']['headers']} purchase order(s) read from OBM; "
            f"{len(read['orders'])} have stock lines ({total_lines} line(s) in total). "
            "Nothing has been saved yet. "
            # Deliberately not "N would be imported": whether an order survives
            # depends on its lines matching your catalogue, which is only decided
            # at import time. Promising a number here and then creating fewer is
            # how a preview stops being trusted.
            "Each line is matched to a product when you import, and an order whose "
            "lines match nothing is reported rather than created empty."
        )
        return result

    report = await import_purchase_orders(db, read["orders"], current_user.id)

    await AuditService.log(
        db=db, action="purchase_order.obm_import",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="purchase_order", entity_label=f"OBM direct read ({limit} POs)",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    result.update({
        "committed": True,
        "created": report["created"],
        "updated": report["updated"],
        "unmatched_lines": report["unmatched_lines"],
        # The reader's skips (nothing importable in OBM) AND the importer's skips
        # (nothing matched a product here). Reporting only the first list made
        # orders disappear: a PO could be counted as "would import", then create
        # nothing and appear in no list at all.
        "skipped": list(read["skipped"]) + [
            {**entry, "line_count": entry.get("line_count", 0)}
            for entry in report["skipped"]
        ],
        "message": (
            f"Read {read['counts']['headers']} purchase order(s) from OBM: "
            f"{report['created']} new, {report['updated']} updated"
            + (
                f", {len(report['skipped'])} could not be used"
                if report["skipped"]
                else ""
            )
            + "."
            + (
                f" {len(report['unmatched_lines'])} line(s) could not be matched to "
                "a product - create the product or set its OBM item code."
                if report["unmatched_lines"]
                else ""
            )
        ),
    })
    return result


@router.post("/import-csv")
async def import_purchase_orders_csv(
    request: Request,
    file: UploadFile = File(...),
    commit: bool = Query(False, description="False previews the parse; true writes the POs"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ, Permissions.PRODUCTS_MANAGE)),
):
    """Import purchase orders from a CSV export (preview by default).

    This is the practical answer to "how does real data get in?" without waiting
    for a decision on OBM's handover format: CSV is what any accounting package
    can produce today, and it feeds the same `import_purchase_orders()` seam a
    future connector will use.

    **`commit=false` is the default on purpose.** Importing master documents
    sight-unseen is how a bad export quietly creates 40 wrong POs. The caller
    parses first, shows the user what would happen, and only then commits.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="CSV is too large (5 MB maximum)")

    parsed = parse_po_csv(raw)

    # An order whose every row was rejected has no lines and cannot be imported
    # (the importer skips it with "no lines"). Drop it here so the counts the
    # user sees are the counts that will actually happen, and keep the parser's
    # explanatory error.
    importable = [order for order in parsed["orders"] if order["lines"]]

    result: dict = {
        "filename": file.filename,
        "rows_read": parsed["rows_read"],
        "matched_columns": parsed["columns"],
        "orders_found": len(importable),
        "errors": parsed["errors"],
        "warnings": parsed["warnings"],
        "unmatched_suppliers": parsed["unmatched_suppliers"],
        "committed": False,
    }

    if not importable:
        # Nothing usable. Say why rather than returning an empty success.
        result["message"] = "No importable purchase orders were found in this file."
        return result

    if not commit:
        result["preview"] = [
            {
                "external_reference": order["external_reference"],
                "supplier_name": order["supplier_name"],
                "expected_date": order["expected_date"],
                "line_count": len(order["lines"]),
            }
            for order in importable
        ]
        result["message"] = (
            f"Preview only — {len(importable)} purchase order(s) would be imported. "
            "Nothing has been saved yet."
        )
        return result

    report = await import_purchase_orders(db, importable, current_user.id)

    await AuditService.log(
        db=db, action="purchase_order.csv_import",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="purchase_order", entity_label=file.filename or "upload.csv",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    result.update({
        "committed": True,
        "created": report["created"],
        "updated": report["updated"],
        "skipped": report["skipped"],
        "unmatched_lines": report["unmatched_lines"],
        "message": (
            f"Imported {report['created']} new and updated {report['updated']} purchase order(s)."
        ),
    })
    return result


@router.get("/{po_id}")
async def get_purchase_order(
    po_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    po = await _load_po(po_id, db)
    payload = _po_payload(po)
    payload["open_receiving_tasks"] = await open_tasks_for_po(db, po_id)
    return payload


@router.get("/{po_id}/receiving-lines")
async def purchase_order_receiving_lines(
    po_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_permission(*WAREHOUSE_READ)),
):
    """What is still outstanding on this PO — used to preview a receiving task.

    Already-issued open tasks are subtracted, so the numbers shown here are
    what a new task would actually cover.
    """
    po = await load_po_for_receiving(db, po_id)
    lines = await outstanding_lines_for_po(db, po)

    # Surface the accounting package's opinion before anyone is sent to count.
    # A line OBM considers delivered but this app has no receipt for is either a
    # delivery nobody booked in here or a receipt that predates this system - a
    # human decides which, so say it plainly rather than reconciling silently.
    obm_lines = [line for line in lines if line["obm_quantity_processed"] is not None]
    disagreeing = [line for line in lines if line["obm_disagrees"]]
    complete = [line for line in lines if line["obm_already_complete"]]

    obm_note = None
    if complete:
        obm_note = (
            f"OBM already records {len(complete)} of these line(s) as fully received, "
            "so there may be nothing left to count. Check before issuing this task."
        )
    elif disagreeing:
        obm_note = (
            f"OBM records more received than this app has, on {len(disagreeing)} line(s). "
            "Those goods may already have arrived."
        )

    return {
        "po_number": po.po_number,
        "supplier_name": po.supplier_name,
        "lines": lines,
        "total_outstanding": sum(line["quantity_outstanding"] for line in lines),
        "open_receiving_tasks": await open_tasks_for_po(db, po_id),
        # Only present for POs that came from OBM with a processed figure.
        "obm_lines_with_figure": len(obm_lines),
        "obm_disagreeing_lines": len(disagreeing),
        "obm_complete_lines": len(complete),
        "obm_note": obm_note,
    }


@router.post("/{po_id}/receiving-tasks", status_code=status.HTTP_201_CREATED)
async def issue_receiving_tasks(
    po_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.RECEIVING_TASK_ASSIGN)),
):
    """Turn a purchase order into warehouse work.

    Body::

        {
          "mode": "WHOLE" | "SPLIT",
          "assigned_to": int?, "priority": "LOW|NORMAL|HIGH"?,
          "due_date": iso?, "location_id": int?, "instructions": str?,
          "assignments": [            # SPLIT only
            {"assigned_to": int, "purchase_order_line_ids": [int]?, ...}
          ]
        }

    Returns ``{tasks: [...]}`` — one task for WHOLE, one per assignment for
    SPLIT. Each task only ever covers quantities that no other open task has
    already claimed.
    """
    po = await load_po_for_receiving(db, po_id)
    mode = (body.get("mode") or "WHOLE").upper()

    try:
        tasks = await create_tasks_from_po(
            db,
            po=po,
            actor=current_user,
            mode=mode,
            spec={
                "assigned_to": body.get("assigned_to"),
                "priority": body.get("priority"),
                "due_date": body.get("due_date"),
                "location_id": body.get("location_id"),
                "instructions": body.get("instructions"),
            },
            assignments=body.get("assignments"),
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

    for task in tasks:
        await notify_task_assignee(db, task)

    await AuditService.log(
        db=db,
        action="purchase_order.issue_receiving_tasks",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="purchase_order",
        entity_id=po.id,
        entity_label=po.po_number,
        new_values={
            "mode": mode,
            "tasks": [task.task_number for task in tasks],
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    return {"tasks": [await _task_payload_for(db, task.id) for task in tasks]}


async def _task_payload_for(db: AsyncSession, task_id: int) -> dict:
    from app.api.warehouse_ops import _load_task, _task_payload

    return _task_payload(await _load_task(db, task_id))


@router.post("/{po_id}/send")
async def send_purchase_order(
    po_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    po = await _load_po(po_id, db)
    if "SENT" not in VALID_TRANSITIONS.get(po.status, set()):
        raise HTTPException(status_code=400, detail=f"Cannot send a purchase order in status {po.status}")
    po.status = "SENT"
    await AuditService.log(
        db=db, action="purchase_order.send",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="purchase_order", entity_id=po.id, entity_label=po.po_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    # Tell warehouse staff new goods are expected, and point the purchase
    # manager at the PO so they can issue a receiving task.
    from app.api.notifications import create_notification
    stockkeepers = await db.execute(
        select(User).where(User.role == "STOCK_KEEPER", User.is_active == True)
    )
    for keeper in stockkeepers.scalars().all():
        await create_notification(
            db, keeper.id, "po.sent", "Goods expected",
            f"{po.po_number} from {po.supplier_name} is expected. You will get a receiving task to count it.",
            f"/app/purchase-orders/{po.id}",
        )

    await db.commit()
    return _po_payload(await _load_po(po.id, db))


@router.post("/{po_id}/cancel")
async def cancel_purchase_order(
    po_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    po = await _load_po(po_id, db)
    if "CANCELLED" not in VALID_TRANSITIONS.get(po.status, set()):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a purchase order in status {po.status}")
    po.status = "CANCELLED"
    await AuditService.log(
        db=db, action="purchase_order.cancel",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="purchase_order", entity_id=po.id, entity_label=po.po_number,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return _po_payload(await _load_po(po.id, db))


@router.post("/documents", status_code=status.HTTP_201_CREATED)
async def upload_purchase_document(
    request: Request,
    file: UploadFile = File(...),
    purchase_order_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    """Store a supplier PO/invoice file for review. The file is kept as a
    draft attachment only: extraction runs only when an AI provider is
    configured, and extracted lines must be confirmed by a manager before
    any purchase order is created. Nothing here changes stock."""
    allowed_types = {
        "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
    }
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only PDF and image files are allowed")
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File is too large")

    if purchase_order_id is not None:
        po_result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == purchase_order_id))
        if not po_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Purchase order not found")

    os.makedirs(settings.PRIVATE_UPLOAD_DIR, exist_ok=True)
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "pdf").lower()
    filename = f"podoc-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(settings.PRIVATE_UPLOAD_DIR, filename), "wb") as destination:
        destination.write(content)

    doc = PurchaseDocument(
        purchase_order_id=purchase_order_id,
        file_path=filename,
        original_filename=file.filename,
        mime_type=file.content_type,
        extraction_status="PENDING_AI",
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.flush()

    # Run AI extraction now (review-only). On any failure the document is
    # still saved so the manager can type lines manually.
    extraction = await extract_purchase_order(content, file.content_type)
    if extraction.get("status") == "ok":
        doc.extracted_json = json.dumps(extraction)
        doc.extraction_status = "REVIEWED"
    elif extraction.get("status") == "error":
        doc.extraction_status = "FAILED"
    else:
        doc.extraction_status = "PENDING_AI"

    await AuditService.log(
        db=db, action="purchase_order.document_upload",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="purchase_document", entity_id=doc.id, entity_label=file.filename,
        new_values={"extraction_status": doc.extraction_status},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    lines = extraction.get("lines", []) if extraction.get("status") == "ok" else []
    return {
        "id": doc.id,
        "original_filename": doc.original_filename,
        "extraction_status": doc.extraction_status,
        "supplier_name": extraction.get("supplier_name", "") if extraction.get("status") == "ok" else "",
        "po_number": extraction.get("po_number", "") if extraction.get("status") == "ok" else "",
        "lines": lines,
        "message": (
            "AI read this document. Review the lines below before confirming."
            if extraction.get("status") == "ok"
            else (
                "AI could not read this document. Type the lines manually."
                if extraction.get("status") == "error"
                else "AI is not configured. Type the lines manually."
            )
        ),
    }


@router.get("/documents/{document_id}/extraction")
async def get_document_extraction(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    doc = await db.execute(select(PurchaseDocument).where(PurchaseDocument.id == document_id))
    doc = doc.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    data = {}
    if doc.extracted_json:
        try:
            data = json.loads(doc.extracted_json)
        except json.JSONDecodeError:
            data = {}
    return {
        "id": doc.id,
        "extraction_status": doc.extraction_status,
        "supplier_name": data.get("supplier_name", ""),
        "po_number": data.get("po_number", ""),
        "lines": data.get("lines", []),
    }
