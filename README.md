# Video2Text

Paste a YouTube install video URL → get a polished Word document install guide with steps and screenshots. Per-user account, personal download history, JWT auth.

Built for **Turn Offroad LLC** — replaces the manual "watch a 5-minute install video, screenshot the important frames, write up the steps in Word" process with a one-click pipeline.

## Stack at a glance

| Layer | Tech | Port | PM2 name | Purpose |
|---|---|---|---|---|
| **Frontend** | Next.js 16 (App Router) + Tailwind v4 + TypeScript | `3000` | `v2t-frontend` | Login + paste-a-URL + history dashboard |
| **Backend** | Node.js 20 + Express + JWT + better-sqlite3 | `8000` | `v2t-api` | Auth, queue, job tracking, download streaming |
| **Pipeline** | Python 3.12 + FastAPI + yt-dlp + ffmpeg + OpenAI + Anthropic + Gemini | `4000` | `v2t-python-pipeline` | YouTube URL → `.docx` |
| Reverse proxy | nginx | 80/443 | n/a | Routes `/api/*` → backend, `/` → frontend |

All three services run on **one dedicated Digital Ocean droplet** (`159.203.184.236`, NYC1, 2 vCPU / 4 GB / 120 GB). The Python service binds to `127.0.0.1:4000` — only the Node backend (also on the droplet) talks to it.

Live at **https://video2text.turnoffroad.com** (Let's Encrypt cert, auto-renewing).

## Repo layout

```
turnoffroadvideo2text/
├── README.md                            ← you are here
├── .gitignore
├── backend/                             ← Node.js Express API
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── server.js                    ← Express entry point
│       ├── auth.js                      ← /auth/login + /auth/me + JWT middleware
│       ├── jobs.js                      ← /jobs CRUD + /jobs/:id/download
│       ├── queue.js                     ← in-process worker, HTTP-calls Python service
│       └── db.js                        ← SQLite init + idempotent migrations
├── frontend/                            ← Next.js 16 dashboard
│   ├── package.json
│   ├── next.config.ts
│   ├── .env.production                  ← NEXT_PUBLIC_BACKEND_URL=/api
│   └── app/
│       ├── page.tsx                     ← home: paste-a-URL generator
│       ├── login/page.tsx               ← login form
│       ├── history/page.tsx             ← per-user job list + download
│       ├── layout.tsx
│       ├── globals.css
│       ├── components/                  ← TopNav, UrlGenerator, AuthShell, etc.
│       └── lib/                         ← api.ts, auth-context.tsx, branding.ts
└── python_script/                       ← Python pipeline + HTTP API
    ├── README.md                        ← details for the pipeline service
    ├── DEPLOY.md
    ├── api_server.py                    ← FastAPI: POST/GET /api/v1/jobs
    ├── youtube_to_word_pipeline.py      ← the actual pipeline (~6.5k LOC)
    ├── requirements.txt                 ← pip install
    ├── .env.example                     ← AI keys, model selection, tuning knobs
    ├── start.sh                         ← pm2 entry script
    └── assets/                          ← logo / template assets used in the .docx
```

**No `/register` page.** Users are created manually via a Node one-liner (see "Creating users" below). Login is the only public entry.

## How a job flows through the system

```
[User on /]
  Paste YouTube URL → click Generate
        │
        ▼
[Next.js frontend]
  POST /api/jobs  { url }   (with Authorization: Bearer <jwt>)
        │
        ▼
[Express backend, port 8000]
  authMiddleware decodes JWT → req.user
  Validates URL against YouTube regex
  INSERT INTO jobs (id=UUID, user_id, url, status='queued')
  202 { job_id }  ← returned to frontend immediately
        │
        ▼
[Backend queue.js — STRICTLY SERIAL]
  Picks up the job
  UPDATE jobs SET status='started'
  POST http://127.0.0.1:4000/api/v1/jobs  { youtube_url }
        │
        ▼
[Python FastAPI, port 4000]
  asyncio.Semaphore(1) — also strictly serial on its side
  Returns { job_id: <python's uuid> }  immediately
  Background task starts the pipeline:
    1. yt-dlp downloads the video
    2. ffmpeg scene detection (in parallel with audio transcription)
    3. OpenAI Whisper transcribes audio (Gemini fallback)
    4. Claude Sonnet 4 extracts discrete install steps
    5. GPT-4o Vision picks the best screenshot frame per step
    6. python-docx renders the final .docx
    7. Copies finished doc → /var/data/videototext/output/<videoId>.docx
        │
        ▼
[Backend keeps polling every 3s]
  GET http://127.0.0.1:4000/api/v1/jobs/<python_job_id>
  Sees status flip: queued → running → completed
  UPDATE jobs SET status='finished',
                   output_filename='<videoId>.docx',
                   finished_at=NOW()
        │
        ▼
[Frontend /history polls every 1.5s]
  Sees status='finished' → shows Download button
        │
        ▼
[User clicks Download]
  GET /api/jobs/<id>/download   (auth + ownership check)
  Backend streams /var/data/videototext/output/<videoId>.docx as octet-stream
```

**Timing:** ~15–25 minutes for a typical 5-minute install video. Cost: **~$0.50–$2 per video** in OpenAI + Anthropic + Gemini API calls. Concurrency is 1 on both sides (Cole's team submits one video at a time and waits).

## API surface

### Public-facing (frontend → backend, behind JWT)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user }` (7-day JWT) |
| GET | `/api/auth/me` | — | `{ user }` |
| POST | `/api/jobs` | `{ url }` | `202 { job_id, status: 'queued', … }` |
| GET | `/api/jobs` | — | `{ jobs: [...] }` — caller's jobs only |
| GET | `/api/jobs/:id` | — | `{ job }` |
| GET | `/api/jobs/:id/download` | — | `application/vnd...wordprocessingml.document` stream |
| DELETE | `/api/jobs/:id` | — | `{ ok: true }` (removes row + file) |
| GET | `/api/health` | — | `{ ok: true }` |

### Internal (backend → Python service, behind shared bearer)

See `python_script/README.md`. Backend uses `/api/v1/jobs` because the response includes richer fields (`output_filename`, `step_count`, `quality_report`) than the simpler `/jobs` contract endpoint.

## Database schema

SQLite, file at `backend/data/app.db` (WAL mode). Schema migrations are idempotent and run at backend startup — safe to re-run on every boot.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id              TEXT    PRIMARY KEY,            -- UUID (Node-side)
  user_id         INTEGER NOT NULL,
  url             TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'queued',
                                                  -- queued | started | finished | failed
  error           TEXT,
  output_path     TEXT,                           -- legacy (pre-pipeline jobs); .pdf
  output_filename TEXT,                           -- new: basename in /var/data/.../output
  python_job_id   TEXT,                           -- UUID returned by python service
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_user ON jobs(user_id, created_at DESC);
```

Given any `.docx` file, you can find the owner with one join:

```sql
SELECT u.email, j.url, j.created_at
FROM jobs j
JOIN users u ON u.id = j.user_id
WHERE j.output_filename = 'abc123.docx';
```

## Local development

### Prerequisites

| Tool | Min | Used for |
|---|---|---|
| Node.js | 20.x | Backend + frontend |
| npm | 10.x | Package install |
| Python | 3.10+ | Running `python_script/` |
| ffmpeg, yt-dlp | latest | Used by the pipeline |

On macOS: `brew install node@20 python@3.12 ffmpeg yt-dlp`

### Clone + install

```bash
git clone git@github.com:sny21292/turnoffroadvideo2text.git
cd turnoffroadvideo2text

# 1. Backend
cd backend
npm install
cp .env.example .env       # fill JWT_SECRET; PYTHON_SERVICE_* default to localhost
npm run dev                # auto-restarts on changes (http://localhost:8000)

# 2. Frontend  (new terminal)
cd ../frontend
npm install
npm run dev                # http://localhost:3000

# 3. Python pipeline  (new terminal — only if you want to test end-to-end locally)
cd ../python_script
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY
uvicorn api_server:app --host 127.0.0.1 --port 4000
```

If you skip step 3, jobs you submit will be stuck in `started` forever — the backend will keep polling the (missing) Python service. That's fine for testing the UI/auth flow only.

### Creating users (no signup page by design)

From the `backend/` directory:

```bash
node -e "
const bcrypt = require('bcryptjs');
const db = require('./src/db');
(async () => {
  const name = 'Some User';
  const email = 'someone@example.com';
  const password = 'theirpassword';
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email.toLowerCase().trim(), hash);
  console.log('Created:', email);
})();
"
```

## Environment variables

### `backend/.env`

| Key | Default | Notes |
|---|---|---|
| `PORT` | `8000` | Backend listen port |
| `JWT_SECRET` | **required** | `openssl rand -hex 48` |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS allow-list |
| `OUTPUT_DIR` | `./output` | Where finished `.docx` files live (production: `/var/data/videototext/output`) |
| `PYTHON_SERVICE_URL` | `http://127.0.0.1:4000` | Python FastAPI base URL |
| `PYTHON_SERVICE_API_KEY` | — | Bearer token, must match the Python service's `API_KEY` |
| `PYTHON_POLL_INTERVAL_MS` | `3000` | How often to poll Python for job status |
| `PYTHON_JOB_TIMEOUT_MS` | `3600000` | Hard timeout per job (60 min) |

### `frontend/.env.production` (build-time only)

| Key | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8000` | In production behind nginx, set to `/api`. **Baked into the build** — must `npm run build` and `pm2 restart v2t-frontend` after every change. |

### `python_script/.env`

See `python_script/.env.example`. The three required API keys: `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`. Plus `API_KEY` (the bearer that must match the backend's `PYTHON_SERVICE_API_KEY`).

## Production deployment

### Server

- Droplet: `159.203.184.236` (NYC1, 2 vCPU / 4 GB / 120 GB Ubuntu)
- SSH: `root` user, **password auth** — credentials in the project-private notes (not in this repo)
- Code path: `/var/www/Video2Text/` (note the on-disk folder name differs from the repo name)
- Finished `.docx` files: `/var/data/videototext/output/<videoId>.docx`
- SQLite DB: `/var/www/Video2Text/backend/data/app.db`
- nginx: `/etc/nginx/sites-enabled/video2text.turnoffroad.com` (and an in-parallel `turnoffroadvideototext.duckdns.org` config from the migration window — to be retired)

### nginx (path-based split)

```nginx
server {
  listen 443 ssl;
  server_name video2text.turnoffroad.com;
  client_max_body_size 100M;

  location /api/ {
    proxy_pass http://127.0.0.1:8000/;   # trailing slash strips /api
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  # Let's Encrypt managed
  ssl_certificate     /etc/letsencrypt/live/video2text.turnoffroad.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/video2text.turnoffroad.com/privkey.pem;
}
```

The Python service is **never** exposed through nginx — it binds only to `127.0.0.1:4000` and only the backend can talk to it.

### Redeploy after a git push

```bash
ssh root@159.203.184.236
cd /var/www/Video2Text
git pull origin main

# backend changes?
cd backend && npm ci && pm2 restart v2t-api

# frontend changes?
cd ../frontend && npm ci && npm run build && pm2 restart v2t-frontend

# python pipeline changes?
cd ../python_script
source .venv/bin/activate
pip install -r requirements.txt    # only if requirements.txt changed
deactivate
pm2 restart v2t-python-pipeline
```

### SQLite backup (daily cron)

```bash
# /etc/cron.daily/v2t-backup
#!/bin/sh
sqlite3 /var/www/Video2Text/backend/data/app.db \
  ".backup '/var/backups/v2t-$(date +%F).db'"
find /var/backups -name 'v2t-*.db' -mtime +14 -delete
```

Also back up `/var/data/videototext/output/*.docx` if losing generated guides would matter.

## Cost & rate-limit guardrails

The Python pipeline calls **three paid AI providers**:
- **OpenAI** — Whisper (audio→text) + GPT-4o (vision); the biggest spend per video
- **Anthropic Claude Sonnet 4** — step extraction
- **Google Gemini** — fallback only; usually free-tier

Set spending caps in each provider's dashboard. Recommended starting points: $50/mo on OpenAI, $50/mo on Anthropic, default free tier on Gemini.

The pipeline is **strictly serial** (semaphore=1) on both sides — Cole's team can only have one video processing at a time, so cost bursts are bounded by hand-submission rate.

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows `ERR_CONNECTION_REFUSED` on API calls | `NEXT_PUBLIC_BACKEND_URL` baked into the build is wrong | Set to `/api`, `npm run build`, `pm2 restart v2t-frontend` |
| API call returns Next.js 404 HTML | nginx is sending `/api/*` to Next.js, not the backend | Restore the `location /api/` block, `nginx -t && systemctl reload nginx` |
| `pm2 ls` shows `v2t-api` with high restart count | Backend crashing on boot | `pm2 logs v2t-api` — usually missing `.env`, port in use, or `better-sqlite3` build failed (`npm rebuild better-sqlite3`) |
| Job stuck on `started` forever | Python service not running, or backend can't reach it | `pm2 logs v2t-python-pipeline`, check `curl http://127.0.0.1:4000/health` from the droplet |
| Job fails with "Could not download video" | YouTube blocked the request, or video is private/regional | Try another URL; check yt-dlp logs in the pipeline output |
| Job fails with "AI service authentication failed" | One of the 3 API keys is wrong/expired/over-quota | Check the provider dashboard; update `python_script/.env`; `pm2 restart v2t-python-pipeline` |
| PDF row says `finished` but download 404s | Output file deleted from disk | The 410 response indicates this — restore from backup or delete the row |

## Repository layout vs droplet folder name

The on-disk folder on the droplet is **`/var/www/Video2Text/`** (capital V, capital T, no separator). The GitHub repo is `sny21292/turnoffroadvideo2text` (lowercase, one word). The local Mac folder matches the repo name. Don't be alarmed by the inconsistency — it's intentional.

## Default branch

`main` (renamed from `master` on 2026-05-22 to match the convention used by the other Shopify integration repos).
