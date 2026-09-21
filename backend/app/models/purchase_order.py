from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String(50), unique=True, nullable=False, index=True)
    # supplier_id is the live link to master data; supplier_name is the
    # historical snapshot of what this document said. Renaming a supplier must
    # NOT rewrite an issued PO, so both are kept.
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    supplier_name = Column(String(200), nullable=False)
    status = Column(String(25), nullable=False, default="DRAFT", index=True)
    # Where this PO came from. MANUAL today; OBM_IMPORT is the seam for a future
    # connector that pulls POs straight out of the accounting package.
    source = Column(String(20), nullable=False, default="MANUAL", index=True)
    external_reference = Column(String(100), nullable=True, index=True)
    external_synced_at = Column(DateTime(timezone=True), nullable=True)
    expected_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    lines = relationship("PurchaseOrderLine", back_populates="purchase_order", cascade="all, delete-orphan")
    documents = relationship("PurchaseDocument", back_populates="purchase_order")
    creator = relationship("User", lazy="joined")


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity_ordered = Column(Integer, nullable=False)
    quantity_received = Column(Integer, nullable=False, default=0)
    unit_cost = Column(Numeric(12, 2), nullable=True)
    notes = Column(String(500), nullable=True)

    # How much of this line OBM says has already been received (`QTYPROCESSED`).
    #
    # Deliberately NOT folded into `quantity_received`. That column records what
    # THIS app received, through its own receipt records; adopting a number from
    # another system would make our receiving state unexplainable and would
    # double-count the moment the same goods were booked in here.
    #
    # So OBM's figure is kept beside ours and the difference is shown to a human,
    # who decides whether it is a delivery we missed or a receipt that predates
    # this system. Without it, a PO OBM considers half-delivered reads as fully
    # outstanding here and the warehouse is sent to receive goods that arrived
    # months ago.
    obm_quantity_processed = Column(Numeric(12, 3), nullable=True)

    purchase_order = relationship("PurchaseOrder", back_populates="lines")
    product = relationship("Product", lazy="joined")


class PurchaseDocument(Base):
    """Supplier PO/invoice file uploaded for review. AI extraction fills
    extracted_json for manager confirmation; nothing here ever touches stock."""

    __tablename__ = "purchase_documents"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=True)
    mime_type = Column(String(100), nullable=True)
    extraction_status = Column(String(20), nullable=False, default="PENDING_AI")
    extracted_json = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="documents")
    uploader = relationship("User", lazy="joined")
