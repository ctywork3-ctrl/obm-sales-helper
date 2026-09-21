from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class InventoryReceipt(Base):
    __tablename__ = "inventory_receipts"

    id = Column(Integer, primary_key=True, index=True)
    receipt_number = Column(String(50), unique=True, nullable=False, index=True)
    client_key = Column(String(64), unique=True, nullable=True, index=True)
    status = Column(String(20), nullable=False, default="POSTED")
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    supplier_name = Column(String(200), nullable=True)
    reference_number = Column(String(100), nullable=True)
    warehouse_location = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    posted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lines = relationship("InventoryReceiptLine", back_populates="receipt", cascade="all, delete-orphan")
    images = relationship("InventoryReceiptImage", back_populates="receipt", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by], lazy="joined")
    poster = relationship("User", foreign_keys=[posted_by], lazy="joined")


class InventoryReceiptLine(Base):
    __tablename__ = "inventory_receipt_lines"

    id = Column(Integer, primary_key=True, index=True)
    receipt_id = Column(Integer, ForeignKey("inventory_receipts.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    tracking_mode = Column(String(20), nullable=False, default="SERIALIZED")
    batch_number = Column(String(100), nullable=True)
    unit_cost = Column(Numeric(12, 2), nullable=True)
    purchase_order_line_id = Column(Integer, ForeignKey("purchase_order_lines.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    receipt = relationship("InventoryReceipt", back_populates="lines")
    product = relationship("Product", lazy="joined")
    units = relationship("ProductUnit", back_populates="receipt_line")


class InventoryReceiptImage(Base):
    __tablename__ = "inventory_receipt_images"

    id = Column(Integer, primary_key=True, index=True)
    receipt_id = Column(Integer, ForeignKey("inventory_receipts.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=True)
    caption = Column(String(255), nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    receipt = relationship("InventoryReceipt", back_populates="images")
    uploader = relationship("User", lazy="joined")
