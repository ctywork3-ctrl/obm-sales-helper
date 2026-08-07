from datetime import datetime

from pydantic import BaseModel


class RolePermissionBase(BaseModel):
    role: str
    page_key: str
    label: str
    is_visible: bool = True


class RolePermissionCreate(RolePermissionBase):
    pass


class RolePermissionUpdate(BaseModel):
    is_visible: bool | None = None


class RolePermissionResponse(RolePermissionBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class RolePermissionBulkUpdate(BaseModel):
    role: str
    permissions: list[RolePermissionCreate]


class RolePermissionsByRole(BaseModel):
    role: str
    pages: list[RolePermissionResponse]
