# Deploy on DigitalOcean (pipeline API)

## What stays on disk

| Path | Size | Retention |
|------|------|-----------|
| `output/` (`DELIVERABLE_OUTPUT_DIR`) | ~5–20 MB per guide | **Keep** — dashboard + SQL filename |
| `api_jobs/<job_id>/` | 100 MB – 2 GB | **Deleted** after successful run |
| `api_jobs/_archive/<job_id>.json` | ~2 KB | Kept until pruned (default 7) |

## Droplet setup (Ubuntu)

```bash
sudo apt update
sudo apt install -y ffmpeg python3.11 python3.11-venv
pip install yt-dlp  # or: sudo apt install yt-dlp

cd /var/www/turnoffroadvideo2text/python_script
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: API keys, API_KEY, DELIVERABLE_OUTPUT_DIR
mkdir -p output api_jobs assets
```

### Production `.env` highlights

```env
API_KEY=<shared-secret-for-node-backend>
DELIVERABLE_OUTPUT_DIR=/var/data/videototext/output
DELIVERABLE_FILENAME_STYLE=video_id
LOGO_PATH=assets/turnoffroad_logo1.jpg

# YouTube — datacenter IPs get bot-checked without cookies
YT_DLP_COOKIES_FILE=/etc/yt-dlp/cookies.txt
YT_DLP_REMOTE_COMPONENTS=ejs:github
YT_DLP_PLAYER_CLIENT=web,mweb,android
# YT_DLP_BIN=/var/www/Video2Text/python_script/.venv/bin/yt-dlp
```

Paths like `output`, `api_jobs`, and `assets/...` are resolved relative to **`python_script/`**, not the shell cwd — safe under pm2/systemd.

## YouTube auth on the droplet

DigitalOcean IPs are often flagged by YouTube (`Sign in to confirm you're not a bot`). Local dev works; production needs auth.

**Recommended fix: browser cookies (what Sunil already set up at `/etc/yt-dlp/cookies.txt`)**

The pipeline now passes `--cookies`, `--remote-components`, and player-client overrides to every yt-dlp call. Add to `python_script/.env`:

```env
YT_DLP_COOKIES_FILE=/etc/yt-dlp/cookies.txt
YT_DLP_REMOTE_COMPONENTS=ejs:github
YT_DLP_PLAYER_CLIENT=web,mweb,android
```

### 1. Export fresh cookies (do this on your laptop)

Use a **throwaway Google account** (not personal). Log into YouTube in Chrome/Firefox, then export Netscape-format cookies:

**Option A — browser extension**  
Install "Get cookies.txt LOCALLY" (Chrome/Firefox). Export for `youtube.com` only.

**Option B — yt-dlp from your laptop**

```bash
yt-dlp --cookies-from-browser chrome --cookies /tmp/youtube_cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

### 2. Copy cookies to the server

```bash
scp /tmp/youtube_cookies.txt root@159.203.184.236:/etc/yt-dlp/cookies.txt
ssh root@159.203.184.236 "chmod 600 /etc/yt-dlp/cookies.txt && chown root:root /etc/yt-dlp/cookies.txt"
```

Ensure the pm2 process user can read the file (run pm2 as root, or `chown` to that user).

### 3. Install deno (for EJS challenge solver)

```bash
curl -fsSL https://deno.land/install.sh | sh
ln -sf ~/.deno/bin/deno /usr/local/bin/deno
```

### 4. Test on the server before running a full job

```bash
cd /var/www/Video2Text/python_script
source .venv/bin/activate
.venv/bin/yt-dlp \
  --cookies /etc/yt-dlp/cookies.txt \
  --remote-components ejs:github \
  --extractor-args "youtube:player_client=web,mweb,android" \
  -f "best[height<=720]" \
  -o /tmp/test.mp4 \
  "https://www.youtube.com/watch?v=VIDEO_ID"
```

If that works, restart the pipeline and check health:

```bash
pm2 restart v2t-python-pipeline
curl -s http://127.0.0.1:4000/health | python3 -m json.tool
# yt_dlp.cookies_loaded should be true
```

### 5. Cookies expire — refresh every few weeks

When jobs fail with bot errors again, re-export cookies from the browser and replace `/etc/yt-dlp/cookies.txt`. No code deploy needed.

### Fallback: residential proxy

If cookies alone are not enough:

```env
YT_DLP_PROXY=http://user:pass@residential-proxy-host:port
```

Use a **residential** (not datacenter) proxy. Datacenter proxies hit the same bot wall.

**Backend/frontend:** no changes needed — this is entirely in `python_script/.env` + server files.

## Run with pm2 (recommended)

From `python_script/`:

```bash
source .venv/bin/activate
pm2 start ecosystem.config.cjs
pm2 save
```

Manual start (same port):

```bash
cd /var/www/turnoffroadvideo2text/python_script
source .venv/bin/activate
uvicorn api_server:app --host 127.0.0.1 --port 4000
```

Use port **4000** (Node backend is on 8000, frontend on 3000).

## Sunil backend integration

Node calls (Bearer `API_KEY`):

- `POST http://127.0.0.1:4000/jobs` with `{ "url": "https://youtube.com/watch?v=..." }`
- Poll `GET http://127.0.0.1:4000/jobs/{job_id}` until `status` is `completed` or `failed`
- Store `output_filename` in SQL (e.g. `abc123.docx`)
- Serve files from `/var/data/videototext/output/` (same as `DELIVERABLE_OUTPUT_DIR`)

Extended dev API also available at `/api/v1/jobs`.

## Cleanup env (production defaults)

```env
API_DELETE_JOB_DIR_ON_SUCCESS=true
API_DELETE_JOB_DIR_ON_FAILURE=false
API_PRUNE_OLD_JOBS_DAYS=7
```

After each successful job the server deletes `api_jobs/<job_id>/` (video + logs). Job metadata is kept in `api_jobs/_archive/` for polling. Finished guides stay in `output/` (or `DELIVERABLE_OUTPUT_DIR`).

## Health check

`GET /health` returns `app_root`, `jobs_dir`, `deliverable_output_dir`, and disk cleanup settings. Verify paths point under `python_script/` (or your absolute deliverable dir).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Could not import module "api_server"` | Start from `python_script/` or use `pm2 start ecosystem.config.cjs` |
| Jobs write to wrong folder / `.env` ignored | Ensure `.env` lives in `python_script/` (not repo root) |
| Logo missing in Word doc | Check `LOGO_PATH=assets/turnoffroad_logo1.jpg` and that `assets/` is deployed |
| `ffmpeg` / `yt-dlp` not found | Install system packages; confirm `which ffmpeg yt-dlp` in the venv shell |
| `Sign in to confirm you're not a bot` | Set `YT_DLP_COOKIES_FILE`, refresh cookies, restart pm2 — see **YouTube auth** above |
| `/health` shows `cookies_loaded: false` | Cookie path wrong or file unreadable by pm2 user |
