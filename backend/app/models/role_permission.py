from sqlalchemy import Column, Integer, String, Boolean, DateTime, func

from app.database import Base


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String(20), nullable=False, index=True)
    page_key = Column(String(50), nullable=False)
    label = Column(String(100), nullable=False)
    is_visible = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
