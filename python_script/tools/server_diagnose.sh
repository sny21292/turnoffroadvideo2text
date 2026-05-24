#!/bin/bash
set -euo pipefail

APP=/var/www/Video2Text/python_script
cd /var/www/Video2Text

echo "=== BRANCH ==="
git branch --show-current
git log --oneline -2

echo "=== YT_DLP in .env ==="
grep -E '^YT_DLP_' "$APP/.env" || echo "(none)"

echo "=== pipeline has auth helpers? ==="
grep -c '_yt_dlp_auth_args\|yt_dlp_config_status' "$APP/youtube_to_word_pipeline.py" || true

echo "=== start.sh ==="
cat "$APP/start.sh" 2>/dev/null || echo "(no start.sh)"

echo "=== COOKIES ==="
ls -la /etc/yt-dlp/cookies.txt || true

echo "=== PM2 ==="
pm2 ls

echo "=== HEALTH ==="
curl -s http://127.0.0.1:4000/health | python3 -m json.tool || curl -s http://127.0.0.1:4000/health

echo "=== YT-DLP TITLE TEST ==="
"$APP/.venv/bin/yt-dlp" \
  --cookies /etc/yt-dlp/cookies.txt \
  --remote-components ejs:github \
  --extractor-args 'youtube:player_client=web,mweb,android' \
  --skip-download --print title \
  'https://www.youtube.com/watch?v=4SNa82J79SU' 2>&1 || true
