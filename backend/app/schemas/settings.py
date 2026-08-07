from datetime import datetime

from pydantic import BaseModel


class SettingBase(BaseModel):
    key: str
    value_json: dict | None = None


class SettingUpdate(BaseModel):
    key: str
    value_json: dict


class SettingResponse(SettingBase):
    id: int
    updated_by: int | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class SettingsListResponse(BaseModel):
    items: list[SettingResponse]
