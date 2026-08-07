from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.user import User
from app.permissions import Permissions
from app.schemas.user import AssignRoleRequest, UserCreate, UserResponse, UserUpdate
from app.services.audit import AuditService
from app.services.auth import hash_password
from app.services.password import generate_temporary_password, validate_password_policy

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_VIEW)),
):
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [UserResponse.model_validate(u) for u in users]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_MANAGE)),
):
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    temp_password = body.password or generate_temporary_password()
    valid, msg = validate_password_policy(temp_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=msg,
        )

    user = User(
        username=body.username,
        full_name=body.full_name,
        email=body.email,
        phone=body.phone,
        role=body.role,
        password_hash=hash_password(temp_password),
        must_change_password=True,
    )
    db.add(user)
    await db.flush()

    await AuditService.log(
        db=db,
        action="users.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="user",
        entity_id=user.id,
        entity_label=user.username,
        new_values={"username": user.username, "role": user.role},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.get("/credentials")
async def get_user_credentials(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_MANAGE)),
):
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "role": u.role,
            "temp_password": u.temp_password_display,
        }
        for u in users
    ]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_VIEW)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse.model_validate(user)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_MANAGE)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    old_values = {
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
    }

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)

    await AuditService.log(
        db=db,
        action="users.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="user",
        entity_id=user.id,
        entity_label=user.username,
        old_values=old_values,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_MANAGE)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_active = True

    await AuditService.log(
        db=db,
        action="users.activate",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="user",
        entity_id=user.id,
        entity_label=user.username,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_MANAGE)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself",
        )

    user.is_active = False

    await AuditService.log(
        db=db,
        action="users.deactivate",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="user",
        entity_id=user.id,
        entity_label=user.username,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/{user_id}/assign-role", response_model=UserResponse)
async def assign_role(
    user_id: int,
    body: AssignRoleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.USERS_ROLE_ASSIGN)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    old_role = user.role
    user.role = body.role

    await AuditService.log(
        db=db,
        action="users.role.assign",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="user",
        entity_id=user.id,
        entity_label=user.username,
        old_values={"role": old_role},
        new_values={"role": body.role},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)
