from sqlalchemy.orm import Session

from apps.api.app.db.models import AuditLog


def record_audit(
    db: Session,
    *,
    actor: str,
    action: str,
    resource_type: str,
    resource_id: str,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata_json=metadata or {},
        )
    )
