from datetime import datetime

from pydantic import BaseModel


class SalesmanBrief(BaseModel):
    id: int
    full_name: str
    username: str

    class Config:
        from_attributes = True


class CustomerBrief(BaseModel):
    id: int
    name: str
    code: str

    class Config:
        from_attributes = True


class SalesOrderItemBase(BaseModel):
    product_id: int | None = None
    product_code_snapshot: str | None = None
    product_name_snapshot: str | None = None
    quantity: int
    unit_price: float | None = None
    discount_amount: float = 0
    notes: str | None = None


class SalesOrderItemCreate(SalesOrderItemBase):
    pass


class SalesOrderItemResponse(SalesOrderItemBase):
    id: int
    line_total: float | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class SalesOrderBase(BaseModel):
    customer_id: int | None = None
    delivery_address: str | None = None
    notes: str | None = None
    currency: str = "MYR"


class SalesOrderCreate(SalesOrderBase):
    items: list[SalesOrderItemCreate] = []


class SalesOrderUpdate(BaseModel):
    customer_id: int | None = None
    delivery_address: str | None = None
    notes: str | None = None
    currency: str | None = None


class SalesOrderResponse(SalesOrderBase):
    id: int
    order_number: str
    salesman_id: int
    status: str
    order_date: datetime | None = None
    total_amount: float
    submitted_at: datetime | None = None
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    rejected_reason: str | None = None
    obm_reference_number: str | None = None
    keyed_to_obm_by: int | None = None
    keyed_to_obm_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[SalesOrderItemResponse] = []
    salesman: SalesmanBrief | None = None
    customer: CustomerBrief | None = None

    class Config:
        from_attributes = True


class SalesOrderListResponse(BaseModel):
    items: list[SalesOrderResponse]
    total: int
    page: int
    page_size: int
    pages: int = 0


class RejectOrderRequest(BaseModel):
    reason: str


class MarkKeyedRequest(BaseModel):
    obm_reference_number: str
