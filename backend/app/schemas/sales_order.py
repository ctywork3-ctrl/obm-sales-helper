from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.services.pricing import DISCOUNT_TYPES, normalise_discount_type


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


class DiscountMixin(BaseModel):
    """Shared discount fields for line-level and order-level discounts."""

    discount_type: str = "NONE"  # NONE | PERCENT | AMOUNT
    discount_value: float = 0

    @field_validator("discount_type")
    @classmethod
    def _clean_type(cls, value: str) -> str:
        return normalise_discount_type(value)

    @field_validator("discount_value")
    @classmethod
    def _clean_value(cls, value: float) -> float:
        if value is None:
            return 0
        if value < 0:
            raise ValueError("Discount cannot be negative")
        return value


class SalesOrderItemBase(BaseModel):
    product_id: int | None = None
    product_code_snapshot: str | None = None
    product_name_snapshot: str | None = None
    quantity: int
    unit_price: float | None = None
    notes: str | None = None


class SalesOrderItemCreate(SalesOrderItemBase, DiscountMixin):
    pass


class SalesOrderItemCreateValidated(SalesOrderItemBase, DiscountMixin):
    """Server-validated order item with positive quantity and non-negative prices."""
    product_id: int

    class Config:
        from_attributes = True

    def model_post_init(self, __context):
        if self.quantity < 1:
            raise ValueError("Quantity must be at least 1")
        if self.unit_price is not None and self.unit_price < 0:
            raise ValueError("Unit price cannot be negative")


class SalesOrderItemResponse(SalesOrderItemBase, DiscountMixin):
    id: int
    gross_amount: float | None = None
    discount_amount: float | None = None
    order_discount_share: float | None = None
    line_total: float | None = None
    tax_rate_snapshot: float | None = None
    tax_amount: float | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class SalesOrderBase(BaseModel):
    customer_id: int | None = None
    delivery_address_id: int | None = None
    contact_id: int | None = None
    delivery_address: str | None = None
    notes: str | None = None
    currency: str = "MYR"
    tax_profile_id: int | None = None


class SalesOrderCreate(SalesOrderBase, DiscountMixin):
    items: list[SalesOrderItemCreate] = []
    discount_reason: str | None = None


class SalesOrderUpdate(BaseModel):
    customer_id: int | None = None
    delivery_address_id: int | None = None
    contact_id: int | None = None
    delivery_address: str | None = None
    notes: str | None = None
    currency: str | None = None


class SalesOrderItemUpdate(SalesOrderItemBase, DiscountMixin):
    pass


class SalesOrderFullUpdate(SalesOrderBase, DiscountMixin):
    """Full draft replacement. Also carries the fields the review screen
    edits (tax profile, order discount reason)."""

    items: list[SalesOrderItemUpdate] | None = None
    discount_reason: str | None = None


class SalesOrderResponse(SalesOrderBase):
    id: int
    order_number: str
    salesman_id: int
    status: str
    order_date: datetime | None = None
    total_amount: float
    subtotal_amount: float | None = None
    gross_subtotal: float | None = None
    discount_type: str | None = None
    discount_value: float | None = None
    line_discount_total: float | None = None
    order_discount_amount: float | None = None
    discount_total: float | None = None
    discount_reason: str | None = None
    discount_requires_approval: bool | None = None
    tax_amount: float | None = None
    delivery_address_snapshot: str | None = None
    contact_snapshot: str | None = None
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


class DiscountCheckRequest(BaseModel):
    """Ask the server whether a discount needs manager approval."""

    amount: float
    discount_type: str = "NONE"
    discount_value: float = 0


class OrderCommentCreate(BaseModel):
    message: str


class OrderCommentResponse(BaseModel):
    id: int
    sales_order_id: int
    author_id: int
    author_name: str | None = None
    message: str
    created_at: str | None = None

    class Config:
        from_attributes = True

    @classmethod
    def model_validate(cls, obj):
        author_name = None
        if hasattr(obj, "author") and obj.author:
            author_name = obj.author.full_name
        return cls(
            id=obj.id,
            sales_order_id=obj.sales_order_id,
            author_id=obj.author_id,
            author_name=author_name,
            message=obj.message,
            created_at=obj.created_at.isoformat() if obj.created_at else None,
        )
