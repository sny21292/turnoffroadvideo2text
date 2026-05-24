#!/bin/bash
set -euo pipefail

APP=/var/www/Video2Text/python_script
REPO=/var/www/Video2Text
cd "$REPO"

echo "=== FIX GIT (untracked start.sh blocks pull) ==="
if [ -f "$APP/start.sh" ] && ! git ls-files --error-unmatch "$APP/start.sh" >/dev/null 2>&1; then
  mv "$APP/start.sh" "$APP/start.sh.local.bak"
fi
git fetch origin main
git pull --rebase origin main

echo "=== YT_DLP ENV (before) ==="
grep -E '^YT_DLP_' "$APP/.env" || echo "(none set)"

ensure() {
  key="$1"
  val="$2"
  if grep -q "^${key}=" "$APP/.env"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$APP/.env"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$APP/.env"
  fi
}

ensure YT_DLP_COOKIES_FILE /etc/yt-dlp/cookies.txt
ensure YT_DLP_REMOTE_COMPONENTS ejs:github
ensure YT_DLP_PLAYER_CLIENT web,mweb,android
ensure YT_DLP_BIN /var/www/Video2Text/python_script/.venv/bin/yt-dlp

echo "=== YT_DLP ENV (after) ==="
grep -E '^YT_DLP_' "$APP/.env"

echo "=== RESTART PIPELINE ==="
pm2 restart v2t-python-pipeline
sleep 3

echo "=== HEALTH ==="
curl -s http://127.0.0.1:4000/health | python3 -m json.tool

echo "=== YT-DLP TESTS ==="
for client in "web,mweb,android" "mweb" "android" "tv"; do
  echo "--- player_client=$client ---"
  "$APP/.venv/bin/yt-dlp" \
    --cookies /etc/yt-dlp/cookies.txt \
    --remote-components ejs:github \
    --extractor-args "youtube:player_client=${client}" \
    --skip-download --print title \
    'https://www.youtube.com/watch?v=4SNa82J79SU' 2>&1 | tail -3 || true
done
