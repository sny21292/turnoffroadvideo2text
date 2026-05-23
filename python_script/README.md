# python_script/ — YouTube → Word pipeline (FastAPI HTTP service)

Standalone Python service that converts a YouTube install video into a polished `.docx` install guide. Exposes an HTTP API consumed by the Node backend (`backend/`) on the same droplet.

**Status:** deployed and live as of 2026-05-22. Running under PM2 as `v2t-python-pipeline`, bound to `127.0.0.1:4000` on the Video2Text droplet.

Owned by **Omons** (Python pipeline + AI integration). Integration contract was agreed with Sunil before implementation; see "API surface" below for the actual deployed endpoints.

## What it does

```
POST /api/v1/jobs  { youtube_url } ──► returns job_id immediately
                                       │
                                       ▼
                                 FastAPI BackgroundTask + asyncio.Semaphore(1):
                                   1. yt-dlp downloads the video into api_jobs/<job_id>/workspace/
                                   2. ffmpeg: scene detection + audio extraction
                                   3. OpenAI Whisper: audio → timestamped transcript
                                                       (Gemini Flash fallback if OpenAI fails)
                                   4. Claude Sonnet 4: extract discrete install steps
                                   5. GPT-4o Vision: for each step, pick the best screenshot frame
                                   6. python-docx: render installation_guide.docx
                                   7. Copy → DELIVERABLE_OUTPUT_DIR/<videoId>.docx
                                   8. Cleanup: delete api_jobs/<job_id>/ workspace
                                       │
                                       ▼
GET  /api/v1/jobs/<id>   ◄────── reports queued / running / completed / failed
                                  When completed: includes output_filename and
                                  step_count + quality_report.
```

**Concurrency:** 1 job at a time (`asyncio.Semaphore` + `API_MAX_CONCURRENT_JOBS=1`). The Node backend is also strictly serial, so concurrent submissions naturally queue.

**Typical run time:** 15–25 minutes for a 5-minute install video. Heavy I/O during download/transcription, heavy CPU during ffmpeg frame extraction, heavy network during the AI calls.

**Cost:** ~$0.50–$2 per video in OpenAI + Anthropic API spend (Gemini is fallback / usually free-tier).

## API surface

All endpoints require `Authorization: Bearer <API_KEY>` if the `API_KEY` env var is set (it is in production). Two endpoint families:

### Simplified contract (the original "Sunil contract" — Node could use these but currently uses v1 below)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/jobs` | `{ url }` | `{ job_id }` (immediate) |
| GET | `/jobs/<id>` | — | `{ status, output_filename?, error? }` |

`status` values: `queued`, `started`, `completed`, `failed`.

### Extended v1 (what the Node backend actually uses)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/v1/jobs` | `{ youtube_url, title?, prompt_tweaks?, skip_dedup? }` | full `JobRecord` |
| GET | `/api/v1/jobs/<id>` | — | full `JobRecord` |
| GET | `/api/v1/jobs` | (query: `limit`) | `[JobRecord, ...]` newest-first |
| GET | `/api/v1/jobs/<id>/document` | — | the `.docx` as a file stream |

`JobRecord` includes: `job_id`, `status` (queued/running/completed/failed), `output_filename`, `deliverable_path`, `step_count`, `quality_report`, `error`, `created_at`, `updated_at`, plus optional `title` + `prompt_tweaks`.

The Node backend chose `/api/v1/jobs` because the richer status response will let us surface step count + quality data in the dashboard later without a contract change.

### Health + ops

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ ok: true, active_job, max_concurrent_jobs, jobs_dir, api_jobs_size_mb, ... }` |

## Output file location

The finished `.docx` lands at:

```
$DELIVERABLE_OUTPUT_DIR/<videoId>.docx
```

On the droplet that's `/var/data/videototext/output/<videoId>.docx`. The Node backend's `OUTPUT_DIR` env var points at the same path so they share the directory. The Node backend serves the file from there via `GET /api/jobs/:id/download`.

`<videoId>` is the 11-character ID extracted from the YouTube URL. Set via `DELIVERABLE_FILENAME_STYLE=video_id`. (The alternative `slug` style is title-based but we picked videoId for guaranteed uniqueness.)

## File layout

```
python_script/
├── README.md                       ← you are here
├── DEPLOY.md                       ← server provisioning notes (Omons's)
├── api_server.py                   ← FastAPI HTTP service (~660 LOC)
├── youtube_to_word_pipeline.py     ← the actual pipeline (~6,470 LOC, single file)
├── requirements.txt                ← all pip deps (fastapi, uvicorn, anthropic, openai, google-genai, python-docx, yt-dlp, pillow, numpy, ...)
├── requirements-api.txt            ← legacy alias (just -r requirements.txt now)
├── .env.example                    ← all env vars with defaults + comments
├── .env                            ← real secrets — NEVER commit (gitignored)
├── .venv/                          ← Python virtualenv (gitignored)
├── start.sh                        ← pm2 entry: activate venv + uvicorn
├── api_jobs/                       ← per-job workspaces, auto-cleaned (gitignored)
│   └── _archive/                   ← terminal-state job.json files, pruned after 7 days
├── progression.md                  ← Omons's running notes on pipeline tuning
└── assets/                         ← logo files used in the .docx header
```

## Environment variables

Three required AI keys + one shared bearer + a path. The rest are tuning knobs with sensible defaults in `.env.example`.

| Key | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Whisper (transcription) + GPT-4o (vision). The biggest spend per video. Set a budget cap in OpenAI dashboard. |
| `CLAUDE_API_KEY` | ✅ | Claude Sonnet 4 for step extraction. |
| `GEMINI_API_KEY` | ✅ | Fallback for OpenAI calls; usually free-tier. |
| `API_KEY` | recommended | Bearer token. Must match the Node backend's `PYTHON_SERVICE_API_KEY`. Empty = unauthenticated. |
| `DELIVERABLE_OUTPUT_DIR` | ✅ in prod | Where the finished `.docx` lives. Production: `/var/data/videototext/output`. |
| `DELIVERABLE_FILENAME_STYLE` | optional | `video_id` (default in prod) or `slug`. |
| `API_JOBS_DIR` | optional | Where per-job workspaces live during processing. Default: `api_jobs`. |
| `API_MAX_CONCURRENT_JOBS` | optional | `1` in prod. Don't raise without bumping the droplet's RAM. |
| `API_DELETE_JOB_DIR_ON_SUCCESS` | optional | `true` in prod — deletes workspace + intermediates after each success. |
| `API_PRUNE_OLD_JOBS_DAYS` | optional | `7` in prod — older archived `job.json` metadata is pruned at startup. |

Plus many model/quality knobs (`CLAUDE_MODEL`, `OPENAI_VISION_MODEL`, scene-detection thresholds, frame-quality thresholds, etc.). See `.env.example` for the full list with defaults — most don't need to change.

## Local dev

```bash
cd python_script
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# System tools required:
#   ffmpeg, ffprobe   (sudo apt install ffmpeg  /  brew install ffmpeg)
#   yt-dlp            (pip installs as a Python dep)

cp .env.example .env
# fill in OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY (3 keys, one line each)

uvicorn api_server:app --host 127.0.0.1 --port 4000 --reload
# → http://127.0.0.1:4000/health
```

Test directly without going through the Node backend:

```bash
# submit a job
curl -X POST http://127.0.0.1:4000/api/v1/jobs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"youtube_url": "https://www.youtube.com/watch?v=Ty8gcCKuwNI"}'
# → { "job_id": "...", "status": "queued", ... }

# poll status
curl -H "Authorization: Bearer $API_KEY" \
  http://127.0.0.1:4000/api/v1/jobs/<job_id>
# eventually: { "status": "completed", "output_filename": "Ty8gcCKuwNI.docx", ... }
```

## Production deployment

Lives on the **Video2Text dedicated droplet** (`159.203.184.236`, NYC1, 2 vCPU / 4 GB / 120 GB). Same droplet as the Node backend + Next.js frontend.

### One-time setup (done 2026-05-22)

```bash
apt update
apt install -y ffmpeg python3.12-venv

cd /var/www/Video2Text/python_script
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cp .env.example .env
# fill in the 3 AI keys + DELIVERABLE_OUTPUT_DIR=/var/data/videototext/output

mkdir -p /var/data/videototext/output

chmod +x start.sh
pm2 start ./start.sh --name v2t-python-pipeline
pm2 save
```

### `start.sh`

```bash
#!/bin/bash
# pm2-friendly entry for the Python pipeline API.
# Activates venv + runs uvicorn bound to localhost on port 4000.
# Node backend (port 8000) calls this over http://127.0.0.1:4000/.
set -e
cd "$(dirname "$(readlink -f "$0")")"
source .venv/bin/activate
exec uvicorn api_server:app --host 127.0.0.1 --port 4000
```

### Redeploy after `git pull`

```bash
cd /var/www/Video2Text/python_script
source .venv/bin/activate
pip install -r requirements.txt    # only if requirements.txt changed
deactivate
pm2 restart v2t-python-pipeline
```

## Workspace cleanup

Each job creates `api_jobs/<job_id>/` containing the downloaded video (often hundreds of MB), intermediate JSON (transcript, scenes, steps, quality report), and a `workspace/` subfolder with extracted frames. Per the `.env` defaults:

- **On success:** the whole `api_jobs/<job_id>/` folder is deleted. Only `api_jobs/_archive/<job_id>.json` (a few KB of job metadata, used for polling after cleanup) is kept.
- **On failure:** the workspace is kept for debugging (set `API_DELETE_JOB_DIR_ON_FAILURE=true` to change this).
- **On startup:** archived `job.json` files older than `API_PRUNE_OLD_JOBS_DAYS` (7 by default) are deleted.

Disk on the droplet has plenty of room (~111 GB free), but stale `api_jobs/` from failed jobs accumulate — worth a `ls -lah api_jobs/` check every few weeks.

## Error handling

The pipeline classifies known failure modes and returns short English error messages (not stack traces) via `error` in the status response:

| Failure | Returned `error` |
|---|---|
| YouTube download failed | "Could not download video. Check the YouTube URL and network connection." |
| Video has no captions / no speech | "No usable speech found in the video audio." |
| Claude returned no install steps | "Could not extract installation steps from the video." |
| Saving the docx failed | "Document was built but could not be saved to the output folder." |
| Bad/expired AI key | "AI service authentication failed. Check server API keys." |
| OpenAI/Anthropic rate-limited | "AI service rate limit reached. Try again in a few minutes." |
| Internal timeout | "Processing timed out. Try again or use a shorter video." |
| python-docx render failed | "Document generation failed." |

These propagate cleanly to the Node backend's `jobs.error` column and end up shown to the user in the dashboard.

## Default branch

`main` (renamed from `master` on 2026-05-22 to match the convention used by the other repos). Push feature branches and open PRs to `main`.
