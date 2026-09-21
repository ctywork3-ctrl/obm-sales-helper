from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class ProductUnit(Base):
    """One physical, individually tracked item.

    Used for products where ``Product.inventory_model == "SERIALIZED"`` —
    fishing rods, reels and other high-value goods that need per-item
    traceability. A unit is born when it is received against a purchase
    order, and it carries the warranty clock and the customer it was sold to
    so a warranty claim can be traced from a single scanned serial number.

    For ``BULK`` products only ``Product.stock_qty`` is used and no units
    exist.
    """

    __tablename__ = "product_units"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    unit_code = Column(String(40), unique=True, nullable=True, index=True)
    serial_number = Column(String(100), unique=True, nullable=False, index=True)
    manufacturer_serial = Column(String(100), nullable=True, index=True)
    barcode = Column(String(200), unique=True, nullable=True, index=True)
    status = Column(String(20), nullable=False, default="AVAILABLE")
    # Set while a stock take is in progress, so a scan during a count can be
    # attributed to that session without a separate join table. Cleared when the
    # session is posted.
    stock_take_session_id = Column(
        Integer, ForeignKey("stock_take_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    stock_take_counted_at = Column(DateTime(timezone=True), nullable=True)
    # Set while a unit is being moved between locations. Cleared when the
    # receiving side confirms it arrived.
    stock_transfer_id = Column(
        Integer, ForeignKey("stock_transfers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    condition = Column(String(20), nullable=False, default="NEW")
    warehouse_location = Column(String(100), nullable=True)
    location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True, index=True)
    batch_number = Column(String(50), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    sold_at = Column(DateTime(timezone=True), nullable=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    receipt_id = Column(Integer, ForeignKey("inventory_receipts.id"), nullable=True, index=True)
    receipt_line_id = Column(Integer, ForeignKey("inventory_receipt_lines.id"), nullable=True, index=True)
    receiving_task_line_id = Column(
        Integer, ForeignKey("receiving_task_lines.id", ondelete="SET NULL"), nullable=True, index=True
    )
    unit_cost = Column(Numeric(12, 2), nullable=True)

    # --- Warranty -------------------------------------------------------
    # warranty_months is snapshotted from the product at receiving time so a
    # later change to the product's warranty term does not rewrite history.
    warranty_months = Column(Integer, nullable=True)
    warranty_start = Column(DateTime(timezone=True), nullable=True)
    warranty_end = Column(DateTime(timezone=True), nullable=True)
    warranty_void_reason = Column(String(255), nullable=True)

    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    product = relationship("Product", lazy="joined")
    images = relationship("ProductUnitImage", back_populates="product_unit", cascade="all, delete-orphan")
    receipt = relationship("InventoryReceipt", foreign_keys=[receipt_id], lazy="joined")
    receipt_line = relationship("InventoryReceiptLine", back_populates="units", foreign_keys=[receipt_line_id])
    location = relationship("StockLocation", foreign_keys=[location_id], lazy="joined")
    receiving_task_line = relationship(
        "ReceivingTaskLine", back_populates="units", foreign_keys=[receiving_task_line_id]
    )

    @property
    def warranty_active(self) -> bool:
        if not self.warranty_end or self.warranty_void_reason:
            return False
        return self.warranty_end.replace(tzinfo=timezone.utc) >= datetime.now(timezone.utc)
