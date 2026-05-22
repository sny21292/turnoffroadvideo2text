# python_script/

Placeholder folder for the new Python pipeline that converts a YouTube URL into a `.docx` install guide. The Python developer working under Sunil owns the code that lands here.

## Integration contract (May 2026, from the Python dev)

The new pipeline runs as an **HTTP service**, not as an inline script spawned from the Node backend. Our backend talks to it over HTTP.

### Backend → Python service

| Step | Method | What we call | What it returns |
|---|---|---|---|
| 1 | POST | `<python-service>/jobs` (or whatever the dev settles on as the "create job" endpoint) | `{ job_id }` |
| 2 | GET (polled) | `<python-service>/jobs/<job_id>` | `{ status, output_filename }` once `status == "completed"` |

The job_id from step 1 is stored in our SQLite `jobs.python_job_id` column (to be added) alongside the user-facing UUID + YouTube URL.

### Output

- The Python service writes `{videoId}.docx` (NOT the video title — settled on videoId for guaranteed uniqueness and clean URLs) into a shared output folder we configure.
- Our backend reads that filename from `output_filename` and serves the file via `GET /jobs/:id/download`.

### DB access

The Python service does **not** need DB access. Our backend owns all SQL — `jobs.id` (UUID), `url`, `status`, `output_filename`, owning user, timestamps.

### Transient files / cleanup

The Python service creates per-job working folders named `api_jobs_*` to hold the downloaded video, intermediate `steps.json`, and logs. The dev is implementing cleanup but says it's flaky. Don't rely on those folders being empty — disk pressure on this droplet is fine (~111 GB free), but if it ever grows, we may need our own sweep cron.

### Concurrency

The Python dev recommends **1–2 concurrent jobs (max 2–3)**. Our `backend/src/queue.js` should respect that — strictly serial for now, or cap at 2 in-flight. The frontend already serializes per-user so this is mainly a guard against multi-user bursts.

## What goes in this folder

- The Python service code itself if it's deployed alongside our app on the same droplet (most likely option, since the output `.docx` files need to land in a folder our backend can read).
- A `docker-compose.yml` or systemd unit if it runs as a separate service on the same box.
- Setup notes / env vars for the dev to point us to once their service is locked in.

This folder is intentionally empty at commit time — the Python dev will fill it in.
