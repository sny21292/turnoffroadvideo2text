# Server SSH helpers

Run from your laptop (Windows PowerShell):

```powershell
cd python_script\tools
pip install paramiko
$env:SSH_PASSWORD = "your-server-password"

# Diagnose only (health, pm2, yt-dlp test)
python remote_server_update.py diagnose

# Update .env YT_DLP vars + restart pm2 + test
python remote_server_update.py update
```

Or SSH manually:

```powershell
ssh root@159.203.184.236
```

Use the password Sunil shared in chat.

## On the server (after SSH)

```bash
cd /var/www/Video2Text/python_script
grep YT_DLP_ .env
pm2 logs v2t-python-pipeline --lines 50
curl -s http://127.0.0.1:4000/health | python3 -m json.tool
```

## Refresh YouTube cookies (required when bot error persists)

On your **laptop** (logged into YouTube in Chrome with a throwaway Google account):

1. Install browser extension **Get cookies.txt LOCALLY**
2. Export cookies for `youtube.com` → save as `youtube_cookies.txt`
3. Upload to server:

```powershell
scp youtube_cookies.txt root@159.203.184.236:/etc/yt-dlp/cookies.txt
```

4. On server:

```bash
chmod 600 /etc/yt-dlp/cookies.txt
pm2 restart v2t-python-pipeline
```

5. Test:

```bash
/var/www/Video2Text/python_script/.venv/bin/yt-dlp \
  --cookies /etc/yt-dlp/cookies.txt \
  --remote-components ejs:github \
  --skip-download --print title \
  "https://www.youtube.com/watch?v=4SNa82J79SU"
```

Pass = prints video title. Fail = need fresh cookies or residential proxy.
