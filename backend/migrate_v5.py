"""Idempotent migration for stock transfers (v5).

Adds:
  * `stock_transfers` / `stock_transfer_lines` — moving stock between locations
    with a check at each end
  * `product_units.stock_transfer_id` — claims a unit to an in-flight transfer so
    it cannot be sent twice

Safe to run repeatedly:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v5.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402

import app.models  # noqa: F401,E402

NEW_TABLES = ("stock_transfers", "stock_transfer_lines")

COLUMNS: dict[str, list[str]] = {
    "product_units": [
        "stock_transfer_id INTEGER",
    ],
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_stock_transfers_status ON stock_transfers (status)",
    "CREATE INDEX IF NOT EXISTS ix_stock_transfers_from ON stock_transfers (from_location_id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_transfers_to ON stock_transfers (to_location_id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_transfer_lines_transfer ON stock_transfer_lines (transfer_id)",
    "CREATE INDEX IF NOT EXISTS ix_product_units_transfer ON product_units (stock_transfer_id)",
]


async def add_columns(conn):
    for table, definitions in COLUMNS.items():
        exists = await conn.scalar(
            text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}
        )
        if not exists:
            print(f"  ! table {table} missing, skipping")
            continue
        for definition in definitions:
            column = definition.split()[0]
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {definition}"))
            print(f"  + {table}.{column}")


async def add_indexes(conn):
    for statement in INDEXES:
        try:
            await conn.execute(text(statement))
        except Exception as exc:  # pragma: no cover - index is an optimisation
            print(f"  ! index skipped: {exc}")
    print("  ~ indexes ensured")


async def main():
    url = settings.DATABASE_URL
    print("=" * 62)
    print(" OBM Sales Helper - v5 migration (stock transfers)")
    print(f" Database: {url.rsplit('@', 1)[-1]}")
    print("=" * 62)

    engine = create_async_engine(url, echo=False)

    print("\n[1/3] Creating any missing tables ...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print(f"  done ({', '.join(NEW_TABLES)} included)")

    print("\n[2/3] Adding missing columns ...")
    async with engine.begin() as conn:
        await add_columns(conn)

    print("\n[3/3] Ensuring indexes ...")
    async with engine.begin() as conn:
        await add_indexes(conn)

    print("\nVerifying ...")
    async with engine.begin() as conn:
        for table in NEW_TABLES:
            present = await conn.scalar(
                text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}
            )
            print(f"  {table}: {'ok' if present else 'MISSING'}")
        present = await conn.scalar(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_name='product_units' AND column_name='stock_transfer_id'"
        ))
        print(f"  product_units.stock_transfer_id: {'ok' if present else 'MISSING'}")

    await engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())
