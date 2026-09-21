"""Idempotent migration for the OBM received-quantity column (v7).

Adds:
  * `purchase_order_lines.obm_quantity_processed`

Why it exists
-------------
OBM records, per purchase-order line, how much it considers already received
(`PURCHASEORDERITEM.QTYPROCESSED`). This app had nowhere to put that, so an order
OBM thinks is half-delivered imported as fully outstanding - and the warehouse
was sent to receive goods that had arrived months earlier.

The column is deliberately separate from `quantity_received`:

  * `quantity_received` is what THIS app received, through its own receipt
    records. Stock moves through the ledger, and receipts are the evidence.
  * `obm_quantity_processed` is what the ACCOUNTING PACKAGE believes happened.

Keeping them apart means the difference can be shown to a person instead of being
silently reconciled. A human decides whether the gap is a delivery nobody booked
in here, or a receipt that predates this system.

Nullable, so every existing row stays valid, and a line that never came from OBM
genuinely has no such figure.

Safe to run repeatedly:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v7.py
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

NEW_TABLES: tuple[str, ...] = ()

COLUMNS: dict[str, list[str]] = {
    "purchase_order_lines": ["obm_quantity_processed NUMERIC(12, 3)"],
}

INDEXES: list[str] = []


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
            await conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {definition}")
            )
            print(f"  + {table}.{column}")


async def main():
    print("=" * 62)
    print(" Migration v7 - OBM received quantity on PO lines")
    print("=" * 62)

    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    print("\n[1/3] Ensuring tables exist ...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  ~ ok")

    print("\n[2/3] Adding columns ...")
    async with engine.begin() as conn:
        await add_columns(conn)

    print("\n[3/3] Verifying ...")
    async with engine.begin() as conn:
        ok = await conn.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name='purchase_order_lines' "
                "AND column_name='obm_quantity_processed'"
            )
        )
        print(f"  purchase_order_lines.obm_quantity_processed: {'ok' if ok else 'MISSING'}")
        filled = await conn.scalar(
            text(
                "SELECT COUNT(*) FROM purchase_order_lines "
                "WHERE obm_quantity_processed IS NOT NULL"
            )
        )
        total = await conn.scalar(text("SELECT COUNT(*) FROM purchase_order_lines"))
        print(f"  lines carrying an OBM figure: {filled} of {total}")

    await engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())
