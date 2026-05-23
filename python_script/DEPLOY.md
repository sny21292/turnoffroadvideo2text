# Deploy on DigitalOcean (pipeline API)

## What stays on disk

| Path | Size | Retention |
|------|------|-----------|
| `output/` (`DELIVERABLE_OUTPUT_DIR`) | ~5–20 MB per guide | **Keep** — dashboard + SQL filename |
| `api_jobs/<job_id>/` | 100 MB – 2 GB | **Deleted** after successful run |
| `api_jobs/_archive/<job_id>.json` | ~2 KB | Kept until pruned (default 7 days) |

## Droplet setup (Ubuntu)

```bash
sudo apt update
sudo apt install -y ffmpeg python3.11 python3.11-venv
pip install yt-dlp  # or: sudo apt install yt-dlp

cd /app/python_pipeline
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: API keys, API_KEY, DELIVERABLE_OUTPUT_DIR=/app/python_pipeline/output
mkdir -p output api_jobs assets
```

# Production on droplet:
# DELIVERABLE_OUTPUT_DIR=/var/data/videototext/output
# uvicorn api_server:app --host 127.0.0.1 --port 4000

Put nginx in front with HTTPS. Sunil's backend calls:

- `POST /api/v1/jobs` with `Authorization: Bearer <API_KEY>`
- Poll `GET /api/v1/jobs/{job_id}` until `status` is `completed`
- Store `output_filename` in SQL (same as response field)
- Serve files from `output/` or `GET /api/v1/jobs/{job_id}/document`

## Cleanup env (production defaults)

```env
API_DELETE_JOB_DIR_ON_SUCCESS=true
API_DELETE_JOB_DIR_ON_FAILURE=false
API_PRUNE_OLD_JOBS_DAYS=7
DELIVERABLE_OUTPUT_DIR=output
```

After each successful job the server deletes `api_jobs/<job_id>/` (video + logs). Job metadata is kept in `api_jobs/_archive/` for polling. Finished guides stay in `output/`.

## Health check

`GET /health` returns `api_jobs_size_mb`, `delete_job_dir_on_success`, and `active_job`.
