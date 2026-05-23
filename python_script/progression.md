# Turn Offroad — YouTube → Word pipeline (production)

Production-ready service: **`youtube_to_word_pipeline.py`** (brain) + **`api_server.py`** (HTTP API).

---

## Architecture

```text
Sunil app (Vercel/Node + SQL)
    │  POST /api/v1/jobs  +  poll GET /api/v1/jobs/{id}
    ▼
api_server.py  (DigitalOcean Droplet)
    │  background task → run_full_pipeline()
    ▼
output/*.docx          ← DELIVERABLE_OUTPUT_DIR (keep forever)
api_jobs/<id>/         ← scratch per run (deleted after success)
api_jobs/_archive/     ← tiny job.json copies for polling after cleanup
```

Sunil stores **`output_filename`** + **`youtube_url`** in SQL. He does not need DB access to your server.

---

## Repo layout

| File / folder | Purpose |
|---------------|---------|
| `youtube_to_word_pipeline.py` | Full pipeline (do not fork logic) |
| `api_server.py` | FastAPI wrapper, job queue, cleanup |
| `requirements.txt` | **Single** pip install (pipeline + API) |
| `.env.example` | Template — copy to `.env` |
| `.gitignore` | Ignores `.env`, `api_jobs/*`, `output/*.docx` |
| `assets/` | Logo (`LOGO_PATH`) |
| `output/` | Published `.docx` for dashboard |
| `DEPLOY.md` | DigitalOcean steps |

---

## System requirements (not pip)

| Tool | Install |
|------|---------|
| **ffmpeg + ffprobe** | Windows: `winget install Gyan.FFmpeg` · Linux: `apt install ffmpeg` |
| **yt-dlp** | `pip install yt-dlp` (must be on PATH) |
| **Python 3.11+** | |

```powershell
pip install -r requirements.txt
cp .env.example .env   # fill keys
uvicorn api_server:app --host 0.0.0.0 --port 8000
```

---

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness + disk cleanup settings |
| `POST` | `/api/v1/jobs` | Queue job (`youtube_url`, `prompt_tweaks`, `skip_dedup`) |
| `GET` | `/api/v1/jobs/{job_id}` | Poll status (works from `_archive` after cleanup) |
| `GET` | `/api/v1/jobs` | List recent jobs |
| `GET` | `/api/v1/jobs/{job_id}/document` | Download `.docx` |

### Example job body

```json
{
  "youtube_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "title": null,
  "prompt_tweaks": {
    "step_instructions": "Combine steps where the camera angle stays the same.",
    "tools_instructions": "",
    "important_note": ""
  },
  "skip_dedup": true
}
```

**`skip_dedup: true`** — recommended for interior install videos with similar camera angles (avoids bad dedup-rescue screenshots).

---

## Disk cleanup (production defaults)

After each **successful** job:

1. Copy `.docx` → `output/{title_slug}_{videoId}.docx`
2. Archive `job.json` → `api_jobs/_archive/{job_id}.json`
3. Release `pipeline.log` file lock
4. **Delete entire** `api_jobs/{job_id}/` (video, frames, logs)

Env:

```env
API_DELETE_JOB_DIR_ON_SUCCESS=true
API_DELETE_JOB_DIR_ON_FAILURE=false
API_PRUNE_OLD_JOBS_DAYS=7
DELIVERABLE_OUTPUT_DIR=output
```

Poll `GET /jobs/{id}` until `completed` → read **`output_filename`** → store in SQL.

---

## Pipeline steps

| # | Step | AI? |
|---|------|-----|
| 1 | Download video | No (`yt-dlp`) |
| 2 | Scene detection | No (`ffmpeg`) |
| 3 | Transcribe | **OpenAI Whisper** |
| 4 | Extract steps | **Claude** |
| 5 | Screenshot per step | **OpenAI Vision** |
| 6 | Dedup / refine (optional) | Local + vision |
| 7 | Tools / hardware / time | **Claude** |
| 8 | Build Word doc | No (`python-docx`) |

Required keys: `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY` (validated at startup).

---

## Test results (May 2026)

| Video | Result | Notes |
|-------|--------|-------|
| Cage Brace / MOLLE (`IRHaQECR-qg`) | 13 steps, dedup on | Step 11 weak (0.45) — dedup-rescue issue |
| Dash Rail (`4SNa82J79SU`) | 12 steps, **0.929 avg conf** | `skip_dedup: true` + prompt tweak — client-ready |

Good output: `output/Dash_Rail_for_2021-2026_Ford_Bronco_Installation_Guide_Turn_Offroad_4SNa82J79SU.docx`

---

## CLI (local dev)

```powershell
python youtube_to_word_pipeline.py "https://youtube.com/watch?v=ID" my_output --verbose
python youtube_to_word_pipeline.py "URL" my_output --doc-only
```

---

## Handoff to Sunil (`python_pipeline/` folder)

Copy into his repo:

- `youtube_to_word_pipeline.py`, `api_server.py`, `requirements.txt`
- `.env.example`, `DEPLOY.md`, `assets/`, `output/.gitkeep`

His app: POST job → poll → save `output_filename` → link file from `output/`.

---

## Suggested next steps

- [ ] Deploy Droplet + nginx + `API_KEY`
- [ ] Test one job end-to-end; confirm `api_jobs/<id>/` gone after success
- [ ] Sunil connects dashboard to `output/` + SQL
- [ ] (Later) Webhooks instead of polling

*Updated May 2026 — production API, cleanup, DigitalOcean-ready.*
