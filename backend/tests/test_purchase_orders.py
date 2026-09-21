import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.inventory import receive_inventory
from app.api.purchase_orders import (
    cancel_purchase_order,
    create_purchase_order,
    send_purchase_order,
)
from app.models.product import Product
from app.models.user import User
from app.schemas.inventory import InventoryReceiptCreate, InventoryReceiptLineCreate
from app.schemas.purchase_order import PurchaseOrderCreate, PurchaseOrderLineCreate


def request_context(path: str = "/api/purchase-orders") -> Request:
    return Request({"type": "http", "method": "POST", "path": path, "headers": [], "client": ("test", 1234)})


async def _seed_user_and_product(db_session, username="po-manager"):
    user = User(username=username, full_name="PO Manager", password_hash="hash", role="MANAGER")
    product = Product(name="PO Widget", item_code="POW-001", stock_qty=0)
    db_session.add_all([user, product])
    await db_session.flush()
    return user, product


async def _create_sent_po(db_session, user, product, ordered=10):
    body = PurchaseOrderCreate(
        supplier_name="Supplier B",
        lines=[PurchaseOrderLineCreate(product_id=product.id, quantity_ordered=ordered)],
    )
    po = await create_purchase_order(body, request_context(), db_session, user)
    po = await send_purchase_order(po["id"], request_context(), db_session, user)
    assert po["status"] == "SENT"
    return po


@pytest.mark.asyncio
async def test_po_lifecycle_create_send_partial_complete(db_session):
    user, product = await _seed_user_and_product(db_session)
    po = await _create_sent_po(db_session, user, product, ordered=10)
    po_line_id = po["lines"][0]["id"]

    first = await receive_inventory(
        InventoryReceiptCreate(
            purchase_order_id=po["id"],
            lines=[InventoryReceiptLineCreate(
                product_id=product.id, quantity=4, tracking_mode="BULK",
                purchase_order_line_id=po_line_id,
            )],
        ),
        request_context("/api/inventory/receipts"), db_session, user, idempotency_key=None,
    )
    assert first["lines"][0]["quantity"] == 4

    from app.api.purchase_orders import get_purchase_order
    po = await get_purchase_order(po["id"], db_session, user)
    assert po["status"] == "PARTIALLY_RECEIVED"
    assert po["lines"][0]["quantity_received"] == 4
    assert po["lines"][0]["quantity_outstanding"] == 6
    await db_session.refresh(product)
    assert product.stock_qty == 4

    await receive_inventory(
        InventoryReceiptCreate(
            purchase_order_id=po["id"],
            lines=[InventoryReceiptLineCreate(
                product_id=product.id, quantity=6, tracking_mode="BULK",
                purchase_order_line_id=po_line_id,
            )],
        ),
        request_context("/api/inventory/receipts"), db_session, user, idempotency_key=None,
    )
    po = await get_purchase_order(po["id"], db_session, user)
    assert po["status"] == "COMPLETED"
    assert po["lines"][0]["quantity_outstanding"] == 0
    await db_session.refresh(product)
    assert product.stock_qty == 10


@pytest.mark.asyncio
async def test_receive_against_draft_po_rejected(db_session):
    user, product = await _seed_user_and_product(db_session, username="po-manager-2")
    body = PurchaseOrderCreate(
        supplier_name="Supplier B",
        lines=[PurchaseOrderLineCreate(product_id=product.id, quantity_ordered=5)],
    )
    po = await create_purchase_order(body, request_context(), db_session, user)
    assert po["status"] == "DRAFT"

    with pytest.raises(HTTPException) as exc:
        await receive_inventory(
            InventoryReceiptCreate(
                purchase_order_id=po["id"],
                lines=[InventoryReceiptLineCreate(
                    product_id=product.id, quantity=2, tracking_mode="BULK",
                    purchase_order_line_id=po["lines"][0]["id"],
                )],
            ),
            request_context("/api/inventory/receipts"), db_session, user, idempotency_key=None,
        )
    assert exc.value.status_code == 400
    await db_session.refresh(product)
    assert product.stock_qty == 0


@pytest.mark.asyncio
async def test_receive_with_mismatched_po_line_rejected(db_session):
    user, product = await _seed_user_and_product(db_session, username="po-manager-3")
    other = Product(name="Other Gadget", item_code="OTH-001", stock_qty=0)
    db_session.add(other)
    await db_session.flush()
    po = await _create_sent_po(db_session, user, product, ordered=5)

    with pytest.raises(HTTPException) as exc:
        await receive_inventory(
            InventoryReceiptCreate(
                purchase_order_id=po["id"],
                lines=[InventoryReceiptLineCreate(
                    product_id=other.id, quantity=1, tracking_mode="BULK",
                    purchase_order_line_id=po["lines"][0]["id"],
                )],
            ),
            request_context("/api/inventory/receipts"), db_session, user, idempotency_key=None,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cancel_draft_po(db_session):
    user, product = await _seed_user_and_product(db_session, username="po-manager-4")
    body = PurchaseOrderCreate(
        supplier_name="Supplier B",
        lines=[PurchaseOrderLineCreate(product_id=product.id, quantity_ordered=3)],
    )
    po = await create_purchase_order(body, request_context(), db_session, user)
    cancelled = await cancel_purchase_order(po["id"], request_context(), db_session, user)
    assert cancelled["status"] == "CANCELLED"

    with pytest.raises(HTTPException):
        await send_purchase_order(po["id"], request_context(), db_session, user)
