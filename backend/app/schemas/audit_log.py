from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: int
    created_at: datetime | None = None
    request_id: str | None = None
    actor_type: str | None = None
    actor_user_id: int | None = None
    actor_name: str | None = None
    actor_role_at_time: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    entity_label: str | None = None
    old_values_json: dict | None = None
    new_values_json: dict | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    result: str | None = None
    error_message: str | None = None

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    page_size: int
    pages: int = 0
