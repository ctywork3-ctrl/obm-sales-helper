from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.inventory import receive_inventory, resolve_inventory_identifier, adjust_inventory
from app.api.sales_orders import _deduct_stock, _confirm_reserved_units, _restore_stock
from app.models.product import Product
from app.models.product_unit import ProductUnit
from app.models.sales_order import SalesOrder, SalesOrderItem
from app.models.user import User
from app.schemas.inventory import (
    InventoryAdjustmentCreate,
    InventoryReceiptCreate,
    InventoryReceiptLineCreate,
)


def request_context() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/api/inventory/receipts", "headers": [], "client": ("test", 1234)})


@pytest.mark.asyncio
async def test_serialized_receipt_creates_units_barcodes_and_stock(db_session):
    user = User(username="warehouse-test", full_name="Warehouse Test", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Serialized Rod", item_code="ROD-001", stock_qty=0, inventory_model="SERIALIZED")
    db_session.add_all([user, product])
    await db_session.flush()

    body = InventoryReceiptCreate(
        supplier_name="Test Supplier",
        reference_number="DN-001",
        warehouse_location="RACK-A1",
        lines=[InventoryReceiptLineCreate(product_id=product.id, quantity=2, tracking_mode="SERIALIZED")],
    )
    response = await receive_inventory(body, request_context(), db_session, user, idempotency_key=None)

    assert response["status"] == "POSTED"
    assert len(response["units"]) == 2
    assert all(unit["unit_code"].startswith("U-") for unit in response["units"])
    assert len({unit["barcode"] for unit in response["units"]}) == 2
    await db_session.refresh(product)
    assert product.stock_qty == 2  # derived from AVAILABLE unit count

    resolved = await resolve_inventory_identifier(response["units"][0]["barcode"], db_session, user)
    assert resolved["found"] is True
    assert resolved["result_type"] == "UNIT"
    assert resolved["unit"]["id"] == response["units"][0]["id"]


@pytest.mark.asyncio
async def test_bulk_receipt_updates_stock_without_creating_units(db_session):
    user = User(username="warehouse-bulk", full_name="Warehouse Bulk", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Bulk Hooks", item_code="HOOK-001", stock_qty=4)
    db_session.add_all([user, product])
    await db_session.flush()

    body = InventoryReceiptCreate(
        warehouse_location="BIN-B2",
        lines=[InventoryReceiptLineCreate(product_id=product.id, quantity=6, tracking_mode="BULK")],
    )
    response = await receive_inventory(body, request_context(), db_session, user, idempotency_key=None)

    assert response["units"] == []
    await db_session.refresh(product)
    assert product.stock_qty == 10


@pytest.mark.asyncio
async def test_receipt_idempotency_key_retries_are_safe(db_session):
    user = User(username="warehouse-idem", full_name="Warehouse Idem", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Idem Rod", item_code="IDEM-001", stock_qty=0)
    db_session.add_all([user, product])
    await db_session.flush()

    body = InventoryReceiptCreate(
        lines=[InventoryReceiptLineCreate(product_id=product.id, quantity=3, tracking_mode="BULK")],
    )
    first = await receive_inventory(body, request_context(), db_session, user, idempotency_key="retry-key-1")
    second = await receive_inventory(body, request_context(), db_session, user, idempotency_key="retry-key-1")

    assert first["id"] == second["id"]
    await db_session.refresh(product)
    assert product.stock_qty == 3


@pytest.mark.asyncio
async def test_adjustment_idempotency_key_retries_are_safe(db_session):
    user = User(username="warehouse-adj", full_name="Warehouse Adj", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Adj Rod", item_code="ADJ-001", stock_qty=5)
    db_session.add_all([user, product])
    await db_session.flush()

    body = InventoryAdjustmentCreate(product_id=product.id, quantity_delta=-2, reason="Count correction")
    first = await adjust_inventory(body, request_context(), db_session, user, idempotency_key="adj-key-1")
    second = await adjust_inventory(body, request_context(), db_session, user, idempotency_key="adj-key-1")

    assert first["id"] == second["id"]
    await db_session.refresh(product)
    assert product.stock_qty == 3


@pytest.mark.asyncio
async def test_serialized_units_allocated_and_released_with_order(db_session):
    user = User(username="warehouse-alloc", full_name="Warehouse Alloc", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Alloc Rod", item_code="ALLOC-001", stock_qty=2, inventory_model="SERIALIZED")
    unit_a = ProductUnit(product_id=0, unit_code="U-A", serial_number="SN-A", barcode="TBXU-A", status="AVAILABLE")
    unit_b = ProductUnit(product_id=0, unit_code="U-B", serial_number="SN-B", barcode="TBXU-B", status="AVAILABLE")
    db_session.add_all([user, product, unit_a, unit_b])
    await db_session.flush()
    unit_a.product_id = product.id
    unit_b.product_id = product.id
    await db_session.flush()

    order = SalesOrder(order_number="SO-TEST-ALLOC", salesman_id=user.id, status="DRAFT")
    db_session.add(order)
    await db_session.flush()
    db_session.add(SalesOrderItem(sales_order_id=order.id, product_id=product.id, quantity=2))
    await db_session.flush()

    await _deduct_stock(db_session, order.id, user.id)
    await db_session.flush()
    await db_session.refresh(unit_a)
    await db_session.refresh(unit_b)
    assert unit_a.status == "RESERVED" and unit_a.order_id == order.id
    assert unit_b.status == "RESERVED" and unit_b.order_id == order.id
    await db_session.refresh(product)
    assert product.stock_qty == 0  # no AVAILABLE units remain

    await _confirm_reserved_units(db_session, order.id)
    await db_session.flush()
    await db_session.refresh(unit_a)
    assert unit_a.status == "SOLD" and unit_a.sold_at is not None

    # simulate a reject/cancel: release reserved units back
    unit_b.status = "RESERVED"
    await db_session.flush()
    await _restore_stock(db_session, order.id, user.id)
    await db_session.flush()
    await db_session.refresh(unit_b)
    assert unit_b.status == "AVAILABLE" and unit_b.order_id is None


@pytest.mark.asyncio
async def test_serialized_deduct_blocks_when_insufficient_units(db_session):
    from fastapi import HTTPException
    user = User(username="warehouse-partial", full_name="Warehouse Partial", password_hash="hash", role="STOCK_KEEPER")
    product = Product(name="Partial Rod", item_code="PART-001", stock_qty=5, inventory_model="SERIALIZED")
    only_unit = ProductUnit(product_id=0, unit_code="U-P", serial_number="SN-P", barcode="TBXU-P", status="AVAILABLE")
    db_session.add_all([user, product, only_unit])
    await db_session.flush()
    only_unit.product_id = product.id
    await db_session.flush()

    order = SalesOrder(order_number="SO-TEST-PART", salesman_id=user.id, status="DRAFT")
    db_session.add(order)
    await db_session.flush()
    db_session.add(SalesOrderItem(sales_order_id=order.id, product_id=product.id, quantity=3))
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await _deduct_stock(db_session, order.id, user.id)
    assert exc.value.status_code == 400
    await db_session.refresh(only_unit)
    assert only_unit.status == "AVAILABLE" and only_unit.order_id is None
