from datetime import datetime

from pydantic import BaseModel


class ProductBase(BaseModel):
    obm_item_code: str | None = None
    item_code: str | None = None
    name: str
    category: str | None = None
    category_id: int | None = None
    brand: str | None = None
    uom: str | None = None
    description: str | None = None
    selling_price: float | None = None
    cost_price: float | None = None
    stock_qty: int = 0
    barcode: str | None = None
    commission_rate: float = 0
    evidence_policy: str | None = None
    inventory_model: str | None = None
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    obm_item_code: str | None = None
    item_code: str | None = None
    name: str | None = None
    category: str | None = None
    brand: str | None = None
    uom: str | None = None
    description: str | None = None
    selling_price: float | None = None
    cost_price: float | None = None
    stock_source: str | None = None
    barcode: str | None = None
    commission_rate: float | None = None
    evidence_policy: str | None = None
    inventory_model: str | None = None
    is_active: bool | None = None


class ProductImageResponse(BaseModel):
    id: int
    file_path: str
    original_filename: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    is_primary: bool
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class ProductPriceCreate(BaseModel):
    currency: str
    unit_price: float
    min_qty: int | None = None
    is_active: bool = True


class ProductPriceUpdate(BaseModel):
    unit_price: float | None = None
    min_qty: int | None = None
    is_active: bool | None = None


class ProductPriceResponse(ProductPriceCreate):
    id: int
    product_id: int
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class ProductResponse(ProductBase):
    id: int
    created_by: int | None = None
    updated_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    images: list[ProductImageResponse] = []
    prices: list["ProductPriceResponse"] = []

    class Config:
        from_attributes = True


class ProductListResponse(BaseModel):
    items: list[ProductResponse]
    total: int
    page: int
    page_size: int
    pages: int = 0

    class Config:
        from_attributes = True
