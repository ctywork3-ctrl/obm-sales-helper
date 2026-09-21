import enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class OrderStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    KEYED_TO_OBM = "KEYED_TO_OBM"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    salesman_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    delivery_address_id = Column(Integer, ForeignKey("sales_customer_addresses.id"), nullable=True)
    contact_id = Column(Integer, ForeignKey("sales_customer_contacts.id"), nullable=True)
    status = Column(String(20), nullable=False, default="DRAFT")
    order_date = Column(DateTime, default=func.now())
    delivery_address = Column(Text)
    delivery_address_snapshot = Column(Text)
    contact_snapshot = Column(Text)
    notes = Column(Text)
    total_amount = Column(Numeric(12, 2), default=0)
    subtotal_amount = Column(Numeric(12, 2), default=0)
    gross_subtotal = Column(Numeric(12, 2), default=0)
    # Order-level discount (applied after line discounts).
    discount_type = Column(String(10), default="NONE")
    discount_value = Column(Numeric(12, 2), default=0)
    line_discount_total = Column(Numeric(12, 2), default=0)
    order_discount_amount = Column(Numeric(12, 2), default=0)
    discount_total = Column(Numeric(12, 2), default=0)
    discount_reason = Column(String(255))
    discount_requires_approval = Column(Boolean, default=False)
    tax_profile_id = Column(Integer, ForeignKey("tax_profiles.id"), nullable=True)
    tax_amount = Column(Numeric(12, 2), default=0)
    commission_total = Column(Numeric(12, 2), default=0)
    currency = Column(String(10), default="MYR")
    submitted_at = Column(DateTime)
    reviewed_by = Column(Integer, ForeignKey("users.id"))
    reviewed_at = Column(DateTime)
    rejected_reason = Column(Text)
    obm_reference_number = Column(String(100))
    keyed_to_obm_by = Column(Integer, ForeignKey("users.id"))
    keyed_to_obm_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("Customer")
    salesman = relationship("User", foreign_keys=[salesman_id])
    items = relationship("SalesOrderItem", back_populates="sales_order", cascade="all, delete-orphan")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id = Column(Integer, primary_key=True, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"))
    product_code_snapshot = Column(String(50))
    product_name_snapshot = Column(String(200))
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 2))
    gross_amount = Column(Numeric(12, 2), default=0)
    discount_type = Column(String(10), default="NONE")
    discount_value = Column(Numeric(12, 2), default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    order_discount_share = Column(Numeric(12, 2), default=0)
    line_total = Column(Numeric(12, 2))
    tax_rate_snapshot = Column(Numeric(7, 4), default=0)
    tax_amount = Column(Numeric(12, 2), default=0)
    notes = Column(Text)
    commission_rate = Column(Numeric(5, 2), default=0)
    commission_amount = Column(Numeric(12, 2), default=0)
    created_at = Column(DateTime, server_default=func.now())

    sales_order = relationship("SalesOrder", back_populates="items")
    product = relationship("Product")
