from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, index=True)
    description = Column(Text)
    parent_id = Column(Integer, ForeignKey("product_categories.id"))
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    parent = relationship("ProductCategory", remote_side=[id])
    children = relationship("ProductCategory", back_populates="parent")


class CustomerAccount(Base):
    __tablename__ = "customer_accounts"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(200), unique=True, index=True, nullable=False)
    phone = Column(String(20))
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    last_login_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    addresses = relationship("EcommerceCustomerAddress", back_populates="customer", cascade="all, delete-orphan")
    cart = relationship("Cart", back_populates="customer", uselist=False, cascade="all, delete-orphan")
    orders = relationship("StoreOrder", back_populates="customer")


class EcommerceCustomerAddress(Base):
    __tablename__ = "customer_addresses"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customer_accounts.id"), nullable=False)
    label = Column(String(50), default="Home")
    address_line1 = Column(String(300), nullable=False)
    address_line2 = Column(String(300))
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    postcode = Column(String(20), nullable=False)
    country = Column(String(50), default="MY")
    phone = Column(String(20))
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("CustomerAccount", back_populates="addresses")


class Cart(Base):
    __tablename__ = "carts"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customer_accounts.id"), unique=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("CustomerAccount", back_populates="cart")
    items = relationship("CartItem", back_populates="cart", cascade="all, delete-orphan")


class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True, index=True)
    cart_id = Column(Integer, ForeignKey("carts.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    cart = relationship("Cart", back_populates="items")
    product = relationship("Product")


class StoreOrder(Base):
    __tablename__ = "store_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customer_accounts.id"), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    subtotal = Column(Numeric(12, 2), default=0)
    shipping_cost = Column(Numeric(12, 2), default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    total_amount = Column(Numeric(12, 2), default=0)
    currency = Column(String(10), default="MYR")
    shipping_method = Column(String(50))
    delivery_address_json = Column(Text)
    notes = Column(Text)
    promo_code = Column(String(50))
    paid_at = Column(DateTime)
    shipped_at = Column(DateTime)
    delivered_at = Column(DateTime)
    cancelled_at = Column(DateTime)
    cancel_reason = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("CustomerAccount", back_populates="orders")
    items = relationship("StoreOrderItem", back_populates="order", cascade="all, delete-orphan")
    payment = relationship("Payment", back_populates="order", uselist=False)


class StoreOrderItem(Base):
    __tablename__ = "store_order_items"

    id = Column(Integer, primary_key=True, index=True)
    store_order_id = Column(Integer, ForeignKey("store_orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"))
    product_name_snapshot = Column(String(200))
    product_image_snapshot = Column(String(500))
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 2))
    line_total = Column(Numeric(12, 2))
    created_at = Column(DateTime, server_default=func.now())

    order = relationship("StoreOrder", back_populates="items")
    product = relationship("Product")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    store_order_id = Column(Integer, ForeignKey("store_orders.id"), unique=True, nullable=False)
    hitpay_payment_id = Column(String(100), unique=True, index=True)
    status = Column(String(20), nullable=False, default="PENDING")
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), default="MYR")
    payment_method = Column(String(50))
    hitpay_reference = Column(String(200))
    webhook_data_json = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    order = relationship("StoreOrder", back_populates="payment")


class StoreSession(Base):
    __tablename__ = "store_sessions"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customer_accounts.id"), nullable=False)
    session_token_hash = Column(String(255), nullable=False, unique=True)
    ip_address = Column(String(50))
    user_agent = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, default=False)
