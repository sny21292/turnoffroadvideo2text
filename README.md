# Video2Text

Paste a YouTube URL → get a PDF transcript of the video. Per-user account, personal download history, JWT auth.

- **Frontend:** Next.js 16 (App Router) + Tailwind v4
- **Backend:** Node.js (Express) + SQLite + JWT auth
- **Worker:** Python script (`backend/scripts/transcribe.py`) spawned per job
- **PDF generator:** uses YouTube auto-captions + `reportlab` — fully free, no API keys

---

## What's in this repo

```
turnoffroad/
├── README.md                  ← you are here
├── .gitignore
├── backend/
│   ├── .env.example           ← copy to .env, fill in
│   ├── package.json
│   └── src/
│       ├── server.js          ← Express entry point
│       ├── auth.js            ← /auth/login + /auth/me + JWT middleware
│       ├── jobs.js            ← /jobs routes
│       ├── queue.js           ← in-process worker, spawns Python
│       └── db.js              ← SQLite init + schema
│   └── scripts/               ← the Python worker
│       ├── transcribe.py      ← YouTube URL → PDF (free pipeline)
│       └── requirements.txt   ← pip install -r requirements.txt
└── frontend/
    ├── package.json
    └── app/
        ├── page.tsx           ← home: paste-a-URL generator
        ├── login/page.tsx     ← login form
        ├── history/page.tsx   ← per-user PDF history + download
        ├── layout.tsx
        ├── globals.css
        ├── components/        ← TopNav, UrlGenerator, AuthShell, etc.
        └── lib/               ← api.ts, auth-context.tsx, branding.ts
```

There is no `/register` page or `POST /auth/register` endpoint — users are created manually (see [Creating users](#creating-users) below). Login is the only entry point.

---

## Prerequisites

| Tool | Min version | Used for |
|---|---|---|
| Node.js | 20.x | Backend + frontend |
| npm | 10.x (ships with Node 20) | Package install |
| Python | 3.10+ | Running `transcribe.py` |
| pip | latest | Installing Python deps |
| Git | any | Cloning the repo |

On macOS:

```bash
brew install node@20 python@3.12 git
```

On Ubuntu 24.04 (Droplet):

```bash
apt update
apt install -y curl git build-essential python3 python3-pip nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2
```

> Why `build-essential`? The backend uses `better-sqlite3`, which compiles a native binding from source on install. Without a C++ toolchain, `npm install` fails.

---

## First-time setup (after cloning)

```bash
git clone git@github.com:sny21292/turnoffroadvideo2text.git
cd turnoffroadvideo2text
```

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Open `backend/.env` and set:

```env
PORT=8000
JWT_SECRET=<paste output of:  openssl rand -hex 48>
PYTHON_SCRIPT=<absolute path to backend/scripts/transcribe.py>
PYTHON_BIN=python3
OUTPUT_DIR=<absolute path where PDFs should be stored>
FRONTEND_ORIGIN=http://localhost:3000
```

Example for the Droplet:

```env
PYTHON_SCRIPT=/var/www/Video2Text/backend/scripts/transcribe.py
OUTPUT_DIR=/var/data/videototext/output
FRONTEND_ORIGIN=https://yourdomain.com
```

Then start the backend:

```bash
npm run dev          # auto-restarts on changes
# or
npm start            # plain run
# → http://localhost:8000
```

The SQLite DB and schema are created automatically on first run at `backend/data/app.db`.

### 2. Python script for PDF generation

```bash
cd backend/scripts
pip3 install -r requirements.txt
chmod 755 transcribe.py
```

Installs `youtube-transcript-api` and `reportlab`. No paid API keys needed.

Smoke test it directly:

```bash
mkdir -p /tmp/test
python3 transcribe.py "https://www.youtube.com/watch?v=Ty8gcCKuwNI" /tmp/test/out.pdf
echo "exit=$?"
ls -lh /tmp/test/out.pdf
```

If you see `exit=0` and a non-empty PDF, the worker is wired up correctly. **The script only works for videos that have captions enabled** (most public YouTube videos do — including auto-generated ones).

### 3. Frontend

```bash
cd ../../frontend       # → /turnoffroadvideo2text/frontend
npm install
```

In **dev** (same machine as the backend at port 8000), no env file is needed.

In **production** (behind nginx with the `/api/*` proxy), create `frontend/.env.production`:

```env
NEXT_PUBLIC_BACKEND_URL=/api
```

> `NEXT_PUBLIC_*` env vars are baked in **at build time**. If you change this file, you must `npm run build` again before the new value takes effect.

Run the frontend:

```bash
npm run dev              # → http://localhost:3000
# or for production:
npm run build && npm start
```

### 4. Create your first user

There's no signup page. Create one from the backend folder:

```bash
cd backend && node -e "
const bcrypt = require('bcryptjs');
const db = require('./src/db');
(async () => {
  const name = 'Admin';
  const email = 'you@example.com';
  const password = 'yourpassword';
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email.toLowerCase().trim(), hash);
  console.log('Created:', email);
})();
"
```

Then visit `http://localhost:3000/login` and log in with that email + password.

---

## Pages

| Route | What it does | Auth required? |
|---|---|---|
| `/` | Hero + paste-a-URL generator. Anonymous visitors see a "Log in to Generate" button. | No |
| `/login` | Email + password. Stores JWT in `localStorage`, redirects to `?from=…` or `/`. | No |
| `/history` | List of the current user's jobs, status badges, search, stats, download, delete. Auto-refreshes every 2s while jobs are in flight. | Yes |

---

## API reference

All `/jobs/*` endpoints require an `Authorization: Bearer <jwt>` header.

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ token, user }` | bcrypt verify, 7-day JWT |
| GET | `/auth/me` | – | `{ user }` | Validates the JWT |
| POST | `/jobs` | `{ url }` | `202 { job_id, status: "queued", … }` | Queues a transcript job |
| GET | `/jobs` | – | `{ jobs: […] }` | Caller's jobs, newest first |
| GET | `/jobs/:id` | – | `{ job }` | Caller's job only |
| GET | `/jobs/:id/download` | – | `application/pdf` stream | Auth + ownership + file-exists |
| DELETE | `/jobs/:id` | – | `{ ok: true }` | Removes row + PDF file |
| GET | `/health` | – | `{ ok: true }` | Public ping |

---

## How a job flows through the system

1. User pastes YouTube URL, hits **Generate**.
2. Browser `POST /api/jobs { url }` with `Authorization: Bearer <jwt>`.
3. Express `authMiddleware` decodes the JWT, sets `req.user = { id, email, name }`.
4. URL validated against a YouTube regex.
5. A UUID is generated. Row inserted: `INSERT INTO jobs (id, user_id, url, status='queued')`.
6. Job ID is pushed into an in-process queue. Response `202 Accepted` is sent immediately.
7. Worker drains the queue. `UPDATE jobs SET status='started' WHERE id=?`.
8. `spawn(python3, [PYTHON_SCRIPT, url, "<OUTPUT_DIR>/<id>.pdf"])`.
9. `transcribe.py` fetches captions, builds the PDF, exits 0.
10. `UPDATE jobs SET status='finished', output_path=?, finished_at=?`.
11. Frontend polls `GET /jobs/:id` every 1.5s until status flips to `finished`.
12. User clicks **Download** → `GET /jobs/:id/download` (auth-protected) streams the PDF as a blob.

### The user ↔ job ↔ PDF link

```
users.id  ──FK──►  jobs.user_id          (who owns the job)
jobs.id   ──identifier──►  "<id>.pdf"    (filename on disk)
```

So given any PDF, one SQL query gives you owner + URL + status. See `DOCUMENTATION.md` for the full schema and example queries.

---

## Creating users

There's no public registration. Run this one-liner from `backend/`:

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

---

## Production deployment (DigitalOcean Droplet)

### One-time server prep

```bash
# Install runtime
apt update && apt install -y curl git build-essential python3 python3-pip nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2
```

### Clone, install, configure

```bash
cd /var/www
git clone git@github.com:sny21292/turnoffroadvideo2text.git Video2Text
cd Video2Text

# backend
cd backend && npm ci && cp .env.example .env && nano .env   # fill values
cd scripts && pip3 install -r requirements.txt && chmod 755 transcribe.py

# frontend
cd ../../frontend
echo 'NEXT_PUBLIC_BACKEND_URL=/api' > .env.production
npm ci && npm run build
```

### Run with pm2

```bash
cd /var/www/Video2Text
pm2 start backend/src/server.js --name v2t-api
pm2 start "npm run start" --name frontend --cwd frontend
pm2 startup systemd          # follow the printed instruction
pm2 save
```

### nginx reverse proxy

```nginx
# /etc/nginx/sites-available/v2t
server {
  listen 80;
  server_name yourdomain.com;
  client_max_body_size 10m;

  location /api/ {
    proxy_pass http://127.0.0.1:8000/;   # trailing slash strips /api
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
  }
}
```

```bash
ln -sf /etc/nginx/sites-available/v2t /etc/nginx/sites-enabled/v2t
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### HTTPS (free, via Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

After this, update `backend/.env`:

```env
FRONTEND_ORIGIN=https://yourdomain.com
```

Then `pm2 restart v2t-api`.

### Redeploy workflow (after pushing changes to GitHub)

```bash
ssh root@your-droplet
cd /var/www/Video2Text
git pull origin main

# backend changed?
cd backend && npm ci && pm2 restart v2t-api

# frontend changed?
cd ../frontend && npm ci && npm run build && pm2 restart frontend
```

---

## Environment variables (full reference)

### `backend/.env`

| Key | Required? | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8000` | Backend listen port |
| `JWT_SECRET` | **yes** | — | Use `openssl rand -hex 48` |
| `PYTHON_SCRIPT` | yes (for real PDFs) | — | Absolute path to `transcribe.py`. If unset/missing, backend writes a tiny placeholder PDF so the rest of the flow can be tested. |
| `PYTHON_BIN` | no | `python3` | |
| `OUTPUT_DIR` | no | `./output` | Where PDFs are stored |
| `FRONTEND_ORIGIN` | no | `http://localhost:3000` | CORS allow-list. Comma-separate for multiple. Use `*` to allow any origin (dev only). |

### `frontend/.env.production` (build-time)

| Key | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8000` | In production behind nginx, set to `/api`. Must rebuild after changes. |

---

## SQLite — schema and useful queries

The DB lives at `backend/data/app.db` (gitignored). WAL mode is enabled.

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,             -- UUID, also the PDF filename
  user_id INTEGER NOT NULL,        -- FK → users.id
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  output_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Open the DB:

```bash
sqlite3 backend/data/app.db
```

```sql
-- every job with the owning user's email
SELECT j.id, u.email, j.url, j.status, j.created_at
FROM jobs j
JOIN users u ON u.id = j.user_id
ORDER BY j.created_at DESC;

-- PDF count per user
SELECT u.email, COUNT(j.id) AS pdfs
FROM users u
LEFT JOIN jobs j ON j.user_id = u.id AND j.status = 'finished'
GROUP BY u.id;
```

---

## Backup

The DB is one file. Back it up with the safe `.backup` command (no hot-copy corruption):

```bash
sqlite3 /var/www/Video2Text/backend/data/app.db \
  ".backup '/var/backups/v2t-$(date +%F).db'"
```

A daily cron at `/etc/cron.daily/v2t-backup`:

```bash
#!/bin/sh
sqlite3 /var/www/Video2Text/backend/data/app.db \
  ".backup '/var/backups/v2t-$(date +%F).db'"
find /var/backups -name 'v2t-*.db' -mtime +14 -delete
```

To restore:

```bash
pm2 stop v2t-api
cp /var/backups/v2t-2026-05-21.db /var/www/Video2Text/backend/data/app.db
pm2 start v2t-api
```

Also back up `/var/data/videototext/output/*.pdf` (or whatever your `OUTPUT_DIR` is) if losing generated PDFs would be a problem.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows `ERR_CONNECTION_REFUSED` on API calls | `NEXT_PUBLIC_BACKEND_URL` baked into the build is wrong (e.g. `localhost:8000`) | Set to `/api`, `npm run build`, `pm2 restart frontend` |
| API call returns Next.js 404 HTML | nginx is sending `/api/*` to Next.js, not the backend | Restore the `location /api/` block, `nginx -t && systemctl reload nginx` |
| `pm2 ls` shows v2t-api with high restart (⟲) count | Backend crashing on boot | `pm2 logs v2t-api` — usually missing `.env`, port in use, or `better-sqlite3` build failed (`npm rebuild better-sqlite3`) |
| Job stuck on `started` forever | Python script hangs or doesn't exit | `pm2 logs v2t-api` to see stderr, kill the python PID manually |
| Job fails with "Transcripts are disabled" | The video has no captions (manual or auto) | Try another video — there's no free way to transcribe a no-caption video |
| 404 on `/history` after deploy | Old build doesn't include the route | `npm run build` again, then `pm2 restart frontend` |
| PDF row says `finished` but download 404s | File was deleted from disk | The 410 response indicates this — restore from backup or delete the row |

---

## Removed / disabled features

- **Public sign-up.** No `/register` page, no `POST /auth/register`. Users are created via the Node one-liner above.
- **Home-page marketing sections.** "Engineered for Technical Accuracy" and "Ready to automate your technical writing?" — both removed.
- **Footer links** (Privacy / Terms / Contact / Docs) — footer now shows brand + copyright only.

---

## Tech stack recap

| Layer | Tech | Where it runs |
|---|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind v4 | port 3000 |
| Backend | Node.js 20 + Express + JWT | port 8000 |
| Database | SQLite via `better-sqlite3` (WAL mode) | file on disk |
| Worker | Python 3 (`transcribe.py`) | same Droplet, spawned per job |
| Reverse proxy | nginx (path-based `/api/*` split) | port 80 / 443 |
| Process supervisor | pm2 | persists across reboots |

For a deeper architecture walkthrough — DB schema, full code snippets, request lifecycles — see `DOCUMENTATION.md` (Mac-only, not pushed to GitHub).
