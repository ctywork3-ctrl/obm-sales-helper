from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class ProductUnitImage(Base):
    __tablename__ = "product_unit_images"

    id = Column(Integer, primary_key=True, index=True)
    product_unit_id = Column(Integer, ForeignKey("product_units.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    image_type = Column(String(30), nullable=False, default="EVIDENCE")
    caption = Column(Text)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    product_unit = relationship("ProductUnit", back_populates="images")
