from datetime import datetime

from pydantic import BaseModel


class ProductBase(BaseModel):
    obm_item_code: str | None = None
    item_code: str | None = None
    name: str
    category: str | None = None
    brand: str | None = None
    uom: str | None = None
    description: str | None = None
    selling_price: float | None = None
    cost_price: float | None = None
    stock_qty: int = 0
    barcode: str | None = None
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
    stock_qty: int | None = None
    barcode: str | None = None
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


class ProductResponse(ProductBase):
    id: int
    created_by: int | None = None
    updated_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    images: list[ProductImageResponse] = []

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
