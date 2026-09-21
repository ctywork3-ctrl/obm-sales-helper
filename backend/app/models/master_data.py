from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Numeric, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class Brand(Base):
    __tablename__ = "brands"
    __table_args__ = (UniqueConstraint("normalized_name", name="uq_brand_normalized"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    normalized_name = Column(String(100), nullable=False, unique=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class Supplier(Base):
    """Vendor master data.

    Why this exists: ``supplier_name`` was free text in four tables, and the
    receiving-discrepancy queue groups by that exact string (see
    ``api/warehouse_ops.py``). "Mismatch Supplier" / "mismatch supplier" /
    "Mismatch Supplier " therefore became three separate suppliers in the queue,
    so nobody could see how many shortages one vendor actually owed.

    ``normalized_name`` follows the ``Brand`` pattern: lowercase with whitespace
    stripped, unique. New suppliers are matched on it, so casing and spacing can
    never split a vendor in two. Existing free-text names are linked by
    ``supplier_id`` as POs and receipts are created; ``supplier_name`` is kept as
    the historical snapshot so old documents still read correctly.
    """

    __tablename__ = "suppliers"
    __table_args__ = (UniqueConstraint("normalized_name", name="uq_supplier_normalized"),)

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, index=True)  # human-facing, e.g. SUP-001
    name = Column(String(200), nullable=False)
    normalized_name = Column(String(200), nullable=False, unique=True, index=True)
    contact_person = Column(String(120))
    phone = Column(String(40))
    email = Column(String(200))
    address = Column(String(500))
    # Free-text note: payment terms, lead time, who to chase.
    notes = Column(String(500))
    obm_supplier_code = Column(String(60), index=True)  # for the eventual OBM import
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    updated_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


def normalize_supplier_name(name: str) -> str:
    """The single source of truth for supplier identity.

    Lowercase and strip ALL whitespace, so these are one supplier:
      "Mismatch Supplier", "mismatch supplier", "Mismatch  Supplier",
      " Mismatch Supplier "
    Punctuation is deliberately preserved - "Sdn. Bhd." and "Sdn Bhd" are
    different strings, and collapsing punctuation risks merging two real
    companies. Casing and spacing are the only safe things to ignore.
    """
    return "".join(str(name or "").lower().split())


class TaxProfile(Base):
    __tablename__ = "tax_profiles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    country = Column(String(10), nullable=False)
    currency = Column(String(5), nullable=False, default="MYR")
    tax_type = Column(String(30), nullable=False, default="SALES_TAX")
    rate = Column(Numeric(7, 4), nullable=False, default=0)
    price_includes_tax = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
