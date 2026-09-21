from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    obm_item_code = Column(String(50), index=True)
    item_code = Column(String(50), unique=True, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(100))
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True, index=True)
    brand = Column(String(100))
    uom = Column(String(20))
    description = Column(Text)
    selling_price = Column(Numeric(12, 2))
    cost_price = Column(Numeric(12, 2))
    stock_qty = Column(Integer, default=0)
    stock_source = Column(String(20), default="MANUAL")
    last_stock_sync_at = Column(DateTime)
    barcode = Column(String(100))
    is_active = Column(Boolean, default=True)
    commission_rate = Column(Numeric(5, 2), default=0)
    evidence_policy = Column(String(20), default="RECEIPT", nullable=False)
    inventory_model = Column(String(20), default="BULK", nullable=False)
    # Warranty term in months, snapshotted onto each ProductUnit at receiving
    # time. NULL means "use the company default from Settings".
    warranty_months = Column(Integer, nullable=True)
    reorder_level = Column(Integer, default=10, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"))
    updated_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    images = relationship("ProductImage", back_populates="product", cascade="all, delete-orphan")
    prices = relationship("ProductPrice", back_populates="product", cascade="all, delete-orphan")
    category_ref = relationship("ProductCategory", foreign_keys=[category_id], lazy="joined")


class ProductImage(Base):
    __tablename__ = "product_images"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255))
    mime_type = Column(String(50))
    file_size = Column(Integer)
    is_primary = Column(Boolean, default=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now())

    product = relationship("Product", back_populates="images")
