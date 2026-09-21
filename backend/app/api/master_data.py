from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.master_data import Brand, Supplier, TaxProfile, normalize_supplier_name
from app.models.ecommerce import ProductCategory
from app.models.user import User
from app.permissions import Permissions
from app.services.audit import AuditService

router = APIRouter(prefix="/api/master-data", tags=["master-data"])


def _category_slug(name: str) -> str:
    return "-".join("".join(char.lower() if char.isalnum() else " " for char in name).split())


@router.get("/categories")
async def list_categories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ProductCategory)
        .where(ProductCategory.is_active == True)
        .order_by(ProductCategory.sort_order, ProductCategory.name)
    )
    return [
        {
            "id": category.id,
            "name": category.name,
            "slug": category.slug,
            "description": category.description,
            "parent_id": category.parent_id,
            "sort_order": category.sort_order,
        }
        for category in result.scalars().all()
    ]


@router.post("/categories", status_code=status.HTTP_201_CREATED)
async def create_category(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    slug = body.get("slug", "").strip().lower() or _category_slug(name)
    existing = await db.execute(select(ProductCategory).where(ProductCategory.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Category already exists")
    category = ProductCategory(
        name=name,
        slug=slug,
        description=body.get("description"),
        parent_id=body.get("parent_id"),
        sort_order=body.get("sort_order", 0),
        is_active=True,
    )
    db.add(category)
    await db.flush()
    await AuditService.log(
        db=db,
        action="master_data.category.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_category",
        entity_id=category.id,
        entity_label=category.name,
        new_values={"name": category.name, "slug": category.slug},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"id": category.id, "name": category.name, "slug": category.slug}


@router.patch("/categories/{category_id}")
async def update_category(
    category_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    result = await db.execute(select(ProductCategory).where(ProductCategory.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    for field in ("name", "description", "parent_id", "sort_order", "is_active"):
        if field in body:
            setattr(category, field, body[field])
    if "name" in body and body["name"]:
        category.slug = body.get("slug") or _category_slug(body["name"])
    await AuditService.log(
        db=db,
        action="master_data.category.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="product_category",
        entity_id=category.id,
        entity_label=category.name,
        new_values=body,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"id": category.id, "name": category.name, "slug": category.slug, "is_active": category.is_active}


@router.get("/brands")
async def list_brands(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Brand).where(Brand.is_active == True).order_by(Brand.name)
    )
    brands = result.scalars().all()
    return [
        {"id": b.id, "name": b.name, "normalized_name": b.normalized_name, "is_active": b.is_active}
        for b in brands
    ]


@router.post("/brands", status_code=status.HTTP_201_CREATED)
async def create_brand(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_MANAGE)),
):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Brand name is required")

    normalized = name.lower().replace(" ", "")
    existing = await db.execute(select(Brand).where(Brand.normalized_name == normalized))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Brand already exists")

    brand = Brand(name=name, normalized_name=normalized, created_by=current_user.id)
    db.add(brand)
    await db.flush()

    await AuditService.log(
        db=db, action="master_data.brand.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="brand", entity_id=brand.id, entity_label=name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"id": brand.id, "name": brand.name, "normalized_name": brand.normalized_name}


@router.get("/tax-profiles")
async def list_tax_profiles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TaxProfile).where(TaxProfile.is_active == True).order_by(TaxProfile.country, TaxProfile.rate)
    )
    profiles = result.scalars().all()
    return [
        {
            "id": p.id, "code": p.code, "name": p.name,
            "country": p.country, "currency": p.currency,
            "tax_type": p.tax_type, "rate": p.rate,
            "price_includes_tax": p.price_includes_tax,
        }
        for p in profiles
    ]


@router.post("/tax-profiles", status_code=status.HTTP_201_CREATED)
async def create_tax_profile(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_MANAGE)),
):
    code = body.get("code", "").strip().upper()
    name = body.get("name", "").strip()
    country = body.get("country", "").strip().upper()
    currency = body.get("currency", "MYR").strip().upper()
    rate = body.get("rate", 0)

    if not code or not name or not country:
        raise HTTPException(status_code=400, detail="code, name, and country are required")

    existing = await db.execute(select(TaxProfile).where(TaxProfile.code == code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tax profile code already exists")

    profile = TaxProfile(
        code=code, name=name, country=country, currency=currency,
        tax_type=body.get("tax_type", "SALES_TAX"),
        rate=rate,
        price_includes_tax=body.get("price_includes_tax", False),
    )
    db.add(profile)
    await db.flush()

    await AuditService.log(
        db=db, action="master_data.tax_profile.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="tax_profile", entity_id=profile.id, entity_label=code,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return {"id": profile.id, "code": profile.code, "name": profile.name}


# ---------------------------------------------------------------------------
# Suppliers
#
# Suppliers are grouped, not free text, because the receiving-discrepancy queue
# groups by supplier (see api/warehouse_ops.py). Before this existed,
# "Mismatch Supplier" and "mismatch supplier" were two different vendors, so
# nobody could see how many shortages one vendor actually owed.
#
# Identity is `normalized_name` (lowercase, whitespace stripped), exactly like
# `Brand`. `supplier_name` on a PO/receipt is the historical snapshot and is
# never rewritten when a supplier is renamed.
# ---------------------------------------------------------------------------


def _supplier_payload(s: Supplier) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "contact_person": s.contact_person,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        "notes": s.notes,
        "obm_supplier_code": s.obm_supplier_code,
        "is_active": s.is_active,
    }


@router.get("/suppliers")
async def list_suppliers(
    q: str | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SUPPLIERS_VIEW)),
):
    """List suppliers, optionally filtered by a search term.

    The search matches the normalized form too, so typing "mismatch supplier"
    in any casing or spacing finds the one real vendor.
    """
    query = select(Supplier)
    if not include_inactive:
        query = query.where(Supplier.is_active == True)

    if q and q.strip():
        term = q.strip()
        normalized = normalize_supplier_name(term)
        query = query.where(
            (Supplier.name.ilike(f"%{term}%"))
            | (Supplier.normalized_name.like(f"%{normalized}%"))
            | (Supplier.code.ilike(f"%{term}%"))
        )

    result = await db.execute(query.order_by(Supplier.name))
    return [_supplier_payload(s) for s in result.scalars().all()]


@router.get("/suppliers/{supplier_id}")
async def get_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SUPPLIERS_VIEW)),
):
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return _supplier_payload(supplier)


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
async def create_supplier(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SUPPLIERS_MANAGE)),
):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name is required")

    normalized = normalize_supplier_name(name)
    if not normalized:
        raise HTTPException(status_code=400, detail="Supplier name is required")

    existing = await db.execute(select(Supplier).where(Supplier.normalized_name == normalized))
    clash = existing.scalar_one_or_none()
    if clash:
        # 409 with the real id, so the caller can immediately use the existing
        # supplier instead of inventing a near-duplicate.
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Supplier already exists as {clash.name!r} ({clash.code or 'no code'})",
                "supplier_id": clash.id,
            },
        )

    supplier = Supplier(
        name=name,
        normalized_name=normalized,
        contact_person=(body.get("contact_person") or "").strip() or None,
        phone=(body.get("phone") or "").strip() or None,
        email=(body.get("email") or "").strip() or None,
        address=(body.get("address") or "").strip() or None,
        notes=(body.get("notes") or "").strip() or None,
        obm_supplier_code=(body.get("obm_supplier_code") or "").strip() or None,
        code=(body.get("code") or "").strip() or None,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(supplier)
    await db.flush()

    # Give it a human-facing code (SUP-005...) if the caller did not supply one.
    if not supplier.code:
        highest = await db.execute(
            select(Supplier.code).where(Supplier.code.like("SUP-%")).order_by(Supplier.code.desc())
        )
        top = highest.scalars().first()
        try:
            number = int(str(top).split("-")[1]) + 1 if top else 1
        except (IndexError, ValueError):
            number = 1
        supplier.code = f"SUP-{number:03d}"
        await db.flush()

    await AuditService.log(
        db=db, action="master_data.supplier.create",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="supplier", entity_id=supplier.id, entity_label=supplier.name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return _supplier_payload(supplier)


@router.patch("/suppliers/{supplier_id}")
async def update_supplier(
    supplier_id: int,
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SUPPLIERS_MANAGE)),
):
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Supplier name cannot be blank")
        normalized = normalize_supplier_name(name)
        clash = await db.execute(
            select(Supplier).where(Supplier.normalized_name == normalized, Supplier.id != supplier.id)
        )
        other = clash.scalar_one_or_none()
        if other:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"Another supplier already uses that name: {other.name!r} ({other.code or 'no code'})",
                    "supplier_id": other.id,
                },
            )
        supplier.name = name
        supplier.normalized_name = normalized

    for field in ("contact_person", "phone", "email", "address", "notes", "obm_supplier_code", "code"):
        if field in body:
            value = body.get(field)
            value = value.strip() if isinstance(value, str) else value
            setattr(supplier, field, value or None)

    if "is_active" in body:
        supplier.is_active = bool(body["is_active"])

    supplier.updated_by = current_user.id
    await db.flush()

    await AuditService.log(
        db=db, action="master_data.supplier.update",
        actor_user_id=current_user.id, actor_role_at_time=current_user.role,
        entity_type="supplier", entity_id=supplier.id, entity_label=supplier.name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return _supplier_payload(supplier)


@router.get("/suppliers/{supplier_id}/discrepancies")
async def supplier_discrepancies(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SUPPLIERS_VIEW)),
):
    """How much this one supplier currently owes us, across every delivery.

    This is the question the free-text design made unanswerable: it needs the
    counts grouped by the real vendor, not by whatever string was typed.
    """
    from app.models.warehouse import ReceivingDiscrepancy

    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    result = await db.execute(
        select(ReceivingDiscrepancy).where(ReceivingDiscrepancy.supplier_id == supplier_id)
    )
    rows = result.scalars().all()
    open_rows = [r for r in rows if r.status not in ("RESOLVED", "REJECTED")]
    return {
        "supplier": _supplier_payload(supplier),
        "total": len(rows),
        "open": len(open_rows),
        "outstanding_units": sum(int(r.difference or 0) for r in open_rows),
        "items": [
            {
                "id": r.id,
                "status": r.status,
                "direction": r.direction,
                "quantity_expected": r.quantity_expected,
                "quantity_scanned": r.quantity_scanned,
                "difference": r.difference,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }
