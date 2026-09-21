"""Idempotent migration for the receiving/labels feature drop (v3).

Adds:
  * purchase-order provenance columns (`source`, `external_reference`,
    `external_synced_at`) — the seam for a future OBM import
  * receiving-task discrepancy columns, and the `receiving_discrepancies` table
    that replaced the blocking count-mismatch gate
  * `label_print_settings` and `public_app_url` settings
  * a correction: rod products get a 24-month warranty, matching the market
    (Shimano SEA warrants rods for 2 years, reels for 1)

Safe to run repeatedly. Run with the same interpreter as `migrate_v2.py`:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v3.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402

import app.models  # noqa: F401,E402
from app.models.settings import Setting  # noqa: E402
from app.services.labels import DEFAULT_LABEL_CONFIG  # noqa: E402

COLUMNS: dict[str, list[str]] = {
    "purchase_orders": [
        "source VARCHAR(20) DEFAULT 'MANUAL'",
        "external_reference VARCHAR(100)",
        "external_synced_at TIMESTAMPTZ",
    ],
    "receiving_tasks": [
        "has_discrepancy BOOLEAN DEFAULT FALSE",
        "discrepancy_summary TEXT",
        "discrepancy_resolved_at TIMESTAMPTZ",
        "discrepancy_resolved_by INTEGER",
    ],
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_purchase_orders_source ON purchase_orders (source)",
    "CREATE INDEX IF NOT EXISTS ix_receiving_tasks_has_discrepancy ON receiving_tasks (has_discrepancy)",
    "CREATE INDEX IF NOT EXISTS ix_receiving_discrepancies_status ON receiving_discrepancies (status)",
    "CREATE INDEX IF NOT EXISTS ix_receiving_discrepancies_supplier ON receiving_discrepancies (supplier_name)",
]

NEW_SETTINGS = [
    {"key": "label_print_settings", "value": {"value": DEFAULT_LABEL_CONFIG}},
    {"key": "public_app_url", "value": {"value": ""}},
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


async def backfill(conn):
    await conn.execute(text(
        "UPDATE purchase_orders SET source = 'MANUAL' WHERE source IS NULL"
    ))
    await conn.execute(text(
        "UPDATE receiving_tasks SET has_discrepancy = FALSE WHERE has_discrepancy IS NULL"
    ))
    print("  ~ backfilled purchase_orders.source and receiving_tasks.has_discrepancy")


async def fix_rod_warranty(conn):
    """Rods carry a 2-year warranty in this market; the app defaulted to 12 months.

    Only touches products that still have the old default or nothing set, so a
    term someone deliberately changed is never overwritten.
    """
    result = await conn.execute(text(
        """
        UPDATE products
        SET warranty_months = 24
        WHERE (category ILIKE '%rod%' OR name ILIKE '%rod%')
          AND (warranty_months IS NULL OR warranty_months = 12)
        """
    ))
    print(f"  ~ set 24-month warranty on {result.rowcount} rod product(s)")


async def seed_settings(db: AsyncSession):
    for spec in NEW_SETTINGS:
        existing = (
            await db.execute(select(Setting).where(Setting.key == spec["key"]))
        ).scalar_one_or_none()
        if existing:
            print(f"  = setting {spec['key']} already present")
            continue
        db.add(Setting(key=spec["key"], value_json=spec["value"]))
        print(f"  + setting {spec['key']}")
    await db.flush()


async def main():
    url = settings.DATABASE_URL
    print("=" * 62)
    print(" OBM Sales Helper - v3 migration (receiving + labels)")
    print(f" Database: {url.rsplit('@', 1)[-1]}")
    print("=" * 62)

    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("\n[1/6] Creating any missing tables ...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  done (receiving_discrepancies included)")

    print("\n[2/6] Adding missing columns ...")
    async with engine.begin() as conn:
        await add_columns(conn)

    print("\n[3/6] Ensuring indexes ...")
    async with engine.begin() as conn:
        await add_indexes(conn)

    print("\n[4/6] Backfilling existing rows ...")
    async with engine.begin() as conn:
        await backfill(conn)

    print("\n[5/6] Correcting rod warranty terms ...")
    async with engine.begin() as conn:
        await fix_rod_warranty(conn)

    print("\n[6/6] Seeding new settings ...")
    async with session_factory() as db:
        await seed_settings(db)
        await db.commit()

    print("\nVerifying ...")
    async with engine.begin() as conn:
        tables = await conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename IN ('receiving_discrepancies')"
        ))
        print("  tables:", [row[0] for row in tables.all()] or "MISSING")
        for column in ("source", "external_reference"):
            present = await conn.scalar(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name='purchase_orders' AND column_name=:c"
            ), {"c": column})
            print(f"  purchase_orders.{column}: {'ok' if present else 'MISSING'}")
        for column in ("has_discrepancy", "discrepancy_summary"):
            present = await conn.scalar(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name='receiving_tasks' AND column_name=:c"
            ), {"c": column})
            print(f"  receiving_tasks.{column}: {'ok' if present else 'MISSING'}")

    await engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())
