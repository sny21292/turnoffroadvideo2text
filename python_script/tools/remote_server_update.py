#!/usr/bin/env python3
"""Upload and run server_update.sh on the Turn Offroad droplet."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = "159.203.184.236"
USER = "root"
PASSWORD = os.environ.get("SSH_PASSWORD", "")
LOCAL_SCRIPT = Path(__file__).resolve().parent / "server_update.sh"
REMOTE_SCRIPT = "/tmp/v2t_server_update.sh"

# Pass script name as argv: diagnose | update (default update)
SCRIPT = sys.argv[1] if len(sys.argv) > 1 else "update"
if SCRIPT == "diagnose":
    LOCAL_SCRIPT = Path(__file__).resolve().parent / "server_diagnose.sh"
    REMOTE_SCRIPT = "/tmp/v2t_server_diagnose.sh"


def main() -> int:
    if not LOCAL_SCRIPT.is_file():
        print(f"Missing {LOCAL_SCRIPT}", file=sys.stderr)
        return 1
    if not PASSWORD:
        print("Set SSH_PASSWORD env var (server root password).", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {USER}@{HOST} ...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = client.open_sftp()
    content = LOCAL_SCRIPT.read_bytes().replace(b"\r\n", b"\n")
    with sftp.file(REMOTE_SCRIPT, "w") as remote:
        remote.write(content)
    sftp.chmod(REMOTE_SCRIPT, 0o755)
    sftp.close()

    stdin, stdout, stderr = client.exec_command(
        f"bash {REMOTE_SCRIPT}",
        get_pty=True,
    )
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
    if err.strip():
        sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
