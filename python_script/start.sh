#!/bin/bash
# pm2-friendly entry for the Python pipeline API.
# Activates venv + runs uvicorn bound to localhost on port 4000.
# Node backend (port 8000) calls this over http://127.0.0.1:4000/.
#
# unset NODE_CHANNEL_FD: PM2 sets this fd=3 IPC env var for every child process
# (Node clustering uses it). When yt-dlp later spawns deno from inside us, deno
# inherits the var and crashes with "Failed to open IPC channel from
# NODE_CHANNEL_FD". We're not a Node process, we don't need it. Unsetting in
# our shell stops inheritance for all our children.
set -e
unset NODE_CHANNEL_FD
cd "$(dirname "$(readlink -f "$0")")"
source .venv/bin/activate
exec uvicorn api_server:app --host 127.0.0.1 --port 4000
