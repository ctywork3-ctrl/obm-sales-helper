"""Warehouse operations models.

The goods-in pipeline this supports:

    Purchase Order (from OBM or created here)
        -> ReceivingTask        issued by the purchase manager to a storekeeper
        -> scanning on a phone  one barcode scan per physical item
        -> InventoryReceipt     posted stock + one ProductUnit per serial
        -> WarrantyClaim        later, traceable from the serial number

Keeping the task separate from the purchase order matters: the PO says what
the supplier promised, the task says who is standing at the loading bay
counting it, and the receipt is the signed-off truth that moved stock.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base


class StockLocation(Base):
    """A place stock physically lives: showroom, warehouse rack, returns bin.

    Optional for every product, but for serialized tackle it is what turns
    ``ProductUnit.warehouse_location`` (free text) into something reportable.
    """

    __tablename__ = "stock_locations"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    # SHOWROOM | WAREHOUSE | RACK | RETURNS | DAMAGED | TRANSIT
    zone = Column(String(20), nullable=False, default="WAREHOUSE")
    parent_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True)
    address = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    parent = relationship("StockLocation", remote_side=[id], lazy="joined")


class ReceivingTaskStatus:
    DRAFT = "DRAFT"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"

    ALL = (DRAFT, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED)
    TRANSITIONS = {
        DRAFT: {ASSIGNED, CANCELLED},
        ASSIGNED: {IN_PROGRESS, CANCELLED, DRAFT},
        IN_PROGRESS: {COMPLETED, ASSIGNED, CANCELLED},
        COMPLETED: set(),
        CANCELLED: set(),
    }


class ReceivingTask(Base):
    """A counting/checking job for goods that have arrived or are expected."""

    __tablename__ = "receiving_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_number = Column(String(40), unique=True, nullable=False, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    supplier_name = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="DRAFT", index=True)
    priority = Column(String(10), nullable=False, default="NORMAL")  # LOW | NORMAL | HIGH
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True, index=True)
    instructions = Column(Text, nullable=True)
    completion_notes = Column(Text, nullable=True)
    inventory_receipt_id = Column(Integer, ForeignKey("inventory_receipts.id"), nullable=True)
    # Set when the counted quantity did not match the expected quantity. The
    # worker is never blocked over this — the difference is recorded and the
    # purchase manager is notified so they can chase the supplier.
    has_discrepancy = Column(Boolean, default=False, nullable=False, index=True)
    discrepancy_summary = Column(Text, nullable=True)
    discrepancy_resolved_at = Column(DateTime(timezone=True), nullable=True)
    discrepancy_resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    lines = relationship("ReceivingTaskLine", back_populates="task", cascade="all, delete-orphan")
    assignee = relationship("User", foreign_keys=[assigned_to], lazy="joined")
    assigner = relationship("User", foreign_keys=[assigned_by], lazy="joined")
    location = relationship("StockLocation", lazy="joined")
    purchase_order = relationship("PurchaseOrder", lazy="joined")


class ReceivingTaskLine(Base):
    __tablename__ = "receiving_task_lines"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("receiving_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    purchase_order_line_id = Column(Integer, ForeignKey("purchase_order_lines.id"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity_expected = Column(Integer, nullable=False, default=0)
    quantity_scanned = Column(Integer, nullable=False, default=0)
    quantity_rejected = Column(Integer, nullable=False, default=0)
    unit_cost = Column(Numeric(12, 2), nullable=True)
    # Snapshot at task creation so a later product change cannot flip a line
    # from serial-tracked to bulk mid-count.
    tracking_mode = Column(String(20), nullable=False, default="BULK")
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task = relationship("ReceivingTask", back_populates="lines")
    product = relationship("Product", lazy="joined")
    units = relationship("ProductUnit", back_populates="receiving_task_line")


class ReceivingTaskScan(Base):
    """Append-only scan log.

    Every scan is recorded even when it is rejected (duplicate serial, wrong
    product, unknown code), because "the supplier short-shipped us" and "the
    worker scanned it twice" are different conversations.
    """

    __tablename__ = "receiving_task_scans"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("receiving_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    task_line_id = Column(Integer, ForeignKey("receiving_task_lines.id", ondelete="SET NULL"), nullable=True)
    scanned_code = Column(String(200), nullable=False)
    # OK | DUPLICATE | WRONG_PRODUCT | UNKNOWN
    result = Column(String(20), nullable=False, default="OK")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    note = Column(String(255), nullable=True)
    scanned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReceivingDiscrepancyStatus:
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CHASED = "CHASED"
    RESOLVED = "RESOLVED"
    IGNORED = "IGNORED"

    ALL = (OPEN, ACKNOWLEDGED, CHASED, RESOLVED, IGNORED)
    CLOSED = (RESOLVED, IGNORED)


class ReceivingDiscrepancy(Base):
    """One line where the counted quantity did not match the expected quantity.

    This is the short-ship / over-ship note. The warehouse worker does not
    adjudicate it — they just report what is physically there, stock posts at
    the counted figure, and the purchase manager gets this row to chase the
    supplier with.
    """

    __tablename__ = "receiving_discrepancies"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("receiving_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    task_line_id = Column(Integer, ForeignKey("receiving_task_lines.id", ondelete="SET NULL"), nullable=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)
    purchase_order_line_id = Column(Integer, ForeignKey("purchase_order_lines.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    # Link to supplier master data. NULL on rows created before v6; the queue
    # falls back to the normalized supplier_name for those, so old rows still
    # group with new ones for the same vendor.
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    supplier_name = Column(String(200), nullable=True, index=True)
    quantity_expected = Column(Integer, nullable=False, default=0)
    quantity_scanned = Column(Integer, nullable=False, default=0)
    difference = Column(Integer, nullable=False, default=0)
    # SHORT (we got less) | OVER (we got more)
    direction = Column(String(10), nullable=False, default="SHORT", index=True)
    status = Column(String(20), nullable=False, default="OPEN", index=True)
    resolution_note = Column(String(500), nullable=True)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task = relationship("ReceivingTask", lazy="joined")
    product = relationship("Product", lazy="joined")
    resolver = relationship("User", foreign_keys=[resolved_by], lazy="joined")


class StockTakeStatus:
    DRAFT = "DRAFT"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"

    ALL = (DRAFT, IN_PROGRESS, COMPLETED, CANCELLED)
    OPEN = (DRAFT, IN_PROGRESS)


class StockTakeScope:
    """What a session covers."""

    LOCATION = "LOCATION"     # everything expected to be in one place
    PRODUCT = "PRODUCT"       # one product across all locations
    ALL = "ALL"               # the whole warehouse (a full stock take)

    ALL_SCOPES = (LOCATION, PRODUCT, ALL)


class StockTakeSession(Base):
    """A physical count of what is actually on the shelf, versus the system.

    This is how the "warehouse stock is messy" problem gets *found* rather than
    guessed at. Count what is physically there, and every difference becomes a
    documented adjustment with a reason instead of a mystery.
    """

    __tablename__ = "stock_take_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="DRAFT", index=True)
    scope = Column(String(20), nullable=False, default="LOCATION")
    location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)
    completion_notes = Column(Text, nullable=True)

    total_lines = Column(Integer, nullable=False, default=0)
    counted_lines = Column(Integer, nullable=False, default=0)
    variance_lines = Column(Integer, nullable=False, default=0)
    # Net units written off (negative) or found (positive) when it was posted.
    net_variance = Column(Integer, nullable=False, default=0)

    started_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    location = relationship("StockLocation", lazy="joined")
    starter = relationship("User", foreign_keys=[started_by], lazy="joined")
    counts = relationship(
        "StockTakeCount",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class StockTakeCount(Base):
    """One product's expected-versus-counted line inside a session."""

    __tablename__ = "stock_take_counts"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("stock_take_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    tracking_mode = Column(String(20), nullable=False, default="BULK")

    # What the system believed at the moment the session started. Frozen, so a
    # sale happening mid-count does not silently rewrite the baseline.
    expected_qty = Column(Integer, nullable=False, default=0)
    # NULL means "not counted yet", which is different from "counted zero".
    counted_qty = Column(Integer, nullable=True)
    variance = Column(Integer, nullable=True)
    notes = Column(String(500), nullable=True)
    counted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    counted_at = Column(DateTime(timezone=True), nullable=True)
    # The ledger adjustment this line produced when the session was posted.
    adjustment_id = Column(Integer, ForeignKey("inventory_adjustments.id"), nullable=True)

    session = relationship("StockTakeSession", back_populates="counts")
    product = relationship("Product", lazy="joined")


class StockTransferStatus:
    DRAFT = "DRAFT"
    IN_TRANSIT = "IN_TRANSIT"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"

    ALL = (DRAFT, IN_TRANSIT, COMPLETED, CANCELLED)
    OPEN = (DRAFT, IN_TRANSIT)


class StockTransfer(Base):
    """Moving stock between locations, with a check at each end.

    A transfer **never changes a quantity** — it only changes where something is.
    That invariant is the whole reason it is a separate document from an
    adjustment: if a transfer could move the number, "we lost two rods" and "we
    moved two rods" would look identical in the ledger.

    The two-sided confirm is the control that matters: the sender scans what
    leaves, the receiver scans what arrives, and the receiver's scan is what
    actually relocates the unit. Anything scanned out but never scanned in stays
    where it was and shows up as a difference on the transfer.
    """

    __tablename__ = "stock_transfers"

    id = Column(Integer, primary_key=True, index=True)
    transfer_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="DRAFT", index=True)
    from_location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=False, index=True)
    to_location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)
    completion_notes = Column(Text, nullable=True)

    total_units = Column(Integer, nullable=False, default=0)
    dispatched_units = Column(Integer, nullable=False, default=0)
    received_units = Column(Integer, nullable=False, default=0)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    dispatched_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    dispatched_at = Column(DateTime(timezone=True), nullable=True)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)

    from_location = relationship("StockLocation", foreign_keys=[from_location_id], lazy="joined")
    to_location = relationship("StockLocation", foreign_keys=[to_location_id], lazy="joined")
    creator = relationship("User", foreign_keys=[created_by], lazy="joined")
    dispatcher = relationship("User", foreign_keys=[dispatched_by], lazy="joined")
    receiver = relationship("User", foreign_keys=[received_by], lazy="joined")
    lines = relationship(
        "StockTransferLine",
        back_populates="transfer",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class StockTransferLine(Base):
    """One product's expected-versus-sent-versus-arrived counts on a transfer."""

    __tablename__ = "stock_transfer_lines"

    id = Column(Integer, primary_key=True, index=True)
    transfer_id = Column(Integer, ForeignKey("stock_transfers.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity_expected = Column(Integer, nullable=False, default=0)
    quantity_dispatched = Column(Integer, nullable=False, default=0)
    quantity_received = Column(Integer, nullable=False, default=0)
    tracking_mode = Column(String(20), nullable=False, default="SERIALIZED")
    notes = Column(String(500), nullable=True)

    transfer = relationship("StockTransfer", back_populates="lines")
    product = relationship("Product", lazy="joined")


class WarrantyClaimStatus:
    OPEN = "OPEN"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REPLACED = "REPLACED"
    CLOSED = "CLOSED"

    ALL = (OPEN, APPROVED, REJECTED, REPLACED, CLOSED)


class WarrantyClaim(Base):
    """A customer warranty claim against one serialized unit."""

    __tablename__ = "warranty_claims"

    id = Column(Integer, primary_key=True, index=True)
    claim_number = Column(String(40), unique=True, nullable=False, index=True)
    product_unit_id = Column(Integer, ForeignKey("product_units.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    issue = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="OPEN", index=True)
    resolution = Column(Text, nullable=True)
    replacement_unit_id = Column(Integer, ForeignKey("product_units.id"), nullable=True)
    in_warranty_at_claim = Column(Boolean, nullable=True)
    handled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    unit = relationship("ProductUnit", foreign_keys=[product_unit_id], lazy="joined")
    customer = relationship("Customer", lazy="joined")
    sales_order = relationship("SalesOrder", lazy="joined")
    handler = relationship("User", foreign_keys=[handled_by], lazy="joined")


class ReportTemplate(Base):
    """A saved A4 document/report layout.

    ``config_json`` holds an ordered list of blocks. New block types can be
    added without a migration, which is why the layout lives in JSON rather
    than in columns.
    """

    __tablename__ = "report_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    # SALES_ORDER | INVOICE | DELIVERY_ORDER | PURCHASE_ORDER | REPORT
    doc_type = Column(String(30), nullable=False, default="SALES_ORDER", index=True)
    paper_size = Column(String(10), nullable=False, default="A4")  # A4 | A5 | LETTER
    orientation = Column(String(10), nullable=False, default="portrait")
    config_json = Column(Text, nullable=False, default="{}")
    is_default = Column(Boolean, default=False, nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
