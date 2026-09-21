"""Idempotent migration for stock take sessions (v4).

Adds:
  * `stock_take_sessions` — a physical count of the shelf versus the system
  * `stock_take_counts` — one expected-versus-counted line per product
  * `product_units.stock_take_session_id` / `stock_take_counted_at` — so a scan
    during a count can be attributed to that session without a join table

Safe to run repeatedly:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v4.py
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

NEW_TABLES = ("stock_take_sessions", "stock_take_counts")

COLUMNS: dict[str, list[str]] = {
    "product_units": [
        "stock_take_session_id INTEGER",
        "stock_take_counted_at TIMESTAMPTZ",
    ],
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_stock_take_sessions_status ON stock_take_sessions (status)",
    "CREATE INDEX IF NOT EXISTS ix_stock_take_sessions_location ON stock_take_sessions (location_id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_take_counts_session ON stock_take_counts (session_id)",
    "CREATE INDEX IF NOT EXISTS ix_product_units_stock_take ON product_units (stock_take_session_id)",
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
    print(" OBM Sales Helper - v4 migration (stock takes)")
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
        for column in ("stock_take_session_id", "stock_take_counted_at"):
            present = await conn.scalar(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name='product_units' AND column_name=:c"
            ), {"c": column})
            print(f"  product_units.{column}: {'ok' if present else 'MISSING'}")

    await engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())
