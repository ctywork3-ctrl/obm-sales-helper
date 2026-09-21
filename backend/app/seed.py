import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer import Customer
from app.models.product import Product
from app.models.settings import Setting
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.models.warehouse import ReportTemplate, StockLocation
from app.services.auth import hash_password
from app.services.labels import DEFAULT_LABEL_CONFIG
from app.services.reporting import default_template_config


def default_label_config() -> dict:
    import copy

    return copy.deepcopy(DEFAULT_LABEL_CONFIG)



async def seed_database(db: AsyncSession):
    existing_dev = await db.execute(select(User).where(User.username == "developer"))
    if not existing_dev.scalar_one_or_none():
        developer = User(
            username="developer",
            full_name="System Developer",
            email="developer@obm.com",
            role="DEVELOPER",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
        )
        db.add(developer)

    existing_admin = await db.execute(select(User).where(User.username == "itadmin"))
    if not existing_admin.scalar_one_or_none():
        itadmin = User(
            username="itadmin",
            full_name="IT Administrator",
            email="itadmin@obm.com",
            role="IT_ADMIN",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
        )
        db.add(itadmin)

    existing_sales01 = await db.execute(select(User).where(User.username == "sales01"))
    if not existing_sales01.scalar_one_or_none():
        sales01 = User(
            username="sales01",
            full_name="Ahmad Razak",
            email="sales01@obm.com",
            role="OUTSIDE_SALES",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(sales01)

    existing_sales02 = await db.execute(select(User).where(User.username == "sales02"))
    if not existing_sales02.scalar_one_or_none():
        sales02 = User(
            username="sales02",
            full_name="Lim Wei Jie",
            email="sales02@obm.com",
            role="OUTSIDE_SALES",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(sales02)

    existing_inside01 = await db.execute(select(User).where(User.username == "inside01"))
    if not existing_inside01.scalar_one_or_none():
        inside01 = User(
            username="inside01",
            full_name="Siti Nurhaliza",
            email="inside01@obm.com",
            role="INSIDE_SALES",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(inside01)

    existing_stockkeeper01 = await db.execute(select(User).where(User.username == "stockkeeper01"))
    if not existing_stockkeeper01.scalar_one_or_none():
        stockkeeper01 = User(
            username="stockkeeper01",
            full_name="Ahmad Warehouse",
            email="stockkeeper01@obm.com",
            role="STOCK_KEEPER",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(stockkeeper01)

    existing_purchasemanager = await db.execute(
        select(User).where(User.username == "purchasemanager01")
    )
    if not existing_purchasemanager.scalar_one_or_none():
        purchasemanager01 = User(
            username="purchasemanager01",
            full_name="Siti Purchase Manager",
            email="purchasemanager01@obm.com",
            role="PURCHASE_MANAGER",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(purchasemanager01)

    existing_director = await db.execute(select(User).where(User.username == "director"))
    if not existing_director.scalar_one_or_none():
        director = User(
            username="director",
            full_name="Company Director",
            email="director@obm.com",
            role="DIRECTOR",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(director)

    existing_opsmanager = await db.execute(
        select(User).where(User.username == "operationsmanager01")
    )
    if not existing_opsmanager.scalar_one_or_none():
        operationsmanager01 = User(
            username="operationsmanager01",
            full_name="Operations Manager",
            email="operationsmanager01@obm.com",
            role="OPERATIONS_MANAGER",
            password_hash=hash_password("password123"),
            must_change_password=False,
            is_active=True,
            temp_password_display="password123",
        )
        db.add(operationsmanager01)

    default_settings = [
        {"key": "company_name", "value_json": {"value": "OBM Sales"}},
        {"key": "company_address", "value_json": {"value": ""}},
        {"key": "company_phone", "value_json": {"value": ""}},
        {"key": "company_email", "value_json": {"value": ""}},
        {"key": "company_reg_no", "value_json": {"value": ""}},
        {"key": "company_logo_url", "value_json": {"value": ""}},
        {"key": "company_bank_details", "value_json": {"value": ""}},
        {"key": "company_terms", "value_json": {"value": ""}},
        {"key": "default_currency", "value_json": {"value": "MYR"}},
        {"key": "max_order_items", "value_json": {"value": 50}},
        {"key": "order_prefix", "value_json": {"value": "SO"}},
        {"key": "enable_obm_sync", "value_json": {"value": False}},
        {"key": "discount_approval_threshold_percent", "value_json": {"value": 10}},
        {"key": "default_warranty_months", "value_json": {"value": 12}},
        {"key": "public_app_url", "value_json": {"value": ""}},
        {"key": "label_print_settings", "value_json": {"value": default_label_config()}},
    ]

    for setting_data in default_settings:
        existing = await db.execute(
            select(Setting).where(Setting.key == setting_data["key"])
        )
        if not existing.scalar_one_or_none():
            setting = Setting(**setting_data)
            db.add(setting)

    await _seed_customers(db)
    await _seed_products(db)
    await _seed_stock_locations(db)
    await _seed_report_templates(db)
    await db.commit()


async def _seed_customers(db: AsyncSession):
    existing = await db.execute(select(Customer).limit(1))
    if existing.scalar_one_or_none():
        return

    customers = [
        Customer(code="WALK-IN", name="Walk-in Customer", phone="-", email=None, address="-"),
        Customer(code="CUST-001", obm_customer_code="OBM-C001", name="Tackle Box fishing tackle", phone="03-2145 6789", email="info@tacklebox.com.my", address="12 Jalan Ipoh, 51200 Kuala Lumpur"),
        Customer(code="CUST-002", obm_customer_code="OBM-C002", name="Angler's Paradise Sdn Bhd", phone="03-7785 4321", email="sales@anglersparadise.com.my", address="88 Jalan SS2/60, 47300 Petaling Jaya, Selangor"),
        Customer(code="CUST-003", obm_customer_code="OBM-C003", name="Kedai Pancing Jaya", phone="04-283 9901", email="kedai.pancing.jaya@gmail.com", address="15 Jalan Burma, 10050 George Town, Penang"),
        Customer(code="CUST-004", obm_customer_code="OBM-C004", name="Ocean King Fishing Supply", phone="07-223 4567", email="oceanking@fishing.com.my", address="33 Jalan Wong Ah Fook, 80000 Johor Bahru, Johor"),
        Customer(code="CUST-005", obm_customer_code="OBM-C005", name="Sabah Bait & Tackle", phone="088-234 567", email="sabahbait@gmail.com", address="5 Lorong Damai, 88300 Kota Kinabalu, Sabah"),
        Customer(code="CUST-006", obm_customer_code="OBM-C006", name="Pancing Mania Enterprise", phone="05-321 8765", email="pancingmania@yahoo.com", address="22 Jalan Masjid, 30000 Ipoh, Perak"),
        Customer(code="CUST-007", obm_customer_code="OBM-C007", name="River Monster Outfitters", phone="09-612 3456", email="rivermonster@gmail.com", address="7 Jalan Hassan, 20000 Kuala Terengganu, Terengganu"),
        Customer(code="CUST-008", obm_customer_code="OBM-C008", name="Fish Pro Shop", phone="03-8723 1122", email="fishpro@fishing.com.my", address="99 Jalan Putra, 50300 Kuala Lumpur"),
        Customer(code="CUST-009", obm_customer_code="OBM-C009", name="Borneo Anglers Supply", phone="082-456 789", email="borneoanglers@gmail.com", address="45 Jalan Tun Jugah, 93350 Kuching, Sarawak"),
        Customer(code="CUST-010", obm_customer_code="OBM-C010", name="Deep Sea Direct Sdn Bhd", phone="03-5166 7890", email="deepsea@direct.com.my", address="120 Jalan Raja Chulan, 50200 Kuala Lumpur"),
    ]
    for c in customers:
        db.add(c)


async def _seed_products(db: AsyncSession):
    existing = await db.execute(select(Product).limit(1))
    if existing.scalar_one_or_none():
        return

    products = [
        # Equipment - Rods
        Product(obm_item_code="OBM-R001", item_code="SR-100M", name="Stingray Spinning Rod 100M", category="Equipment", brand="Stingray", uom="pcs", description="Medium power spinning rod, 7ft, ideal for freshwater and light saltwater fishing. Graphite blank with stainless steel guides.", selling_price=189.00, cost_price=95.00, stock_qty=45, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-R002", item_code="SR-200MH", name="Stingray Spinning Rod 200MH", category="Equipment", brand="Stingray", uom="pcs", description="Medium-heavy spinning rod, 7ft 6in, suitable for inshore saltwater. Carbon composite blank.", selling_price=249.00, cost_price=125.00, stock_qty=30, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-R003", item_code="CR-500H", name="Predator Casting Rod 500H", category="Equipment", brand="Predator", uom="pcs", description="Heavy power casting rod, 6ft 6in, designed for big bait fishing. Toray graphite with Fuji guides.", selling_price=329.00, cost_price=165.00, stock_qty=20, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-R004", item_code="TR-300M", name="Tornado Trolling Rod 300M", category="Equipment", brand="Tornado", uom="pcs", description="Medium trolling rod, 5ft 6in, fiberglass blank with roller tip top. Perfect for boat fishing.", selling_price=279.00, cost_price=140.00, stock_qty=15, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-R005", item_code="JR-100L", name="Junior Light Spinning Rod", category="Equipment", brand="Stingray", uom="pcs", description="Light power spinning rod, 5ft, great for kids and beginners. Durable EVA grip.", selling_price=89.00, cost_price=45.00, stock_qty=60, stock_source="MANUAL", is_active=True),

        # Equipment - Reels
        Product(obm_item_code="OBM-RL001", item_code="SR-4000F", name="Stingray Spinning Reel 4000F", category="Equipment", brand="Stingray", uom="pcs", description="Front drag spinning reel, 5+1 ball bearings, gear ratio 5.2:1. Aluminum spool with CNC handle.", selling_price=159.00, cost_price=80.00, stock_qty=40, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-RL002", item_code="SR-6000FS", name="Stingray Spinning Reel 6000FS", category="Equipment", brand="Stingray", uom="pcs", description="Heavy duty spinning reel, 6+1 ball bearings, gear ratio 4.7:1. Waterproof drag system.", selling_price=229.00, cost_price=115.00, stock_qty=25, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-RL003", item_code="BC-700H", name="Predator Baitcasting Reel 700H", category="Equipment", brand="Predator", uom="pcs", description="High speed baitcasting reel, 9+1 ball bearings, gear ratio 7.1:1. Magnetic brake system.", selling_price=289.00, cost_price=145.00, stock_qty=18, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-RL004", item_code="SC-200", name="EasyCast Spincast Reel", category="Equipment", brand="EasyCast", uom="pcs", description="Push-button spincast reel, 3.8:1 gear ratio. Beginner friendly with anti-reverse.", selling_price=69.00, cost_price=35.00, stock_qty=50, stock_source="MANUAL", is_active=True),

        # Accessories - Lures
        Product(obm_item_code="OBM-L001", item_code="SPL-3IN-R", name="Soft Plastic Grub 3in (Red)", category="Accessories", brand="StrikePro", uom="pcs", description="3 inch curly tail grub, pack of 10. Effective for bass and trout.", selling_price=12.90, cost_price=5.00, stock_qty=200, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-L002", item_code="HBL-5IN-S", name="Hard Body Minnow 5in (Silver)", category="Accessories", brand="StrikePro", uom="pcs", description="5 inch floating minnow lure, weight 12g, diving depth 1.5m. VMC treble hooks.", selling_price=18.90, cost_price=8.00, stock_qty=150, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-L003", item_code="SB-07G", name="Spinnerbait 7g (White)", category="Accessories", brand="StrikePro", uom="pcs", description="7g spinnerbait with Colorado and willow blade combo. Weedless design.", selling_price=15.90, cost_price=6.50, stock_qty=120, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-L004", item_code="JH-3/0-14G", name="Jig Head 3/0 Hook 14g", category="Accessories", brand="StrikePro", uom="pcs", description="14g jig head with 3/0 Owner hook. Pack of 5. Ideal for soft plastics.", selling_price=14.90, cost_price=6.00, stock_qty=180, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-L005", item_code="PL-7CM-W", name="Popper Lure 7cm (White)", category="Accessories", brand="Tornado", uom="pcs", description="7cm surface popper, weight 10g. Creates splash to attract predators.", selling_price=16.90, cost_price=7.00, stock_qty=100, stock_source="MANUAL", is_active=True),

        # Accessories - Hooks & Terminal
        Product(obm_item_code="OBM-H001", item_code="TH-3/0-10", name="Treble Hook 3/0 (10 pack)", category="Accessories", brand="Owner", uom="pcs", description="3/0 treble hook, black nickel finish. Ultra sharp, 10 per pack.", selling_price=12.90, cost_price=4.50, stock_qty=250, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-H002", item_code="CH-5/0-8", name="Circle Hook 5/0 (8 pack)", category="Accessories", brand="Owner", uom="pcs", description="5/0 circle hook for catch and release. 8 per pack. Chemically sharpened.", selling_price=14.90, cost_price=5.50, stock_qty=200, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-H003", item_code="SW-SS-10", name="Stainless Steel Swivel (10 pack)", category="Accessories", brand="OceanMax", uom="pcs", description="Size 10 stainless steel rolling swivel, 30kg rated. 10 per pack.", selling_price=8.90, cost_price=3.00, stock_qty=300, stock_source="MANUAL", is_active=True),

        # Consumables - Lines
        Product(obm_item_code="OBM-FL001", item_code="MF-300M-12", name="Monofilament Line 300m (12lb)", category="Consumables", brand="OceanMax", uom="pcs", description="300m monofilament line, 12lb test, clear. Low memory and high abrasion resistance.", selling_price=24.90, cost_price=10.00, stock_qty=80, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-FL002", item_code="BF-150M-30", name="Braided Line 150m (30lb)", category="Consumables", brand="OceanMax", uom="pcs", description="150m 8-strand braided line, 30lb test, moss green. Zero stretch for sensitivity.", selling_price=39.90, cost_price=18.00, stock_qty=60, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-FL003", item_code="FF-100M-16", name="Fluorocarbon Line 100m (16lb)", category="Consumables", brand="OceanMax", uom="pcs", description="100m fluorocarbon leader line, 16lb test. Nearly invisible underwater.", selling_price=34.90, cost_price=15.00, stock_qty=45, stock_source="MANUAL", is_active=True),

        # Consumables - Terminal Tackle
        Product(obm_item_code="OBM-TW001", item_code="LW-SET-20", name="Fishing Lead Weight Set (20 pcs)", category="Consumables", brand="OceanMax", uom="set", description="Assorted split shot weights, 2g to 10g. Lead-free eco-friendly material.", selling_price=12.90, cost_price=5.00, stock_qty=100, stock_source="MANUAL", is_active=True),

        # Spare Parts
        Product(obm_item_code="OBM-SP001", item_code="RH-UNI-01", name="Universal Reel Handle", category="Spare Parts", brand="Stingray", uom="pcs", description="Universal fit EVA knob reel handle. Fits most spinning reels size 2000-6000.", selling_price=29.90, cost_price=12.00, stock_qty=35, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-SP002", item_code="RS-4000", name="Replacement Spool 4000 Size", category="Spare Parts", brand="Stingray", uom="pcs", description="CNC aluminum replacement spool for Stingray 4000 series reels.", selling_price=39.90, cost_price=18.00, stock_qty=20, stock_source="MANUAL", is_active=True),
        Product(obm_item_code="OBM-SP003", item_code="RTT-6MM", name="Rod Tip Top Guide 6mm", category="Spare Parts", brand="Tornado", uom="pcs", description="6mm ceramic ring rod tip top guide. Fits most medium action rods.", selling_price=9.90, cost_price=4.00, stock_qty=50, stock_source="MANUAL", is_active=True),
    ]
    for p in products:
        db.add(p)
    await db.flush()

    for p in products:
        if (p.stock_qty or 0) > 0:
            db.add(StockMovement(
                product_id=p.id,
                quantity_delta=p.stock_qty,
                movement_type="PRODUCT_OPENING.receive",
                source_type="PRODUCT_OPENING",
                source_id=p.id,
                idempotency_key=f"PRODUCT_OPENING:{p.id}",
                reason="Opening stock (seed)",
            ))


async def _seed_stock_locations(db: AsyncSession):
    existing = await db.execute(select(StockLocation).limit(1))
    if existing.scalar_one_or_none():
        return

    locations = [
        StockLocation(code="SHOWROOM", name="Showroom", zone="SHOWROOM", notes="Front counter display stock"),
        StockLocation(code="WH-MAIN", name="Main Warehouse", zone="WAREHOUSE", notes="Bulk storage"),
        StockLocation(code="WH-RACK-A", name="Rack A - Rods", zone="RACK", notes="Long goods"),
        StockLocation(code="WH-RACK-B", name="Rack B - Reels & Small", zone="RACK"),
        StockLocation(code="RETURNS", name="Returns / Warranty", zone="RETURNS", notes="Items waiting on a warranty decision"),
        StockLocation(code="DAMAGED", name="Damaged Bin", zone="DAMAGED", notes="Not sellable"),
    ]
    for location in locations:
        db.add(location)
    await db.flush()


async def _seed_report_templates(db: AsyncSession):
    existing = await db.execute(select(ReportTemplate).limit(1))
    if existing.scalar_one_or_none():
        return

    from app.services.reporting import DOC_TYPES

    for doc_type in DOC_TYPES:
        db.add(ReportTemplate(
            name=f"Default {doc_type['label']} (A4)",
            doc_type=doc_type["key"],
            paper_size="A4",
            orientation="portrait",
            config_json=json.dumps(default_template_config(doc_type["key"])),
            is_default=True,
            is_active=True,
            notes="Seeded default layout",
        ))
    await db.flush()
