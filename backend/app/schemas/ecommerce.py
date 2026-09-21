from datetime import datetime
from pydantic import BaseModel, EmailStr


class CategoryResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None = None
    parent_id: int | None = None
    sort_order: int = 0
    is_active: bool = True

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    parent_id: int | None = None
    sort_order: int = 0
    is_active: bool = True


class CustomerRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str | None = None


class CustomerLogin(BaseModel):
    email: str
    password: str


class CustomerResponse(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str
    is_active: bool
    email_verified: bool
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class CustomerUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None


class AddressCreate(BaseModel):
    label: str = "Home"
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    postcode: str
    country: str = "MY"
    phone: str | None = None
    is_default: bool = False


class AddressResponse(BaseModel):
    id: int
    label: str
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    postcode: str
    country: str
    phone: str | None = None
    is_default: bool

    class Config:
        from_attributes = True


class CartItemRequest(BaseModel):
    product_id: int
    quantity: int = 1


class CartItemResponse(BaseModel):
    id: int
    product_id: int
    quantity: int
    product_name: str | None = None
    product_image: str | None = None
    unit_price: float = 0
    line_total: float = 0

    class Config:
        from_attributes = True


class CartResponse(BaseModel):
    id: int
    items: list[CartItemResponse] = []
    total: float = 0
    item_count: int = 0


class ProductBrief(BaseModel):
    id: int
    name: str
    item_code: str | None = None
    category: str | None = None
    selling_price: float = 0
    image_url: str | None = None

    class Config:
        from_attributes = True


class StoreOrderCreate(BaseModel):
    shipping_address_id: int | None = None
    shipping_address: AddressCreate | None = None
    shipping_method: str = "standard"
    notes: str | None = None
    promo_code: str | None = None


class StoreOrderItemResponse(BaseModel):
    id: int
    product_id: int | None = None
    product_name_snapshot: str | None = None
    product_image_snapshot: str | None = None
    quantity: int
    unit_price: float
    line_total: float

    class Config:
        from_attributes = True


class StoreOrderResponse(BaseModel):
    id: int
    order_number: str
    status: str
    subtotal: float
    shipping_cost: float
    discount_amount: float
    total_amount: float
    currency: str
    shipping_method: str | None = None
    delivery_address_json: str | None = None
    notes: str | None = None
    created_at: datetime | None = None
    paid_at: datetime | None = None
    shipped_at: datetime | None = None
    items: list[StoreOrderItemResponse] = []

    class Config:
        from_attributes = True


class StoreOrderListResponse(BaseModel):
    items: list[StoreOrderResponse]
    total: int
    page: int
    page_size: int
    pages: int = 0


class PaymentResponse(BaseModel):
    id: int
    status: str
    amount: float
    currency: str
    payment_method: str | None = None
    hitpay_payment_id: str | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class HitPayCheckoutRequest(BaseModel):
    order_id: int
    redirect_url: str
    webhook_url: str
