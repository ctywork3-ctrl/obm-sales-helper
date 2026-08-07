from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    request_id = Column(String(50))
    actor_type = Column(String(20), default="USER")
    actor_user_id = Column(Integer, ForeignKey("users.id"))
    actor_role_at_time = Column(String(20))
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    entity_label = Column(String(200))
    old_values_json = Column(JSON)
    new_values_json = Column(JSON)
    ip_address = Column(String(50))
    user_agent = Column(String(500))
    result = Column(String(20), default="SUCCESS")
    error_message = Column(Text)
    previous_hash = Column(String(64))
    record_hash = Column(String(64))
