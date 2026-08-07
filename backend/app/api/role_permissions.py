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
    {"page_key": "sales_all_orders", "label": "All Orders"},
    {"page_key": "admin_users", "label": "Admin: Users"},
    {"page_key": "admin_products", "label": "Admin: Products"},
    {"page_key": "admin_customers", "label": "Admin: Customers"},
    {"page_key": "admin_audit_logs", "label": "Admin: Audit Logs"},
    {"page_key": "admin_settings", "label": "Admin: Settings"},
    {"page_key": "admin_role_permissions", "label": "Admin: Role Permissions"},
]

ALL_ROLES = ["DEVELOPER", "IT_ADMIN", "INSIDE_SALES", "OUTSIDE_SALES"]


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
                    is_visible=True,
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
                        is_visible=True,
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
