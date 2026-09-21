from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class PurchaseOrderLineCreate(BaseModel):
    product_id: int
    quantity_ordered: int = Field(gt=0, le=100000)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class PurchaseOrderCreate(BaseModel):
    supplier_name: str = Field(min_length=1, max_length=200)
    expected_date: datetime | None = None
    notes: str | None = None
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1)


class PurchaseOrderLineResponse(BaseModel):
    id: int
    product_id: int
    product_name: str | None = None
    product_code: str | None = None
    quantity_ordered: int
    quantity_received: int
    quantity_outstanding: int
    unit_cost: float | None = None


class PurchaseOrderResponse(BaseModel):
    id: int
    po_number: str
    supplier_name: str
    status: Literal["DRAFT", "SENT", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"]
    expected_date: datetime | None = None
    notes: str | None = None
    created_by: int
    created_at: datetime | None = None
    lines: list[PurchaseOrderLineResponse] = []
    documents: list[dict] = []
