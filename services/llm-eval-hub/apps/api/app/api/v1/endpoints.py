from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from apps.api.app.core.auth import Actor, require_actor
from apps.api.app.core.crypto import SecretCipher
from apps.api.app.core.network import EndpointPolicyError, validate_endpoint_url
from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import Endpoint, EndpointCapability, EndpointRevision, Model, Run
from apps.api.app.schemas.endpoints import (
    EndpointCreate,
    EndpointModelCreate,
    EndpointModelRead,
    EndpointRead,
    EndpointUpdate,
    ProbeRequest,
    ProbeResponse,
)
from apps.api.app.services.audit import record_audit
from apps.api.app.services.endpoints import probe_openai_endpoint, sanitized_extra_headers
from packages.eval_engine.fingerprint import protocol_fingerprint

router = APIRouter(prefix="/endpoints", tags=["endpoints"])


def _endpoint_policy_error(exc: EndpointPolicyError | ValueError) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={"code": "ENDPOINT_POLICY", "message": str(exc)},
    )


def _active_revision(db: Session, endpoint: Endpoint) -> EndpointRevision:
    revision = db.get(EndpointRevision, endpoint.active_revision_id)
    if revision is None:
        raise HTTPException(status_code=409, detail={"code": "ENDPOINT_REVISION_MISSING"})
    return revision


def _serialize_endpoint(db: Session, endpoint: Endpoint) -> EndpointRead:
    revision = _active_revision(db, endpoint)
    capability = db.scalar(
        select(EndpointCapability)
        .where(EndpointCapability.revision_id == revision.id)
        .order_by(EndpointCapability.checked_at.desc())
        .limit(1)
    )
    return EndpointRead(
        id=endpoint.id,
        name=endpoint.name,
        base_url=endpoint.base_url,
        auth_type=endpoint.auth_type,
        status=endpoint.status,
        owner=endpoint.owner,
        active_revision_id=endpoint.active_revision_id,
        api_key_configured=revision.secret_ciphertext is not None,
        secret_hint=revision.secret_hint,
        concurrency_limit=revision.config_json.get("concurrency_limit", 8),
        qps_limit=revision.config_json.get("qps_limit", 10),
        capability=capability.capabilities_json if capability else None,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )


@router.post("", response_model=EndpointRead, status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    payload: EndpointCreate,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> EndpointRead:
    try:
        base_url = await validate_endpoint_url(payload.base_url, settings)
        extra_headers = sanitized_extra_headers(payload.extra_headers)
    except (EndpointPolicyError, ValueError) as exc:
        raise _endpoint_policy_error(exc) from exc
    endpoint = Endpoint(
        name=payload.name,
        base_url=base_url,
        auth_type=payload.auth_type,
        owner=actor.username,
    )
    db.add(endpoint)
    db.flush()
    config = {
        "base_url": base_url,
        "auth_type": payload.auth_type,
        "extra_headers": extra_headers,
        "concurrency_limit": payload.concurrency_limit,
        "qps_limit": payload.qps_limit,
    }
    revision = EndpointRevision(
        endpoint_id=endpoint.id,
        config_json=config,
        config_hash=protocol_fingerprint(config),
        secret_ciphertext=SecretCipher().encrypt(payload.api_key),
        secret_hint=payload.api_key[-4:] if payload.api_key else None,
    )
    db.add(revision)
    db.flush()
    endpoint.active_revision_id = revision.id
    if payload.model_name:
        db.add(
            Model(
                endpoint_id=endpoint.id,
                model_name=payload.model_name,
                display_name=payload.model_name,
                source="manual",
            )
        )
    record_audit(
        db,
        actor=actor.username,
        action="endpoint.create",
        resource_type="endpoint",
        resource_id=endpoint.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "ENDPOINT_NAME_EXISTS"}) from exc
    return _serialize_endpoint(db, endpoint)


@router.get("", response_model=list[EndpointRead])
def list_endpoints(
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> list[EndpointRead]:
    endpoints = db.scalars(select(Endpoint).order_by(Endpoint.created_at.desc())).all()
    return [_serialize_endpoint(db, endpoint) for endpoint in endpoints]


@router.get("/{endpoint_id}", response_model=EndpointRead)
def get_endpoint(
    endpoint_id: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> EndpointRead:
    endpoint = db.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    return _serialize_endpoint(db, endpoint)


@router.patch("/{endpoint_id}", response_model=EndpointRead)
async def update_endpoint(
    endpoint_id: str,
    payload: EndpointUpdate,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> EndpointRead:
    endpoint = db.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    previous = _active_revision(db, endpoint)
    changes = payload.model_dump(exclude_unset=True)
    try:
        base_url = await validate_endpoint_url(
            changes.get("base_url", endpoint.base_url), settings
        )
        config = dict(previous.config_json)
        config.update(
            {
                key: value
                for key, value in changes.items()
                if key not in {"api_key", "name"}
            }
        )
        config["base_url"] = base_url
        config["extra_headers"] = sanitized_extra_headers(config.get("extra_headers", {}))
    except (EndpointPolicyError, ValueError) as exc:
        raise _endpoint_policy_error(exc) from exc
    secret_ciphertext = previous.secret_ciphertext
    secret_hint = previous.secret_hint
    if "api_key" in changes:
        secret_ciphertext = SecretCipher().encrypt(changes["api_key"])
        secret_hint = changes["api_key"][-4:] if changes["api_key"] else None
    revision = EndpointRevision(
        endpoint_id=endpoint.id,
        config_json=config,
        config_hash=protocol_fingerprint(config),
        secret_ciphertext=secret_ciphertext,
        secret_hint=secret_hint,
    )
    db.add(revision)
    db.flush()
    endpoint.active_revision_id = revision.id
    endpoint.base_url = base_url
    endpoint.auth_type = config["auth_type"]
    endpoint.name = changes.get("name", endpoint.name)
    endpoint.status = "unverified"
    record_audit(
        db,
        actor=actor.username,
        action="endpoint.update",
        resource_type="endpoint",
        resource_id=endpoint.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "ENDPOINT_NAME_EXISTS"}) from exc
    return _serialize_endpoint(db, endpoint)


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_endpoint(
    endpoint_id: str,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> Response:
    endpoint = db.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    referenced_run_id = db.scalar(
        select(Run.id)
        .join(EndpointRevision, Run.endpoint_revision_id == EndpointRevision.id)
        .where(EndpointRevision.endpoint_id == endpoint.id)
        .limit(1)
    )
    if referenced_run_id is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ENDPOINT_IN_USE",
                "message": "该 Endpoint 已被历史评测引用，不能永久删除。",
            },
        )
    record_audit(
        db,
        actor=actor.username,
        action="endpoint.delete",
        resource_type="endpoint",
        resource_id=endpoint.id,
        metadata={"name": endpoint.name},
    )
    db.delete(endpoint)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{endpoint_id}/probe", response_model=ProbeResponse)
async def probe_endpoint(
    endpoint_id: str,
    payload: ProbeRequest,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ProbeResponse:
    endpoint = db.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    revision = _active_revision(db, endpoint)
    try:
        base_url = await validate_endpoint_url(endpoint.base_url, settings)
    except EndpointPolicyError as exc:
        raise _endpoint_policy_error(exc) from exc
    requested_model = payload.model_name or db.scalar(
        select(Model.model_name)
        .where(Model.endpoint_id == endpoint.id, Model.enabled.is_(True))
        .order_by(Model.model_name)
        .limit(1)
    )
    result = await probe_openai_endpoint(
        base_url=base_url,
        auth_type=endpoint.auth_type,
        api_key=SecretCipher().decrypt(revision.secret_ciphertext),
        extra_headers=revision.config_json.get("extra_headers", {}),
        requested_model=requested_model,
        timeout_seconds=payload.timeout_seconds,
    )
    capability = EndpointCapability(
        revision_id=revision.id,
        capabilities_json=result["capabilities"],
        probe_status=result["status"],
        latency_ms=result.get("latency_ms"),
        error_type=result.get("error_type"),
        error_message_redacted=result.get("error_message"),
    )
    db.add(capability)
    endpoint.status = result["status"]
    record_audit(
        db,
        actor=actor.username,
        action="endpoint.probe",
        resource_type="endpoint",
        resource_id=endpoint.id,
        metadata={
            "status": result["status"],
            "error_type": result.get("error_type"),
            "model_name": requested_model,
        },
    )
    db.commit()
    return ProbeResponse(**result)


@router.get("/{endpoint_id}/models", response_model=list[EndpointModelRead])
def list_models(
    endpoint_id: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> list[Model]:
    return list(
        db.scalars(select(Model).where(Model.endpoint_id == endpoint_id).order_by(Model.model_name))
    )


@router.post(
    "/{endpoint_id}/models",
    response_model=EndpointModelRead,
    status_code=status.HTTP_201_CREATED,
)
def add_model(
    endpoint_id: str,
    payload: EndpointModelCreate,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> Model:
    if db.get(Endpoint, endpoint_id) is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    model = Model(
        endpoint_id=endpoint_id,
        model_name=payload.model_name,
        display_name=payload.display_name or payload.model_name,
        source="manual",
    )
    db.add(model)
    db.flush()
    record_audit(
        db,
        actor=actor.username,
        action="model.create",
        resource_type="model",
        resource_id=model.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "MODEL_EXISTS"}) from exc
    db.refresh(model)
    return model
