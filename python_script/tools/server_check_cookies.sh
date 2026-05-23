#!/bin/bash
# Quick cookie sanity check (does not print cookie values)
COOKIES=/etc/yt-dlp/cookies.txt
echo "File: $COOKIES"
ls -la "$COOKIES" 2>/dev/null || exit 1
echo "Lines: $(wc -l < "$COOKIES")"
echo "Has .youtube.com entries: $(grep -c '\.youtube\.com' "$COOKIES" || true)"
echo "Has LOGIN_INFO: $(grep -c 'LOGIN_INFO' "$COOKIES" || true)"
echo "Has SID: $(grep -c '\tSID\t' "$COOKIES" || true)"
echo "Has __Secure-3PSID: $(grep -c '__Secure-3PSID' "$COOKIES" || true)"
head -1 "$COOKIES"
