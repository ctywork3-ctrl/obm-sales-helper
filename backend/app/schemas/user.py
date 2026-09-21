from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr


class ValidRole(str, Enum):
    DEVELOPER = "DEVELOPER"
    IT_ADMIN = "IT_ADMIN"
    DIRECTOR = "DIRECTOR"
    OPERATIONS_MANAGER = "OPERATIONS_MANAGER"
    PURCHASE_MANAGER = "PURCHASE_MANAGER"
    MANAGER = "MANAGER"
    INSIDE_SALES = "INSIDE_SALES"
    OUTSIDE_SALES = "OUTSIDE_SALES"
    STOCK_KEEPER = "STOCK_KEEPER"


class UserBase(BaseModel):
    username: str
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    role: ValidRole


class UserCreate(UserBase):
    password: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    # BUGFIX: the edit form has always sent `role`, but the schema dropped it,
    # so changing a user's role silently did nothing. It is accepted now.
    role: ValidRole | None = None


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
    role: ValidRole
