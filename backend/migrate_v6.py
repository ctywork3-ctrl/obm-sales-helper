"""Idempotent migration for supplier master data (v6).

Adds:
  * `suppliers` — vendor master data, mirroring `brands` (normalized_name unique)
  * `purchase_orders.supplier_id`        — link to the master row
  * `inventory_receipts.supplier_id`     — link to the master row
  * `receiving_tasks.supplier_id`        — link to the master row
  * `receiving_discrepancies.supplier_id`— link to the master row

and then **backfills** it: every distinct `supplier_name` already present becomes a
supplier row, and the documents that carry that name are linked to it.

Why backfill rather than start empty: the discrepancy queue groups by supplier, and
that grouping is the whole point of the feature. Shipping an empty supplier table
would mean every existing shortage still reads as "Unknown supplier" until someone
retypes it. The backfill is what makes the feature useful on day one.

Casing and spacing variants collapse into one supplier (`normalize_supplier_name`),
so 'Mismatch Supplier' and 'mismatch supplier' become a single row and their
discrepancies finally group together.

The old `supplier_name` columns are deliberately KEPT. They are the historical
snapshot: a PO issued to "Mismatch Supplier" must still read that way even if the
vendor is later renamed. `supplier_id` is the live link; `supplier_name` is the
record of what the document said.

Safe to run repeatedly - every step is guarded:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v6.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.master_data import normalize_supplier_name  # noqa: E402

import app.models  # noqa: F401,E402

NEW_TABLES = ("suppliers",)

# table -> new column definitions. Every one is nullable: existing rows must not
# be invalidated by the migration, and a document created before this feature
# genuinely has no supplier_id.
COLUMNS: dict[str, list[str]] = {
    "purchase_orders": ["supplier_id INTEGER REFERENCES suppliers(id)"],
    "inventory_receipts": ["supplier_id INTEGER REFERENCES suppliers(id)"],
    "receiving_tasks": ["supplier_id INTEGER REFERENCES suppliers(id)"],
    "receiving_discrepancies": ["supplier_id INTEGER REFERENCES suppliers(id)"],
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_suppliers_normalized ON suppliers (normalized_name)",
    "CREATE INDEX IF NOT EXISTS ix_suppliers_code ON suppliers (code)",
    "CREATE INDEX IF NOT EXISTS ix_suppliers_active ON suppliers (is_active)",
    "CREATE INDEX IF NOT EXISTS ix_purchase_orders_supplier ON purchase_orders (supplier_id)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_receipts_supplier ON inventory_receipts (supplier_id)",
    "CREATE INDEX IF NOT EXISTS ix_receiving_tasks_supplier ON receiving_tasks (supplier_id)",
    "CREATE INDEX IF NOT EXISTS ix_receiving_disc_supplier ON receiving_discrepancies (supplier_id)",
]

# Where the free-text names live. Order matters only for reporting.
NAME_SOURCES = (
    "purchase_orders",
    "inventory_receipts",
    "receiving_tasks",
    "receiving_discrepancies",
)


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


async def add_indexes(conn):
    for statement in INDEXES:
        try:
            await conn.execute(text(statement))
        except Exception as exc:  # pragma: no cover - index is an optimisation
            print(f"  ! index skipped: {exc}")
    print("  ~ indexes ensured")


async def backfill_suppliers(conn):
    """Create one supplier per distinct meaningful supplier_name, then link rows.

    Returns (created, linked).
    """
    # 1. Collect every distinct name that is not blank and not whitespace-only.
    names: dict[str, str] = {}  # normalized -> first-seen display name
    for table in NAME_SOURCES:
        exists = await conn.scalar(
            text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}
        )
        if not exists:
            continue
        rows = await conn.execute(
            text(
                f"SELECT DISTINCT supplier_name FROM {table} "
                "WHERE supplier_name IS NOT NULL AND btrim(supplier_name) <> ''"
            )
        )
        for (raw,) in rows:
            normalized = normalize_supplier_name(raw)
            if normalized and normalized not in names:
                names[normalized] = str(raw).strip()

    if not names:
        print("  ~ no existing supplier names to import")
        return 0, 0

    # 2. Insert the ones we do not already have.
    created = 0
    for normalized, display in sorted(names.items()):
        existing = await conn.scalar(
            text("SELECT id FROM suppliers WHERE normalized_name = :n"),
            {"n": normalized},
        )
        if existing:
            continue
        await conn.execute(
            text(
                "INSERT INTO suppliers (name, normalized_name, is_active, created_at, updated_at) "
                "VALUES (:name, :normalized, TRUE, now(), now())"
            ),
            {"name": display, "normalized": normalized},
        )
        created += 1
        print(f"  + supplier {display!r}")

    # 3. Link every document to its supplier. Matching on the normalized form is
    #    what merges the casing/spacing variants.
    linked = 0
    for table in NAME_SOURCES:
        exists = await conn.scalar(
            text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}
        )
        if not exists:
            continue
        result = await conn.execute(
            text(
                f"""
                UPDATE {table} AS d
                   SET supplier_id = s.id
                  FROM suppliers AS s
                 WHERE d.supplier_id IS NULL
                   AND d.supplier_name IS NOT NULL
                   AND btrim(d.supplier_name) <> ''
                   AND s.normalized_name = lower(regexp_replace(d.supplier_name, '\\s', '', 'g'))
                """
            )
        )
        count = result.rowcount or 0
        linked += count
        print(f"  ~ {table}: linked {count}")
    return created, linked


async def assign_codes(conn):
    """Give every supplier without a code a stable human-facing one (SUP-001...).

    Codes matter because a store keeper reads "SUP-014" off a delivery note far
    more reliably than a long company name.
    """
    rows = await conn.execute(
        text("SELECT id FROM suppliers WHERE code IS NULL OR code = '' ORDER BY id")
    )
    todo = [r[0] for r in rows]
    if not todo:
        print("  ~ all suppliers already have a code")
        return 0
    next_number = await conn.scalar(
        text(
            "SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) "
            "FROM suppliers WHERE code ~ '^SUP-[0-9]+$'"
        )
    ) or 0
    for supplier_id in todo:
        next_number += 1
        await conn.execute(
            text("UPDATE suppliers SET code = :c WHERE id = :i"),
            {"c": f"SUP-{next_number:03d}", "i": supplier_id},
        )
    print(f"  + assigned {len(todo)} code(s), up to SUP-{next_number:03d}")
    return len(todo)


async def main():
    url = settings.DATABASE_URL
    print("=" * 62)
    print(" OBM Sales Helper - v6 migration (supplier master data)")
    print(f" Database: {url.rsplit('@', 1)[-1]}")
    print("=" * 62)

    engine = create_async_engine(url, echo=False)

    print("\n[1/5] Creating any missing tables ...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print(f"  done ({', '.join(NEW_TABLES)} included)")

    print("\n[2/5] Adding missing columns ...")
    async with engine.begin() as conn:
        await add_columns(conn)

    print("\n[3/5] Ensuring indexes ...")
    async with engine.begin() as conn:
        await add_indexes(conn)

    print("\n[4/5] Importing existing supplier names ...")
    async with engine.begin() as conn:
        created, linked = await backfill_suppliers(conn)
    print(f"  {created} supplier(s) created, {linked} document(s) linked")

    print("\n[5/5] Assigning supplier codes ...")
    async with engine.begin() as conn:
        await assign_codes(conn)

    print("\nVerifying ...")
    async with engine.begin() as conn:
        present = await conn.scalar(
            text("SELECT to_regclass('public.suppliers') IS NOT NULL")
        )
        print(f"  suppliers table: {'ok' if present else 'MISSING'}")
        for table in COLUMNS:
            col = COLUMNS[table][0].split()[0]
            ok = await conn.scalar(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ),
                {"t": table, "c": col},
            )
            print(f"  {table}.{col}: {'ok' if ok else 'MISSING'}")
        total = await conn.scalar(text("SELECT COUNT(*) FROM suppliers"))
        unlinked = await conn.scalar(
            text(
                "SELECT COUNT(*) FROM purchase_orders "
                "WHERE supplier_name IS NOT NULL AND btrim(supplier_name) <> '' "
                "AND supplier_id IS NULL"
            )
        )
        print(f"  suppliers: {total} row(s)")
        print(f"  purchase_orders still unlinked: {unlinked}")

    await engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())
