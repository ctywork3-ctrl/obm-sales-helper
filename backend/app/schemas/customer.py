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


class CustomerContactCreate(BaseModel):
    name: str
    job_title: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    whatsapp: str | None = None
    is_primary: bool = False
    notes: str | None = None


class CustomerContactResponse(CustomerContactCreate):
    id: int
    customer_id: int
    is_active: bool

    class Config:
        from_attributes = True


class CustomerAddressCreate(BaseModel):
    address_type: str = "DELIVERY"
    label: str
    address_line1: str
    address_line2: str | None = None
    postcode: str | None = None
    city: str | None = None
    state: str | None = None
    country: str = "MY"
    contact_name: str | None = None
    contact_phone: str | None = None
    delivery_notes: str | None = None
    is_default: bool = False


class CustomerAddressResponse(CustomerAddressCreate):
    id: int
    customer_id: int
    is_active: bool

    class Config:
        from_attributes = True


class CustomerResponse(CustomerBase):
    id: int
    salesman_id: int | None = None
    salesman_name: str | None = None
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
