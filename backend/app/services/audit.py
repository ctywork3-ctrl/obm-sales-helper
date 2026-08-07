import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


class AuditService:
    @staticmethod
    def _compute_hash(data: dict, previous_hash: str | None) -> str:
        payload = json.dumps(data, sort_keys=True, default=str)
        if previous_hash:
            payload = previous_hash + payload
        return hashlib.sha256(payload.encode()).hexdigest()

    @staticmethod
    async def log(
        db: AsyncSession,
        action: str,
        actor_user_id: int | None = None,
        actor_role_at_time: str | None = None,
        entity_type: str | None = None,
        entity_id: int | None = None,
        entity_label: str | None = None,
        old_values: dict | None = None,
        new_values: dict | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        result: str = "SUCCESS",
        error_message: str | None = None,
        request_id: str | None = None,
    ) -> AuditLog:
        previous_hash = None
        last_log = await db.execute(
            select(AuditLog).order_by(AuditLog.id.desc()).limit(1)
        )
        last_log_row = last_log.scalar_one_or_none()
        if last_log_row:
            previous_hash = last_log_row.record_hash

        record_data = {
            "action": action,
            "actor_user_id": actor_user_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "result": result,
        }
        record_hash = AuditService._compute_hash(record_data, previous_hash)

        audit_log = AuditLog(
            request_id=request_id,
            actor_type="USER",
            actor_user_id=actor_user_id,
            actor_role_at_time=actor_role_at_time,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            old_values_json=old_values,
            new_values_json=new_values,
            ip_address=ip_address,
            user_agent=user_agent,
            result=result,
            error_message=error_message,
            previous_hash=previous_hash,
            record_hash=record_hash,
        )
        db.add(audit_log)
        await db.flush()
        return audit_log
