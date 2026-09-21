from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class InventoryReceiptLineCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=10000)
    tracking_mode: Literal["SERIALIZED", "BULK"] = "SERIALIZED"
    batch_number: str | None = None
    unit_cost: Decimal | None = Field(default=None, ge=0)
    manufacturer_serials: list[str] = Field(default_factory=list)
    purchase_order_line_id: int | None = None


class InventoryReceiptCreate(BaseModel):
    supplier_name: str | None = None
    reference_number: str | None = None
    warehouse_location: str | None = None
    received_at: datetime | None = None
    notes: str | None = None
    purchase_order_id: int | None = None
    lines: list[InventoryReceiptLineCreate] = Field(min_length=1)


class InventoryAdjustmentCreate(BaseModel):
    product_id: int
    quantity_delta: int
    reason: str = Field(min_length=3, max_length=500)
    warehouse_location: str | None = None


class InventoryUnitCreate(BaseModel):
    product_id: int
    quantity: int = Field(default=1, gt=0, le=10000)
    warehouse_location: str | None = None
    batch_number: str | None = None
    manufacturer_serials: list[str] = Field(default_factory=list)


class InventoryUnitSummary(BaseModel):
    id: int
    unit_code: str | None = None
    serial_number: str
    manufacturer_serial: str | None = None
    barcode: str | None = None
    status: str
    warehouse_location: str | None = None
    batch_number: str | None = None
    product_id: int
    product_name: str | None = None
    product_code: str | None = None
    received_at: datetime | None = None
    receipt_id: int | None = None


class InventoryReceiptImageResponse(BaseModel):
    id: int
    receipt_id: int
    file_path: str
    original_filename: str | None = None
    caption: str | None = None
    uploaded_by: int
    created_at: datetime | None = None


class InventoryReceiptResponse(BaseModel):
    id: int
    receipt_number: str
    status: str
    supplier_name: str | None = None
    reference_number: str | None = None
    warehouse_location: str | None = None
    notes: str | None = None
    received_at: datetime
    created_by: int
    posted_by: int | None = None
    posted_at: datetime | None = None
    created_at: datetime | None = None
    lines: list[dict] = []
    units: list[InventoryUnitSummary] = []
    images: list[InventoryReceiptImageResponse] = []


class InventoryResolveResponse(BaseModel):
    found: bool
    value: str
    result_type: Literal["UNIT", "PRODUCT", "UNKNOWN"]
    unit: InventoryUnitSummary | None = None
    product: dict | None = None
