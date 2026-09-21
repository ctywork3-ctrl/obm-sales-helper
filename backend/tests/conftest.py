import asyncio
import os
import sys

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import Base  # noqa: E402
import app.models.user  # noqa: F401,E402
import app.models.product  # noqa: F401,E402
import app.models.customer  # noqa: F401,E402
import app.models.sales_order  # noqa: F401,E402
import app.models.audit_log  # noqa: F401,E402
import app.models.session  # noqa: F401,E402
import app.models.settings  # noqa: F401,E402
import app.models.role_permission  # noqa: F401,E402
import app.models.notification  # noqa: F401,E402
import app.models.comment  # noqa: F401,E402
import app.models.stock_movement  # noqa: F401,E402
import app.models.product_barcode  # noqa: F401,E402
import app.models.product_unit  # noqa: F401,E402
import app.models.product_unit_image  # noqa: F401,E402
import app.models.location_log  # noqa: F401,E402
import app.models.master_data  # noqa: F401,E402
import app.models.order_template  # noqa: F401,E402
import app.models.inventory_receipt  # noqa: F401,E402


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()
