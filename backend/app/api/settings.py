from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.settings import Setting
from app.models.user import User
from app.permissions import Permissions
from app.schemas.settings import SettingResponse, SettingUpdate, SettingsListResponse
from app.services.audit import AuditService

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsListResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_VIEW)),
):
    result = await db.execute(select(Setting).order_by(Setting.key))
    settings = result.scalars().all()
    return SettingsListResponse(
        items=[SettingResponse.model_validate(s) for s in settings]
    )


@router.patch("", response_model=SettingsListResponse)
async def update_settings(
    body: list[SettingUpdate],
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.SETTINGS_MANAGE)),
):
    updated_settings = []

    for setting_update in body:
        result = await db.execute(
            select(Setting).where(Setting.key == setting_update.key)
        )
        setting = result.scalar_one_or_none()

        old_value = setting.value_json if setting else None

        if setting:
            setting.value_json = setting_update.value_json
            setting.updated_by = current_user.id
        else:
            setting = Setting(
                key=setting_update.key,
                value_json=setting_update.value_json,
                updated_by=current_user.id,
            )
            db.add(setting)

        await AuditService.log(
            db=db,
            action="settings.update",
            actor_user_id=current_user.id,
            actor_role_at_time=current_user.role,
            entity_type="setting",
            entity_label=setting_update.key,
            old_values={"value": old_value},
            new_values={"value": setting_update.value_json},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        await db.flush()
        updated_settings.append(setting)

    await db.commit()

    result = await db.execute(select(Setting).order_by(Setting.key))
    all_settings = result.scalars().all()

    return SettingsListResponse(
        items=[SettingResponse.model_validate(s) for s in all_settings]
    )
