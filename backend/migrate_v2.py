"""One-shot, idempotent migration for the v1 -> v2 feature drop.

Adds:
  * sales-order discount columns (order level and line level)
  * product warranty term + reorder level
  * product-unit serial/warranty/location columns
  * new tables: stock_locations, receiving_tasks, receiving_task_lines,
    receiving_task_scans, warranty_claims, report_templates
  * the role restructure: manager01 -> purchasemanager01 (password kept),
    plus new director and operationsmanager01 logins
  * seed data for stock locations, report templates and new settings

Safe to run repeatedly. Run it with the same Python that runs the backend:

    cd "F:\\season takle webapp\\backend"
    "C:\\Users\\chiam\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" migrate_v2.py
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402

# Import every model module so Base.metadata knows about the new tables.
import app.models  # noqa: F401,E402
from app.models.settings import Setting  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.services.reporting import DOC_TYPES, default_template_config  # noqa: E402

# --- column additions ------------------------------------------------------
# Postgres supports ADD COLUMN IF NOT EXISTS, so this is naturally idempotent.

COLUMNS: dict[str, list[str]] = {
    "sales_orders": [
        "gross_subtotal NUMERIC(12,2) DEFAULT 0",
        "discount_type VARCHAR(10) DEFAULT 'NONE'",
        "discount_value NUMERIC(12,2) DEFAULT 0",
        "line_discount_total NUMERIC(12,2) DEFAULT 0",
        "order_discount_amount NUMERIC(12,2) DEFAULT 0",
        "discount_total NUMERIC(12,2) DEFAULT 0",
        "discount_reason VARCHAR(255)",
        "discount_requires_approval BOOLEAN DEFAULT FALSE",
    ],
    "sales_order_items": [
        "gross_amount NUMERIC(12,2) DEFAULT 0",
        "discount_type VARCHAR(10) DEFAULT 'NONE'",
        "discount_value NUMERIC(12,2) DEFAULT 0",
        "order_discount_share NUMERIC(12,2) DEFAULT 0",
    ],
    "products": [
        "warranty_months INTEGER",
        "reorder_level INTEGER DEFAULT 10",
    ],
    "product_units": [
        "condition VARCHAR(20) DEFAULT 'NEW'",
        "location_id INTEGER",
        "customer_id INTEGER",
        "receiving_task_line_id INTEGER",
        "unit_cost NUMERIC(12,2)",
        "warranty_months INTEGER",
        "warranty_start TIMESTAMPTZ",
        "warranty_end TIMESTAMPTZ",
        "warranty_void_reason VARCHAR(255)",
        "notes TEXT",
    ],
}

# Foreign keys applied after the columns exist (and after create_all has made
# the referenced tables).
FOREIGN_KEYS: list[tuple[str, str, str, str]] = [
    ("product_units", "location_id", "stock_locations", "id"),
    ("product_units", "customer_id", "customers", "id"),
    ("product_units", "receiving_task_line_id", "receiving_task_lines", "id"),
]

NEW_SETTINGS = [
    {"key": "company_address", "value": {"value": ""}},
    {"key": "company_phone", "value": {"value": ""}},
    {"key": "company_email", "value": {"value": ""}},
    {"key": "company_reg_no", "value": {"value": ""}},
    {"key": "company_logo_url", "value": {"value": ""}},
    {"key": "company_bank_details", "value": {"value": ""}},
    {"key": "company_terms", "value": {"value": ""}},
    {"key": "discount_approval_threshold_percent", "value": {"value": 10}},
    {"key": "default_warranty_months", "value": {"value": 12}},
]

NEW_USERS = [
    {
        "username": "director",
        "full_name": "Company Director",
        "email": "director@obm.com",
        "role": "DIRECTOR",
    },
    {
        "username": "operationsmanager01",
        "full_name": "Operations Manager",
        "email": "operationsmanager01@obm.com",
        "role": "OPERATIONS_MANAGER",
    },
]

STOCK_LOCATIONS = [
    ("SHOWROOM", "Showroom", "SHOWROOM", "Front counter display stock"),
    ("WH-MAIN", "Main Warehouse", "WAREHOUSE", "Bulk storage"),
    ("WH-RACK-A", "Rack A - Rods", "RACK", "Long goods"),
    ("WH-RACK-B", "Rack B - Reels & Small", "RACK", None),
    ("RETURNS", "Returns / Warranty", "RETURNS", "Items waiting on a warranty decision"),
    ("DAMAGED", "Damaged Bin", "DAMAGED", "Not sellable"),
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

    for table, column, ref_table, ref_column in FOREIGN_KEYS:
        try:
            constraint = f"fk_{table}_{column}"
            await conn.execute(text(
                f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}"
            ))
            await conn.execute(text(
                f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
                f"FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) ON DELETE SET NULL"
            ))
            print(f"  ~ fk {table}.{column} -> {ref_table}.{ref_column}")
        except Exception as exc:  # pragma: no cover
            print(f"  ! fk {table}.{column} skipped: {exc}")


async def restructure_users(db: AsyncSession):
    # manager01 becomes the purchase manager. The password hash is untouched,
    # so manager01's existing password keeps working.
    old = (await db.execute(select(User).where(User.username == "manager01"))).scalar_one_or_none()
    target = (
        await db.execute(select(User).where(User.username == "purchasemanager01"))
    ).scalar_one_or_none()

    if old and not target:
        old.username = "purchasemanager01"
        old.role = "PURCHASE_MANAGER"
        if not old.email or old.email == "manager01@obm.com":
            old.email = "purchasemanager01@obm.com"
        print("  ~ manager01 renamed to purchasemanager01 (password unchanged)")
    elif old and target:
        print("  = purchasemanager01 already exists; leaving manager01 alone")
    else:
        print("  = manager01 not found")

    for spec in NEW_USERS:
        existing = (
            await db.execute(select(User).where(User.username == spec["username"]))
        ).scalar_one_or_none()
        if existing:
            print(f"  = user {spec['username']} already exists")
            continue
        db.add(User(
            username=spec["username"],
            full_name=spec["full_name"],
            email=spec["email"],
            role=spec["role"],
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        ))
        print(f"  + user {spec['username']} ({spec['role']}) password123")

    await db.flush()


async def seed_settings(db: AsyncSession):
    for spec in NEW_SETTINGS:
        existing = (
            await db.execute(select(Setting).where(Setting.key == spec["key"]))
        ).scalar_one_or_none()
        if existing:
            continue
        db.add(Setting(key=spec["key"], value_json=spec["value"]))
        print(f"  + setting {spec['key']}")
    await db.flush()


async def seed_locations_and_templates(db: AsyncSession):
    from app.models.warehouse import ReportTemplate, StockLocation

    existing_locations = (await db.execute(select(StockLocation).limit(1))).scalar_one_or_none()
    if not existing_locations:
        for code, name, zone, notes in STOCK_LOCATIONS:
            db.add(StockLocation(code=code, name=name, zone=zone, notes=notes))
        print(f"  + {len(STOCK_LOCATIONS)} stock locations")

    existing_templates = (await db.execute(select(ReportTemplate).limit(1))).scalar_one_or_none()
    if not existing_templates:
        for entry in DOC_TYPES:
            db.add(ReportTemplate(
                name=f"Default {entry['label']} (A4)",
                doc_type=entry["key"],
                paper_size="A4",
                orientation="portrait",
                config_json=json.dumps(default_template_config(entry["key"])),
                is_default=True,
                is_active=True,
                notes="Seeded default layout",
            ))
        print(f"  + {len(DOC_TYPES)} report templates")

    await db.flush()


async def backfill_discount_columns(conn):
    """Give existing orders sensible values in the new columns."""
    await conn.execute(text(
        "UPDATE sales_orders SET gross_subtotal = COALESCE(subtotal_amount, 0) "
        "WHERE gross_subtotal IS NULL OR gross_subtotal = 0"
    ))
    await conn.execute(text(
        "UPDATE sales_orders SET discount_type = 'NONE' WHERE discount_type IS NULL"
    ))
    await conn.execute(text(
        "UPDATE sales_orders SET discount_requires_approval = FALSE "
        "WHERE discount_requires_approval IS NULL"
    ))
    await conn.execute(text(
        "UPDATE sales_order_items SET gross_amount = COALESCE(quantity,0) * COALESCE(unit_price,0) "
        "WHERE gross_amount IS NULL OR gross_amount = 0"
    ))
    await conn.execute(text(
        "UPDATE sales_order_items SET discount_type = 'NONE' WHERE discount_type IS NULL"
    ))
    await conn.execute(text(
        "UPDATE product_units SET condition = 'NEW' WHERE condition IS NULL"
    ))
    await conn.execute(text(
        "UPDATE products SET reorder_level = 10 WHERE reorder_level IS NULL"
    ))
    print("  ~ backfilled discount columns on existing rows")


async def repair_serialized_stock(conn):
    """For SERIALIZED products, stock_qty must equal the AVAILABLE unit count.

    Any product switched to serialized tracking before this migration still
    carries its old bulk figure, which makes every stock screen lie. Recompute
    it from the units that actually exist.
    """
    result = await conn.execute(text(
        """
        UPDATE products p
        SET stock_qty = COALESCE(u.available, 0)
        FROM (
            SELECT p2.id AS product_id,
                   (SELECT COUNT(*) FROM product_units pu
                     WHERE pu.product_id = p2.id AND pu.status = 'AVAILABLE') AS available
            FROM products p2
            WHERE UPPER(COALESCE(p2.inventory_model, 'BULK')) = 'SERIALIZED'
        ) u
        WHERE p.id = u.product_id
          AND COALESCE(p.stock_qty, -1) <> COALESCE(u.available, 0)
        """
    ))
    print(f"  ~ recomputed stock_qty for {result.rowcount} serialized product(s)")


async def main():
    url = settings.DATABASE_URL
    print("=" * 62)
    print(" OBM Sales Helper - v2 migration")
    print(f" Database: {url.rsplit('@', 1)[-1]}")
    print("=" * 62)

    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("\n[1/6] Creating any missing tables ...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  done")

    print("\n[2/6] Adding missing columns ...")
    async with engine.begin() as conn:
        await add_columns(conn)

    print("\n[3/7] Backfilling existing rows ...")
    async with engine.begin() as conn:
        await backfill_discount_columns(conn)

    print("\n[4/7] Repairing serialized stock counts ...")
    async with engine.begin() as conn:
        await repair_serialized_stock(conn)

    print("\n[5/7] Restructuring users and roles ...")
    async with session_factory() as db:
        await restructure_users(db)
        await db.commit()

    print("\n[6/7] Seeding settings, locations and report templates ...")
    async with session_factory() as db:
        await seed_settings(db)
        await seed_locations_and_templates(db)
        await db.commit()

    print("\n[7/7] Verifying ...")
    async with session_factory() as db:
        users = (await db.execute(select(User).order_by(User.id))).scalars().all()
        print("  Users:")
        for user in users:
            if user.username.startswith("e2etmp"):
                continue
            print(f"    {user.username:24} {user.role:20} active={user.is_active}")

    await engine.dispose()
    print("\nMigration complete.")
    print("  purchasemanager01 / password123   (was manager01, same password)")
    print("  director          / password123")
    print("  operationsmanager01 / password123")


if __name__ == "__main__":
    asyncio.run(main())
