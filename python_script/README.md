# python_script/

This folder is owned by the Python developer working with Sunil. The Node.js backend (`backend/`) will call this Python service over HTTP for every transcription job.

---

## What you're building

An HTTP service (any framework — Flask / FastAPI / whatever) that exposes 2 endpoints and writes finished `.docx` files into a shared folder on the same droplet. The Node backend handles all SQL, all auth, all download streaming — your service only handles "URL in → .docx out".

## The contract — final, agreed with Sunil

### 1. `POST /jobs` — accept a new transcription job

**Request body** (JSON):
```json
{ "url": "https://www.youtube.com/watch?v=abc123" }
```

**Response** (200 or 202, JSON, **return immediately** — don't wait for the pipeline to finish):
```json
{ "job_id": "string-you-generate" }
```

`job_id` can be anything unique on your side (UUID is fine). The Node backend will save this against its own internal `jobs.python_job_id` column. We'll never re-use a job_id.

The Node backend will only ever send 1 URL at a time, so don't worry about concurrent submissions from us — but your own queue can be 1–3 wide as you mentioned.

### 2. `GET /jobs/<job_id>` — return job status

The Node backend polls this every ~3 seconds until status flips to `completed` or `failed`. Return JSON:

```jsonc
// while running
{ "status": "queued" }
// OR
{ "status": "started" }   // working on it

// once done
{
  "status": "completed",
  "output_filename": "abc123.docx"   // just the filename, NOT the full path
}

// on error
{
  "status": "failed",
  "error": "human-readable description of what went wrong"
}
```

**`output_filename` must be `<videoId>.docx`** — extract the video ID from the YouTube URL (the 11-character string after `v=` or in the short link). Confirmed with Sunil — videoId-based names, not title-based, because they're guaranteed unique and URL-safe.

### 3. Output file location

Write the finished `.docx` to:

```
/var/data/videototext/output/<videoId>.docx
```

That folder already exists on the droplet (`159.203.184.236`) and is writable. The Node backend reads from the same path to serve downloads. The Node backend's `OUTPUT_DIR` env var also points here, so they're sharing the directory.

---

## What you do NOT need to worry about

- **Auth / users / login** — Sunil's backend handles all of that. Your endpoints can be wide-open inside the droplet (we'll just bind them to `127.0.0.1` so only the Node backend can reach them, or use a shared bearer token — TBD).
- **The frontend** — entirely Sunil's. You'll never serve HTML.
- **Database** — Sunil's backend owns SQLite. Your service doesn't need DB access. Your service is stateless from our perspective (only the job_id → status map is yours, however you want to persist it — in-memory dict, SQLite, Redis, etc.).
- **Download streaming** — Sunil's backend reads the file off disk and streams it to the user. Your service just writes the file and moves on.
- **Retries** — if a job fails, return `status: failed` with an `error` message. Sunil's backend marks the job as failed in SQLite. We don't auto-retry. Cole can manually re-submit if needed.

---

## Operational notes

- **Concurrency:** you mentioned 1–2 (max 2–3) parallel jobs is the safe range. Sunil's queue is strictly serial on his side, so you'll never see more than 1 active job from us at a time. Cap your own internal concurrency at whatever's stable for you.
- **Working folders:** you mentioned `api_jobs_*` folders for intermediate downloads/logs that you try to clean up. That's fine — they live wherever in your project tree, just not in `/var/data/videototext/output/` (which is for the final `.docx` only). Disk is plentiful (~111 GB free), so leftover folders won't kill us if cleanup misses, but please try to clean them up after each job.
- **Deploy target:** same droplet as the Node backend → `159.203.184.236` (Ubuntu 24.04, 2 vCPU / 4 GB RAM / 120 GB disk). Run under PM2 (or a systemd unit — your call). Pick a port that doesn't collide with 3000 (frontend) or 8000 (backend). 4000 or 5000 would be natural choices.
- **What we want in `.env.example`:** any env vars your service needs (API keys, model paths, etc.) listed with placeholder values. The actual `.env` lives only on the droplet, never in git.

---

## How to work in this repo

- The repo is `git@github.com:sny21292/turnoffroadvideo2text.git`, default branch **`main`**.
- **Push your work to a new branch** (e.g. `python-pipeline` or `feature/python-service`), **not directly to `main`**. Sunil will review and merge via a PR once your service is ready and the Node backend has been updated to call it.
- Put your service code in this `python_script/` folder. Suggested layout (do whatever fits your tooling):
  ```
  python_script/
  ├── README.md               ← (this file — keep it updated with anything we should know)
  ├── app.py                  ← Flask / FastAPI entry, defines POST /jobs and GET /jobs/<id>
  ├── requirements.txt        ← pip install -r requirements.txt
  ├── pipeline/               ← the actual transcription pipeline (video → docx)
  │   └── ...
  └── .env.example            ← any env vars needed
  ```
- If you need a different shape, totally fine — just keep the two endpoints' shape and the output location/filename rule the same.

## Open questions for you to confirm before merge

1. **Internal queue type** — in-memory dict vs Redis/Celery vs subprocess pool. We don't strictly care, but it affects whether a restart loses in-flight jobs. Please tell us.
2. **Pipeline duration** — rough estimate for a typical 5-minute YouTube install video, end-to-end? Helps Sunil tune the poll interval and pick a reasonable timeout on the Node side.
3. **Failure modes** — what kinds of errors should the `error` field include? "Video unavailable", "captions disabled", "rendering failed", etc. — we'll display these to Cole in the dashboard, so concise English is best.
4. **Memory ceiling per job** — should help us decide if we need to add swap or bump the droplet size.

---

## Sunil's contact

DM Sunil with questions as they come up. He's currently on the Node backend, ShipStation integration, and infrastructure side, so any clarification on the contract or environment is on him.
