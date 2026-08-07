from datetime import datetime

from pydantic import BaseModel


class CustomerBase(BaseModel):
    obm_customer_code: str | None = None
    code: str | None = None
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    is_active: bool = True


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    obm_customer_code: str | None = None
    code: str | None = None
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    is_active: bool | None = None


class CustomerResponse(CustomerBase):
    id: int
    created_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class CustomerListResponse(BaseModel):
    items: list[CustomerResponse]
    total: int
    page: int
    page_size: int
    pages: int = 0
