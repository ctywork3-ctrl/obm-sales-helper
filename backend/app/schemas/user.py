from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    username: str
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    role: str


class UserCreate(UserBase):
    password: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None


class UserResponse(UserBase):
    id: int
    is_active: bool
    must_change_password: bool
    password_changed_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime | None = None
    permissions: list[str] = []

    class Config:
        from_attributes = True


class AssignRoleRequest(BaseModel):
    role: str
