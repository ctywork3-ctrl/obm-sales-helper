import pytest

from app.models.product import Product
from app.services.stock import deduct_stock, restore_stock


@pytest.mark.asyncio
class TestDeductStock:
    async def test_deducts_and_records_movement(self, db_session):
        product = Product(name="Test Rod", stock_qty=10)
        db_session.add(product)
        await db_session.flush()

        success = await deduct_stock(db_session, product.id, 4, "SALES_ORDER", 1)
        await db_session.commit()
        assert success is True

        await db_session.refresh(product)
        assert product.stock_qty == 6

    async def test_insufficient_stock_fails(self, db_session):
        product = Product(name="Test Reel", stock_qty=2)
        db_session.add(product)
        await db_session.flush()

        success = await deduct_stock(db_session, product.id, 5, "SALES_ORDER", 1)
        assert success is False

        await db_session.commit()
        await db_session.refresh(product)
        assert product.stock_qty == 2

    async def test_idempotency_key_prevents_double_deduct(self, db_session):
        product = Product(name="Test Line", stock_qty=10)
        db_session.add(product)
        await db_session.flush()

        key = "SALES_ORDER:1:DEDUCT:1"
        first = await deduct_stock(db_session, product.id, 3, "SALES_ORDER", 1, idempotency_key=key)
        await db_session.commit()
        assert first is True

        second = await deduct_stock(db_session, product.id, 3, "SALES_ORDER", 1, idempotency_key=key)
        await db_session.commit()
        assert second is True  # treated as already processed

        await db_session.refresh(product)
        assert product.stock_qty == 7  # only deducted once

    async def test_zero_quantity_fails(self, db_session):
        product = Product(name="Test Hook", stock_qty=10)
        db_session.add(product)
        await db_session.flush()

        assert await deduct_stock(db_session, product.id, 0, "SALES_ORDER", 1) is False
        assert await deduct_stock(db_session, product.id, -3, "SALES_ORDER", 1) is False


@pytest.mark.asyncio
class TestRestoreStock:
    async def test_restores_and_records_movement(self, db_session):
        product = Product(name="Test Lure", stock_qty=2)
        db_session.add(product)
        await db_session.flush()

        success = await restore_stock(db_session, product.id, 5, "SALES_ORDER", 1)
        await db_session.commit()
        assert success is True

        await db_session.refresh(product)
        assert product.stock_qty == 7

    async def test_idempotency_key_prevents_double_restore(self, db_session):
        product = Product(name="Test Bait", stock_qty=0)
        db_session.add(product)
        await db_session.flush()

        key = "SALES_ORDER:2:RESTORE:1"
        await restore_stock(db_session, product.id, 4, "SALES_ORDER", 2, idempotency_key=key)
        await db_session.commit()

        await restore_stock(db_session, product.id, 4, "SALES_ORDER", 2, idempotency_key=key)
        await db_session.commit()

        await db_session.refresh(product)
        assert product.stock_qty == 4  # restored once only


@pytest.mark.asyncio
class TestDeductRestoreCycle:
    async def test_full_cycle(self, db_session):
        product = Product(name="Cycle Rod", stock_qty=10)
        db_session.add(product)
        await db_session.flush()

        await deduct_stock(db_session, product.id, 6, "SALES_ORDER", 10)
        await db_session.commit()
        await db_session.refresh(product)
        assert product.stock_qty == 4

        await restore_stock(db_session, product.id, 6, "SALES_ORDER", 10)
        await db_session.commit()
        await db_session.refresh(product)
        assert product.stock_qty == 10
