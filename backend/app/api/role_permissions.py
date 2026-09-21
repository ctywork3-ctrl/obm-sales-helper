from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.role_permission import RolePermission
from app.models.user import User
from app.permissions import Permissions
from app.schemas.role_permission import (
    RolePermissionCreate,
    RolePermissionResponse,
    RolePermissionsByRole,
)

router = APIRouter(prefix="/api/role-permissions", tags=["role-permissions"])

DEFAULT_PAGES = [
    {"page_key": "dashboard", "label": "Dashboard"},
    {"page_key": "products", "label": "Products (Catalog)"},
    {"page_key": "sales_customers", "label": "My Customers"},
    {"page_key": "sales_create", "label": "Create Order"},
    {"page_key": "sales_my_orders", "label": "My Orders"},
    {"page_key": "sales_templates", "label": "Order Templates"},
    {"page_key": "sales_all_orders", "label": "All Orders"},
    {"page_key": "warehouse_hub", "label": "Stock Overview"},
    {"page_key": "warehouse_receiving_tasks", "label": "Receiving Tasks"},
    {"page_key": "warehouse_scanner", "label": "Scan Item"},
    {"page_key": "warehouse_receiving", "label": "Goods Received"},
    {"page_key": "warehouse_adjustment", "label": "Fix Stock Count"},
    {"page_key": "warehouse_receipts", "label": "Received History"},
    {"page_key": "warehouse_locations", "label": "Locations"},
    {"page_key": "warehouse_warranty", "label": "Warranty Lookup"},
    {"page_key": "warehouse_labels", "label": "Label Printing"},
    {"page_key": "warehouse_stock_takes", "label": "Stock Takes"},
    {"page_key": "warehouse_transfers", "label": "Stock Transfers"},
    {"page_key": "receiving_discrepancies", "label": "Receiving Discrepancies"},
    {"page_key": "purchase_orders", "label": "Supplier PO"},
    {"page_key": "admin_users", "label": "Admin: Users"},
    {"page_key": "admin_products", "label": "Admin: Products"},
    {"page_key": "admin_categories", "label": "Admin: Categories"},
    {"page_key": "admin_intake_requests", "label": "Admin: New Item Requests"},
    {"page_key": "admin_customers", "label": "Admin: Customers"},
    {"page_key": "admin_audit_logs", "label": "Admin: Activity / Audit Logs"},
    {"page_key": "admin_reports", "label": "Admin: Reports"},
    {"page_key": "admin_report_designer", "label": "Admin: Report Design Centre"},
    {"page_key": "admin_settings", "label": "Admin: Settings"},
    {"page_key": "admin_role_permissions", "label": "Admin: Menu Access"},
]

_WAREHOUSE_PAGES = {
    "warehouse_hub", "warehouse_receiving_tasks", "warehouse_scanner",
    "warehouse_receiving", "warehouse_adjustment", "warehouse_receipts",
    "warehouse_locations", "warehouse_warranty", "warehouse_labels", "warehouse_stock_takes",
    "warehouse_transfers",
}

# Default page visibility per role. Matches the hardcoded role gates in the
# sidebar/navigation so a fresh database starts with the intended matrix.
ROLE_PAGE_DEFAULTS: dict[str, set[str]] = {
    "DEVELOPER": {
        "dashboard", "products",
        "sales_all_orders",
        *_WAREHOUSE_PAGES,
        "purchase_orders",
        "admin_users", "admin_products", "admin_categories", "admin_intake_requests",
        "admin_customers", "admin_audit_logs", "admin_reports", "admin_report_designer",
        "admin_settings", "admin_role_permissions",
    },
    "IT_ADMIN": {
        "dashboard", "products",
        "sales_all_orders",
        *_WAREHOUSE_PAGES,
        "purchase_orders",
        "admin_users", "admin_products", "admin_categories", "admin_intake_requests",
        "admin_customers", "admin_audit_logs", "admin_reports", "admin_report_designer",
        "admin_settings", "admin_role_permissions",
    },
    "DIRECTOR": {
        "dashboard", "products",
        "sales_all_orders",
        "warehouse_hub", "warehouse_receiving_tasks", "warehouse_warranty",
        "receiving_discrepancies",
        "purchase_orders",
        "admin_reports", "admin_report_designer", "admin_audit_logs",
    },
    "OPERATIONS_MANAGER": {
        "dashboard", "products",
        "sales_all_orders",
        *_WAREHOUSE_PAGES,
        "purchase_orders",
        "admin_products", "admin_categories", "admin_intake_requests",
        "admin_customers", "admin_audit_logs", "admin_reports", "admin_report_designer",
        "receiving_discrepancies",
    },
    "PURCHASE_MANAGER": {
        "dashboard", "products",
        "sales_all_orders",
        "warehouse_hub", "warehouse_receiving_tasks", "warehouse_receiving",
        "warehouse_receipts", "warehouse_locations", "warehouse_warranty", "warehouse_scanner",
        "warehouse_labels", "warehouse_stock_takes", "warehouse_transfers",
        "purchase_orders",
        "receiving_discrepancies",
        "admin_intake_requests", "admin_reports",
    },
    "INSIDE_SALES": {
        "dashboard", "products",
        "sales_customers", "sales_all_orders",
        "admin_customers", "admin_reports",
    },
    "OUTSIDE_SALES": {
        "dashboard", "products",
        "sales_customers", "sales_create", "sales_my_orders", "sales_templates",
    },
    "STOCK_KEEPER": {
        "dashboard", "products",
        "warehouse_hub", "warehouse_receiving_tasks", "warehouse_scanner",
        "warehouse_receiving", "warehouse_adjustment", "warehouse_receipts",
        "warehouse_locations", "warehouse_warranty", "warehouse_labels", "warehouse_stock_takes",
        "warehouse_transfers",
        "purchase_orders",
    },
    "MANAGER": {
        "dashboard", "products",
        "sales_all_orders",
        *_WAREHOUSE_PAGES,
        "purchase_orders",
        "admin_products", "admin_categories", "admin_intake_requests",
        "admin_customers", "admin_reports", "admin_report_designer",
    },
}

ALL_ROLES = [
    "DEVELOPER", "IT_ADMIN", "DIRECTOR", "OPERATIONS_MANAGER", "PURCHASE_MANAGER",
    "MANAGER", "INSIDE_SALES", "OUTSIDE_SALES", "STOCK_KEEPER",
]


def _default_visible(role: str, page_key: str) -> bool:
    return page_key in ROLE_PAGE_DEFAULTS.get(role, set())


@router.get("", response_model=list[RolePermissionsByRole])
async def get_all_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.PRODUCTS_VIEW)),
):
    for role in ALL_ROLES:
        existing = await db.execute(
            select(RolePermission).where(RolePermission.role == role).limit(1)
        )
        if not existing.scalar_one_or_none():
            for page in DEFAULT_PAGES:
                db.add(RolePermission(
                    role=role,
                    page_key=page["page_key"],
                    label=page["label"],
                    is_visible=_default_visible(role, page["page_key"]),
                ))
            await db.flush()
        else:
            existing_pages = await db.execute(
                select(RolePermission.page_key).where(RolePermission.role == role)
            )
            existing_keys = {r[0] for r in existing_pages.all()}
            for page in DEFAULT_PAGES:
                if page["page_key"] not in existing_keys:
                    db.add(RolePermission(
                        role=role,
                        page_key=page["page_key"],
                        label=page["label"],
                        # New pages added later follow the role default instead
                        # of silently becoming visible to everyone.
                        is_visible=_default_visible(role, page["page_key"]),
                    ))
            await db.flush()
    await db.commit()

    result = await db.execute(
        select(RolePermission).order_by(RolePermission.role, RolePermission.id)
    )
    all_perms = result.scalars().all()

    role_map: dict[str, list[RolePermissionResponse]] = {}
    for p in all_perms:
        if p.role not in role_map:
            role_map[p.role] = []
        role_map[p.role].append(RolePermissionResponse.model_validate(p))

    return [
        RolePermissionsByRole(role=role, pages=role_map.get(role, []))
        for role in ALL_ROLES
    ]


@router.get("/{role}", response_model=list[RolePermissionResponse])
async def get_permissions_for_role(
    role: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_VIEW)),
):
    result = await db.execute(
        select(RolePermission)
        .where(RolePermission.role == role)
        .order_by(RolePermission.id)
    )
    perms = result.scalars().all()
    return [RolePermissionResponse.model_validate(p) for p in perms]


@router.put("/{role}")
async def update_permissions_for_role(
    role: str,
    body: list[RolePermissionCreate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_MANAGE)),
):
    if role not in ALL_ROLES:
        raise HTTPException(status_code=404, detail=f"Unknown role: {role}")
    await db.execute(
        delete(RolePermission).where(RolePermission.role == role)
    )
    for perm in body:
        db.add(RolePermission(
            role=role,
            page_key=perm.page_key,
            label=perm.label,
            is_visible=perm.is_visible,
        ))
    await db.commit()
    return {"message": f"Permissions updated for role {role}"}


@router.post("/reset-defaults")
async def reset_permissions_to_defaults(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_MANAGE)),
):
    await db.execute(delete(RolePermission))
    for role in ALL_ROLES:
        for page in DEFAULT_PAGES:
            db.add(RolePermission(
                role=role,
                page_key=page["page_key"],
                label=page["label"],
                is_visible=_default_visible(role, page["page_key"]),
            ))
    await db.commit()
    return {"message": "Role page permissions reset to defaults"}
