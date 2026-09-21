import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, Numeric, String, func

from app.database import Base


class UserRole(str, enum.Enum):
    DEVELOPER = "DEVELOPER"
    IT_ADMIN = "IT_ADMIN"
    DIRECTOR = "DIRECTOR"
    OPERATIONS_MANAGER = "OPERATIONS_MANAGER"
    PURCHASE_MANAGER = "PURCHASE_MANAGER"
    MANAGER = "MANAGER"
    INSIDE_SALES = "INSIDE_SALES"
    OUTSIDE_SALES = "OUTSIDE_SALES"
    STOCK_KEEPER = "STOCK_KEEPER"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(100))
    email = Column(String(100))
    phone = Column(String(20))
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=True)
    password_changed_at = Column(DateTime)
    last_login_at = Column(DateTime)
    failed_login_count = Column(Integer, default=0)
    locked_until = Column(DateTime)
    commission_rate = Column(Numeric(5, 2), default=0)
    sales_target_monthly = Column(Numeric(12, 2), default=0)
    temp_password_display = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
