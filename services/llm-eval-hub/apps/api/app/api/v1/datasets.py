from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from apps.api.app.core.auth import Actor, require_actor
from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import Dataset, DatasetVersion
from apps.api.app.schemas.datasets import (
    DatasetCreate,
    DatasetRead,
    DatasetValidationResponse,
    DatasetVersionRead,
)
from apps.api.app.services.audit import record_audit
from packages.eval_engine.datasets import DatasetValidationError, ValidatedDataset, validate_dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])
MAX_DATASET_BYTES = 256 * 1024 * 1024


def _validate_uploads(manifest_file: UploadFile, data_file: UploadFile) -> ValidatedDataset:
    manifest_bytes = manifest_file.file.read(MAX_DATASET_BYTES + 1)
    data_bytes = data_file.file.read(MAX_DATASET_BYTES + 1)
    if len(manifest_bytes) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail={"code": "MANIFEST_TOO_LARGE"})
    if len(data_bytes) > MAX_DATASET_BYTES:
        raise HTTPException(status_code=413, detail={"code": "DATASET_TOO_LARGE"})
    with tempfile.TemporaryDirectory(prefix="evalhub-dataset-") as temp_dir:
        manifest_path = Path(temp_dir) / "manifest.yaml"
        data_path = Path(temp_dir) / "data.jsonl"
        manifest_path.write_bytes(manifest_bytes)
        data_path.write_bytes(data_bytes)
        try:
            return validate_dataset(manifest_path, data_path)
        except (DatasetValidationError, yaml.YAMLError, UnicodeDecodeError) as exc:
            errors = exc.errors if isinstance(exc, DatasetValidationError) else [str(exc)]
            raise HTTPException(
                status_code=422,
                detail={"code": "DATASET_INVALID", "errors": errors[:100]},
            ) from exc


@router.post("", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def create_dataset(
    payload: DatasetCreate,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> Dataset:
    dataset = Dataset(**payload.model_dump())
    try:
        db.add(dataset)
        db.flush()
        record_audit(
            db,
            actor=actor.username,
            action="dataset.create",
            resource_type="dataset",
            resource_id=dataset.id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "DATASET_NAME_EXISTS"}) from exc
    db.refresh(dataset)
    return dataset


@router.get("", response_model=list[DatasetRead])
def list_datasets(
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> list[Dataset]:
    return list(
        db.scalars(
            select(Dataset)
            .options(selectinload(Dataset.versions))
            .order_by(Dataset.created_at.desc())
        ).unique()
    )


@router.post("/validate", response_model=DatasetValidationResponse)
def validate_dataset_upload(
    manifest_file: Annotated[UploadFile, File()],
    data_file: Annotated[UploadFile, File()],
    _: Actor = Depends(require_actor),
) -> DatasetValidationResponse:
    validated = _validate_uploads(manifest_file, data_file)
    return DatasetValidationResponse(
        valid=True,
        dataset_name=validated.manifest.metadata.name,
        version=validated.manifest.metadata.version,
        checksum=validated.checksum_sha256,
        row_count=len(validated.samples),
        sample_preview=[
            {
                "sample_id": sample.sample_id,
                "inputs": dict(sample.inputs),
                "reference": sample.reference,
                "metadata": dict(sample.metadata),
            }
            for sample in validated.samples[:5]
        ],
    )


@router.post(
    "/{dataset_id}/versions",
    response_model=DatasetVersionRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_dataset_version(
    dataset_id: str,
    manifest_file: Annotated[UploadFile, File()],
    data_file: Annotated[UploadFile, File()],
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DatasetVersion:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail={"code": "DATASET_NOT_FOUND"})
    validated = _validate_uploads(manifest_file, data_file)
    if validated.manifest.metadata.name != dataset.name:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "DATASET_NAME_MISMATCH",
                "message": "Manifest metadata.name must match the dataset name",
            },
        )
    version = validated.manifest.metadata.version
    existing = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset.id,
            DatasetVersion.version == version,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail={"code": "DATASET_VERSION_IMMUTABLE"})

    destination = settings.artifact_root / "datasets" / dataset.id / version
    try:
        destination.mkdir(parents=True, exist_ok=False)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail={"code": "DATASET_VERSION_IMMUTABLE"}) from exc
    manifest_path = destination / "manifest.yaml"
    data_path = destination / "data.jsonl"
    frozen_manifest = validated.manifest.model_dump(mode="json", exclude_none=True)
    try:
        manifest_path.write_text(
            yaml.safe_dump(
                frozen_manifest,
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        data_file.file.seek(0)
        with data_path.open("wb") as destination_file:
            shutil.copyfileobj(data_file.file, destination_file)
        dataset_version = DatasetVersion(
            dataset_id=dataset.id,
            version=version,
            manifest_json=frozen_manifest,
            manifest_uri=str(manifest_path),
            data_uri=str(data_path),
            checksum=validated.checksum_sha256,
            row_count=len(validated.samples),
        )
        db.add(dataset_version)
        db.flush()
        record_audit(
            db,
            actor=actor.username,
            action="dataset.version.create",
            resource_type="dataset_version",
            resource_id=dataset_version.id,
            metadata={"checksum": validated.checksum_sha256, "row_count": len(validated.samples)},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        shutil.rmtree(destination, ignore_errors=True)
        raise HTTPException(
            status_code=409, detail={"code": "DATASET_VERSION_IMMUTABLE"}
        ) from exc
    except Exception:
        db.rollback()
        shutil.rmtree(destination, ignore_errors=True)
        raise
    db.refresh(dataset_version)
    return dataset_version


@router.get("/{dataset_id}/versions/{version}", response_model=DatasetVersionRead)
def get_dataset_version(
    dataset_id: str,
    version: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> DatasetVersion:
    dataset_version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset_id,
            DatasetVersion.version == version,
        )
    )
    if dataset_version is None:
        raise HTTPException(status_code=404, detail={"code": "DATASET_VERSION_NOT_FOUND"})
    return dataset_version


@router.get("/{dataset_id}/versions/{version}/preview")
def preview_dataset_version(
    dataset_id: str,
    version: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> dict:
    dataset_version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset_id,
            DatasetVersion.version == version,
        )
    )
    if dataset_version is None:
        raise HTTPException(status_code=404, detail={"code": "DATASET_VERSION_NOT_FOUND"})
    rows: list[dict] = []
    with Path(dataset_version.data_uri).open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            if index < offset:
                continue
            if len(rows) >= limit:
                break
            rows.append(json.loads(line))
    return {"items": rows, "offset": offset, "limit": limit, "total": dataset_version.row_count}
