from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class ProductBarcode(Base):
    __tablename__ = "product_barcodes"
    __table_args__ = (UniqueConstraint("barcode_value", name="uq_barcode_value"),)

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    barcode_value = Column(String(200), nullable=False, index=True)
    barcode_type = Column(String(20), nullable=False, default="CODE128")
    source = Column(String(50), nullable=False, default="INTERNAL")
    is_primary = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product = relationship("Product", lazy="joined")


class ProductIntakeRequest(Base):
    __tablename__ = "product_intake_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String(50), unique=True, nullable=False, index=True)
    barcode_value = Column(String(200), nullable=True, index=True)
    product_name = Column(String(200), nullable=False)
    brand = Column(String(100))
    category = Column(String(100))
    description = Column(String(500))
    quantity_received = Column(Integer, nullable=False, default=0)
    supplier_name = Column(String(200))
    suggested_selling_price = Column(String(20))
    suggested_cost_price = Column(String(20))
    photo_path = Column(String(500))
    status = Column(String(20), nullable=False, default="DRAFT")
    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"))
    review_notes = Column(String(500))
    approved_product_id = Column(Integer, ForeignKey("products.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    reviewed_at = Column(DateTime(timezone=True))

    submitter = relationship("User", foreign_keys=[submitted_by], lazy="joined")
    reviewer = relationship("User", foreign_keys=[reviewed_by], lazy="joined")
    approved_product = relationship("Product", foreign_keys=[approved_product_id], lazy="joined")
