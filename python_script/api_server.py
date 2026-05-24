"""
HTTP API for the YouTube → Word installation guide pipeline.

Sunil contract (Node backend):
  POST /jobs          { "url": "..." }  →  { "job_id": "..." }
  GET  /jobs/<id>     →  queued | started | completed | failed

Start:
  pip install -r requirements.txt
  uvicorn api_server:app --host 127.0.0.1 --port 4000

Production output:
  DELIVERABLE_OUTPUT_DIR=/var/data/videototext/output
  DELIVERABLE_FILENAME_STYLE=video_id
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, HttpUrl

APP_ROOT = Path(__file__).resolve().parent


def _resolve_app_path(raw: str) -> Path:
    """Resolve relative paths against this package dir (stable under pm2/systemd)."""
    p = Path(raw)
    return p.resolve() if p.is_absolute() else (APP_ROOT / p).resolve()


load_dotenv(APP_ROOT / ".env")

from youtube_to_word_pipeline import (  # noqa: E402
    DELIVERABLE_OUTPUT_DIR,
    PipelinePromptOverrides,
    run_full_pipeline,
    yt_dlp_config_status,
)

logger = logging.getLogger("yt_api")

API_KEY = os.getenv("API_KEY", "").strip()
API_JOBS_DIR = _resolve_app_path(os.getenv("API_JOBS_DIR", "api_jobs"))
API_MAX_CONCURRENT_JOBS = int(os.getenv("API_MAX_CONCURRENT_JOBS", "1"))
API_CLEANUP_WORKSPACE_ON_SUCCESS = (
    os.getenv("API_CLEANUP_WORKSPACE_ON_SUCCESS", "true").lower() == "true"
)
API_CLEANUP_WORKSPACE_ON_FAILURE = (
    os.getenv("API_CLEANUP_WORKSPACE_ON_FAILURE", "false").lower() == "true"
)
API_DELETE_JOB_DIR_ON_SUCCESS = (
    os.getenv("API_DELETE_JOB_DIR_ON_SUCCESS", "true").lower() == "true"
)
API_DELETE_JOB_DIR_ON_FAILURE = (
    os.getenv("API_DELETE_JOB_DIR_ON_FAILURE", "false").lower() == "true"
)
API_PRUNE_OLD_JOBS_DAYS = int(os.getenv("API_PRUNE_OLD_JOBS_DAYS", "7"))
API_JOB_ARCHIVE_DIR = API_JOBS_DIR / "_archive"
API_DEFAULT_SKIP_DEDUP = os.getenv("API_DEFAULT_SKIP_DEDUP", "false").lower() == "true"

_bearer_scheme = HTTPBearer(auto_error=False)

_job_semaphore = asyncio.Semaphore(max(1, API_MAX_CONCURRENT_JOBS))
_active_job_id: Optional[str] = None


class SunilCreateJobRequest(BaseModel):
    url: HttpUrl


class SunilCreateJobResponse(BaseModel):
    job_id: str


class SunilJobStatusResponse(BaseModel):
    status: str
    output_filename: Optional[str] = None
    error: Optional[str] = None


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class PromptTweaks(BaseModel):
    """Optional text merged into Claude prompts — does not replace the full pipeline."""

    step_instructions: str = Field(
        default="",
        description="Extra rules for step extraction (granularity, terminology, etc.).",
    )
    tools_instructions: str = Field(
        default="",
        description="Extra guidance for tools / hardware / difficulty extraction.",
    )
    important_note: str = Field(
        default="",
        description="Override the yellow IMPORTANT box in the Word document.",
    )


class CreateJobRequest(BaseModel):
    youtube_url: HttpUrl
    title: Optional[str] = Field(
        default=None,
        description="Optional document title override.",
    )
    prompt_tweaks: Optional[PromptTweaks] = None
    skip_dedup: bool = False


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus
    youtube_url: str
    created_at: str
    updated_at: str
    title: Optional[str] = None
    prompt_tweaks: Optional[PromptTweaks] = None
    output_dir: Optional[str] = None
    deliverable_path: Optional[str] = None
    output_filename: Optional[str] = Field(
        default=None,
        description="Basename of the finished .docx (for SQL / dashboard linking).",
    )
    workspace_cleaned: Optional[bool] = None
    job_dir_deleted: Optional[bool] = None
    step_count: Optional[int] = None
    error: Optional[str] = None
    quality_report: Optional[dict[str, Any]] = None


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    API_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    if DELIVERABLE_OUTPUT_DIR:
        Path(DELIVERABLE_OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    pruned = await asyncio.to_thread(_prune_old_job_dirs)
    if pruned:
        logger.info("Pruned %d old job folder(s) from %s", pruned, API_JOBS_DIR)
    yield


app = FastAPI(
    title="Turn Offroad Installation Guide API",
    description="Queue YouTube installation videos → Word guide (.docx).",
    version="1.1.0",
    lifespan=_lifespan,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_dir(job_id: str) -> Path:
    return API_JOBS_DIR / job_id


def _status_path(job_id: str) -> Path:
    return _job_dir(job_id) / "job.json"


def _archive_path(job_id: str) -> Path:
    return API_JOB_ARCHIVE_DIR / f"{job_id}.json"


def _load_job(job_id: str) -> JobRecord:
    for path in (_status_path(job_id), _archive_path(job_id)):
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return JobRecord.model_validate(json.load(f))
    raise HTTPException(status_code=404, detail=f"Job {job_id} not found")


def _write_archive(record: JobRecord) -> None:
    API_JOB_ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with open(_archive_path(record.job_id), "w", encoding="utf-8") as f:
        json.dump(record.model_dump(mode="json"), f, indent=2)


def _save_job(record: JobRecord) -> None:
    path = _status_path(record.job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record.model_dump(mode="json"), f, indent=2)


def _persist_job_record(record: JobRecord) -> None:
    """Keep live job.json while running; archive terminal states for post-cleanup polling."""
    if record.status in {JobStatus.completed, JobStatus.failed}:
        _write_archive(record)
    if _job_dir(record.job_id).exists():
        _save_job(record)


def _extract_youtube_video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{6,})", url)
    return m.group(1) if m else "guide"


def _humanize_error(raw: str) -> str:
    text = (raw or "Unknown error").strip()
    lower = text.lower()
    if "yt-dlp" in lower or ("download" in lower and "failed" in lower):
        if any(
            marker in lower
            for marker in ("not a bot", "sign in to confirm", "bot check", "http error 403")
        ):
            return (
                "YouTube blocked the download from this server. "
                "Refresh YT_DLP_COOKIES_FILE or configure a residential proxy."
            )
        return "Could not download video. Check the YouTube URL and network connection."
    if "no transcript" in lower or "no speech" in lower:
        return "No usable speech found in the video audio."
    if "no installation steps" in lower or "returned no" in lower and "step" in lower:
        return "Could not extract installation steps from the video."
    if "deliverable" in lower and "not found" in lower:
        return "Document was built but could not be saved to the output folder."
    if "api key" in lower or "401" in lower or "403" in lower:
        return "AI service authentication failed. Check server API keys."
    if "rate limit" in lower or "429" in lower:
        return "AI service rate limit reached. Try again in a few minutes."
    if "timeout" in lower or "timed out" in lower:
        return "Processing timed out. Try again or use a shorter video."
    if "document" in lower or "docx" in lower or "word" in lower:
        return "Document generation failed."
    if len(text) > 240:
        return text[:240].rsplit(" ", 1)[0] + "..."
    return text


def _sunil_status_response(record: JobRecord) -> SunilJobStatusResponse:
    if record.status == JobStatus.queued:
        return SunilJobStatusResponse(status="queued")
    if record.status == JobStatus.running:
        return SunilJobStatusResponse(status="started")
    if record.status == JobStatus.completed:
        vid = _extract_youtube_video_id(record.youtube_url)
        filename = record.output_filename or f"{vid}.docx"
        return SunilJobStatusResponse(status="completed", output_filename=filename)
    return SunilJobStatusResponse(
        status="failed",
        error=_humanize_error(record.error or "Processing failed"),
    )


def _queue_job(
    *,
    youtube_url: str,
    background_tasks: BackgroundTasks,
    title: Optional[str] = None,
    prompt_tweaks: Optional[PromptTweaks] = None,
    skip_dedup: bool = False,
) -> str:
    job_id = str(uuid.uuid4())
    now = _utc_now()
    record = JobRecord(
        job_id=job_id,
        status=JobStatus.queued,
        youtube_url=youtube_url,
        created_at=now,
        updated_at=now,
        title=title,
        prompt_tweaks=prompt_tweaks,
    )
    job_root = _job_dir(job_id)
    job_root.mkdir(parents=True, exist_ok=True)
    with open(job_root / "request.json", "w", encoding="utf-8") as rf:
        json.dump({"skip_dedup": skip_dedup}, rf)
    _save_job(record)
    background_tasks.add_task(_run_job, job_id)
    return job_id


def _verify_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> None:
    if not API_KEY:
        return
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    if credentials.credentials != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


def _path_is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _apply_deliverable_fields(record: JobRecord, deliverable_path: Optional[str]) -> None:
    if deliverable_path:
        record.deliverable_path = deliverable_path
        record.output_filename = Path(deliverable_path).name
    else:
        record.output_filename = None


def _promote_deliverable_out_of_workspace(job_id: str, deliverable_path: str, work_dir: Path) -> str:
    """
    If the only copy of the guide lives under workspace/, copy it to the job root
    so workspace/ can be deleted without breaking GET .../document.
    """
    src = Path(deliverable_path)
    if not src.exists():
        fallback = work_dir / "installation_guide.docx"
        if not fallback.exists():
            raise FileNotFoundError(f"No deliverable under workspace for job {job_id}")
        src = fallback

    if not _path_is_under(src, work_dir):
        return str(src.resolve())

    job_root = _job_dir(job_id)
    dest = job_root / src.name
    if dest.resolve() != src.resolve():
        shutil.copy2(src, dest)
        logger.info("Job %s: copied deliverable to %s", job_id, dest)
    return str(dest.resolve())


def _release_pipeline_log_handlers() -> None:
    """Close FileHandlers so pipeline.log is not locked during workspace cleanup."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, logging.FileHandler):
            handler.close()
            root.removeHandler(handler)


def _finalize_job(job_id: str, record: JobRecord, *, delete_entire_dir: bool) -> JobRecord:
    """
    Production cleanup after each run.
    - delete_entire_dir: archive metadata, release pipeline.log, remove api_jobs/<id>/
    - else: remove workspace/ only (video, frames, logs) when legacy flags request it
    """
    job_root = _job_dir(job_id)
    work_dir = job_root / "workspace"

    if record.status == JobStatus.completed:
        deliverable = record.deliverable_path
        if not deliverable or not Path(deliverable).exists():
            if work_dir.exists():
                record.deliverable_path = _promote_deliverable_out_of_workspace(
                    job_id, deliverable or "", work_dir,
                )
                record.output_filename = Path(record.deliverable_path).name
            else:
                raise FileNotFoundError(
                    f"Job {job_id} completed but deliverable not found; refusing cleanup"
                )

    freed_mb = _dir_size_bytes(job_root if delete_entire_dir else work_dir) / 1_048_576
    _release_pipeline_log_handlers()

    if delete_entire_dir:
        if job_root.exists():
            shutil.rmtree(job_root, ignore_errors=False)
        record.workspace_cleaned = True
        record.job_dir_deleted = True
        logger.info(
            "Job %s: deleted job dir (freed ~%.1f MB); deliverable=%s",
            job_id,
            freed_mb,
            record.deliverable_path or "(none)",
        )
        return record

    if not work_dir.exists():
        record.workspace_cleaned = True
        return record

    if record.status == JobStatus.completed and record.deliverable_path:
        record.deliverable_path = _promote_deliverable_out_of_workspace(
            job_id, record.deliverable_path, work_dir,
        )
        record.output_filename = Path(record.deliverable_path).name

    shutil.rmtree(work_dir, ignore_errors=False)
    record.workspace_cleaned = True
    logger.info(
        "Job %s: removed workspace (freed ~%.1f MB); deliverable=%s",
        job_id,
        freed_mb,
        record.deliverable_path or "(none)",
    )
    return record


def _prune_old_job_dirs() -> int:
    """Delete stale api_jobs/<id>/ folders and archived job.json files."""
    if API_PRUNE_OLD_JOBS_DAYS <= 0 or not API_JOBS_DIR.exists():
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=API_PRUNE_OLD_JOBS_DAYS)
    removed = 0

    if API_JOB_ARCHIVE_DIR.exists():
        for archive_file in API_JOB_ARCHIVE_DIR.glob("*.json"):
            try:
                with open(archive_file, encoding="utf-8") as f:
                    job = JobRecord.model_validate(json.load(f))
                dt = datetime.fromisoformat(job.updated_at.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = datetime.fromtimestamp(archive_file.stat().st_mtime, tz=timezone.utc)
            if dt < cutoff:
                try:
                    archive_file.unlink(missing_ok=True)
                    removed += 1
                except OSError as exc:
                    logger.warning("Could not prune archive %s: %s", archive_file, exc)

    for child in API_JOBS_DIR.iterdir():
        if not child.is_dir() or child.name == "_archive":
            continue
        if _active_job_id and child.name == _active_job_id:
            continue
        stamp_path = child / "job.json"
        if stamp_path.exists():
            try:
                with open(stamp_path, encoding="utf-8") as f:
                    job = JobRecord.model_validate(json.load(f))
                if job.status in {JobStatus.queued, JobStatus.running}:
                    continue
                dt = datetime.fromisoformat(job.updated_at.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = datetime.fromtimestamp(stamp_path.stat().st_mtime, tz=timezone.utc)
        else:
            dt = datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc)

        if dt >= cutoff:
            continue
        try:
            shutil.rmtree(child)
            removed += 1
            logger.info("Pruned old job dir %s (last activity %s)", child.name, dt.date())
        except OSError as exc:
            logger.warning("Could not prune %s: %s", child, exc)
    return removed


def _should_delete_job_dir(status: JobStatus) -> bool:
    if status == JobStatus.completed:
        return API_DELETE_JOB_DIR_ON_SUCCESS
    if status == JobStatus.failed:
        return API_DELETE_JOB_DIR_ON_FAILURE
    return False


def _should_cleanup_workspace_only(status: JobStatus) -> bool:
    if _should_delete_job_dir(status):
        return False
    if status == JobStatus.completed:
        return API_CLEANUP_WORKSPACE_ON_SUCCESS
    if status == JobStatus.failed:
        return API_CLEANUP_WORKSPACE_ON_FAILURE
    return False


async def _run_job(job_id: str) -> None:
    global _active_job_id
    record = _load_job(job_id)
    record.status = JobStatus.running
    record.updated_at = _utc_now()
    _save_job(record)

    work_dir = _job_dir(job_id) / "workspace"
    overrides = PipelinePromptOverrides()
    if record.prompt_tweaks:
        overrides = PipelinePromptOverrides(
            step_prompt_extra=record.prompt_tweaks.step_instructions,
            tools_prompt_extra=record.prompt_tweaks.tools_instructions,
            important_note=record.prompt_tweaks.important_note,
        )

    async with _job_semaphore:
        _active_job_id = job_id
        try:
            skip_dedup = False
            meta_path = _job_dir(job_id) / "request.json"
            if meta_path.exists():
                with open(meta_path, encoding="utf-8") as mf:
                    skip_dedup = bool(json.load(mf).get("skip_dedup", False))

            result = await run_full_pipeline(
                record.youtube_url,
                work_dir,
                skip_dedup=skip_dedup,
                title=record.title,
                prompt_overrides=overrides,
                verbose=True,
            )
            record.status = JobStatus.completed
            record.output_dir = result.output_dir
            _apply_deliverable_fields(record, result.deliverable_path)
            record.step_count = result.step_count
            record.quality_report = result.quality_report
            record.title = result.video_title
            record.error = None
        except Exception as exc:
            logger.exception("Job %s failed", job_id)
            record.status = JobStatus.failed
            record.error = _humanize_error(str(exc))
        finally:
            _active_job_id = None
            record.updated_at = _utc_now()

            delete_entire = _should_delete_job_dir(record.status)
            cleanup_workspace = _should_cleanup_workspace_only(record.status)
            if delete_entire or cleanup_workspace:
                try:
                    record = await asyncio.to_thread(
                        _finalize_job,
                        job_id,
                        record,
                        delete_entire_dir=delete_entire,
                    )
                except Exception as exc:
                    logger.warning("Job %s: cleanup failed: %s", job_id, exc)

            _persist_job_record(record)


@app.get("/health")
async def health() -> dict[str, Any]:
    jobs_bytes = _dir_size_bytes(API_JOBS_DIR) if API_JOBS_DIR.exists() else 0
    return {
        "ok": True,
        "app_root": str(APP_ROOT),
        "active_job": _active_job_id,
        "max_concurrent_jobs": API_MAX_CONCURRENT_JOBS,
        "deliverable_output_dir": DELIVERABLE_OUTPUT_DIR or None,
        "jobs_dir": str(API_JOBS_DIR.resolve()),
        "api_jobs_size_mb": round(jobs_bytes / 1_048_576, 2),
        "delete_job_dir_on_success": API_DELETE_JOB_DIR_ON_SUCCESS,
        "delete_job_dir_on_failure": API_DELETE_JOB_DIR_ON_FAILURE,
        "cleanup_on_success": API_CLEANUP_WORKSPACE_ON_SUCCESS,
        "cleanup_on_failure": API_CLEANUP_WORKSPACE_ON_FAILURE,
        "prune_old_jobs_days": API_PRUNE_OLD_JOBS_DAYS,
        "job_archive_dir": str(API_JOB_ARCHIVE_DIR.resolve()),
        "yt_dlp": yt_dlp_config_status(),
    }


@app.post("/jobs", response_model=SunilCreateJobResponse, status_code=202)
async def create_job_sunil(
    body: SunilCreateJobRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(_verify_api_key),
) -> SunilCreateJobResponse:
    """Sunil contract: accept URL, return job_id immediately."""
    job_id = _queue_job(
        youtube_url=str(body.url),
        background_tasks=background_tasks,
        skip_dedup=API_DEFAULT_SKIP_DEDUP,
    )
    return SunilCreateJobResponse(job_id=job_id)


@app.get("/jobs/{job_id}", response_model=SunilJobStatusResponse)
async def get_job_sunil(
    job_id: str,
    _: None = Depends(_verify_api_key),
) -> SunilJobStatusResponse:
    """Sunil contract: queued | started | completed | failed."""
    return _sunil_status_response(_load_job(job_id))


@app.post("/api/v1/jobs", response_model=JobRecord, status_code=202)
async def create_job(
    body: CreateJobRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(_verify_api_key),
) -> JobRecord:
    """
    Extended API (dev): prompt tweaks + skip_dedup. Poll GET /api/v1/jobs/{job_id}.
    """
    job_id = _queue_job(
        youtube_url=str(body.youtube_url),
        background_tasks=background_tasks,
        title=body.title,
        prompt_tweaks=body.prompt_tweaks,
        skip_dedup=body.skip_dedup,
    )
    return _load_job(job_id)


@app.get("/api/v1/jobs", response_model=list[JobRecord])
async def list_jobs(
    limit: int = 20,
    _: None = Depends(_verify_api_key),
) -> list[JobRecord]:
    jobs_by_id: dict[str, JobRecord] = {}
    if API_JOBS_DIR.exists():
        for child in API_JOBS_DIR.iterdir():
            if not child.is_dir() or child.name == "_archive":
                continue
            status_file = child / "job.json"
            if status_file.exists():
                try:
                    with open(status_file, encoding="utf-8") as f:
                        rec = JobRecord.model_validate(json.load(f))
                    jobs_by_id[rec.job_id] = rec
                except Exception:
                    continue
    if API_JOB_ARCHIVE_DIR.exists():
        for archive_file in API_JOB_ARCHIVE_DIR.glob("*.json"):
            try:
                with open(archive_file, encoding="utf-8") as f:
                    rec = JobRecord.model_validate(json.load(f))
                jobs_by_id.setdefault(rec.job_id, rec)
            except Exception:
                continue
    jobs = sorted(jobs_by_id.values(), key=lambda r: r.updated_at, reverse=True)
    return jobs[:limit]


@app.get("/api/v1/jobs/{job_id}", response_model=JobRecord)
async def get_job(job_id: str, _: None = Depends(_verify_api_key)) -> JobRecord:
    return _load_job(job_id)


@app.get("/api/v1/jobs/{job_id}/document")
async def download_document(job_id: str, _: None = Depends(_verify_api_key)) -> FileResponse:
    record = _load_job(job_id)
    if record.status != JobStatus.completed:
        raise HTTPException(
            status_code=409,
            detail=f"Job status is {record.status}; document not ready.",
        )
    doc_path = record.deliverable_path
    if not doc_path or not Path(doc_path).exists():
        for fallback in (
            _job_dir(job_id) / "installation_guide.docx",
            _job_dir(job_id) / "workspace" / "installation_guide.docx",
        ):
            if fallback.exists():
                doc_path = str(fallback)
                break
        else:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Document not found. Finished guides live in DELIVERABLE_OUTPUT_DIR "
                    "(output_filename on the job record)."
                ),
            )
    return FileResponse(
        path=doc_path,
        filename=record.output_filename or Path(doc_path).name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )