from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    obm_customer_code = Column(String(50))
    code = Column(String(50), unique=True, index=True)
    name = Column(String(200), nullable=False)
    phone = Column(String(20))
    email = Column(String(100))
    address = Column(Text)
    is_active = Column(Boolean, default=True)
    salesman_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    contacts = relationship("CustomerContact", back_populates="customer", cascade="all, delete-orphan")
    addresses = relationship("CustomerAddress", back_populates="customer", cascade="all, delete-orphan")
    salesman = relationship("User", foreign_keys=[salesman_id])

    @property
    def salesman_name(self) -> str | None:
        return self.salesman.full_name if self.salesman is not None else None


class CustomerContact(Base):
    __tablename__ = "sales_customer_contacts"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    job_title = Column(String(100))
    phone = Column(String(30))
    mobile = Column(String(30))
    email = Column(String(150))
    whatsapp = Column(String(30))
    is_primary = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    customer = relationship("Customer", back_populates="contacts")


class CustomerAddress(Base):
    __tablename__ = "sales_customer_addresses"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    address_type = Column(String(30), nullable=False, default="DELIVERY")
    label = Column(String(100), nullable=False)
    address_line1 = Column(String(255), nullable=False)
    address_line2 = Column(String(255))
    postcode = Column(String(20))
    city = Column(String(100))
    state = Column(String(100))
    country = Column(String(10), nullable=False, default="MY")
    contact_name = Column(String(150))
    contact_phone = Column(String(30))
    delivery_notes = Column(Text)
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    customer = relationship("Customer", back_populates="addresses")
