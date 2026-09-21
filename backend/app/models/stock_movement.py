from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.database import Base


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity_delta = Column(Integer, nullable=False)
    movement_type = Column(String(50), nullable=False, index=True)
    source_type = Column(String(50), nullable=True)
    source_id = Column(Integer, nullable=True)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    reason = Column(Text, nullable=True)
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
