# Video2Text

YouTube installation video → AI-generated PDF guide.

- **Frontend:** Next.js (App Router) + Tailwind v4
- **Backend:** Node.js (Express) + SQLite + JWT auth
- **Worker:** spawns the client-provided Python script per job

## Pages

- `/` — generator (paste a YouTube URL, watch it process, download PDF)
- `/login`, `/register` — auth (JWT in `localStorage`)
- `/history` — per-user list of every submitted URL, with status + PDF download + delete

## Running locally

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # edit JWT_SECRET and PYTHON_SCRIPT
npm run dev               # → http://localhost:8000
```

`.env` keys:

| Key | What |
|---|---|
| `PORT` | Backend port (default 8000) |
| `JWT_SECRET` | Long random string for signing tokens |
| `PYTHON_SCRIPT` | Absolute path to the client's Python script. It must accept `<youtube_url> <output_pdf_path>` as args. |
| `PYTHON_BIN` | `python3` by default |
| `OUTPUT_DIR` | Where generated PDFs are stored (default `./output`) |
| `FRONTEND_ORIGIN` | CORS origin (default `http://localhost:3000`) |

If `PYTHON_SCRIPT` is unset/missing, the worker writes a tiny placeholder PDF so the full flow still works in dev.

### 2. Frontend

```bash
cd frontend
npm install
# optional — only needed if backend is not on http://localhost:8000
echo 'NEXT_PUBLIC_BACKEND_URL=http://localhost:8000' > .env.local
npm run dev               # → http://localhost:3000
```

## API

All `/jobs` endpoints require `Authorization: Bearer <token>`.

| Method | Path | Body / Notes |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` → `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | current user |
| POST | `/jobs` | `{ url }` — queues a job |
| GET | `/jobs` | list current user's jobs |
| GET | `/jobs/:id` | one job |
| GET | `/jobs/:id/download` | streams the generated PDF |
| DELETE | `/jobs/:id` | removes job + PDF |

## Wiring up the client's Python script

The Node worker (`backend/src/queue.js`) spawns:

```
$PYTHON_BIN $PYTHON_SCRIPT <youtube_url> <output_pdf_path>
```

The script must exit 0 and write a PDF to the second argument. stderr is captured and surfaced as the job's `error` if it exits non-zero.
