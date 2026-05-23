const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const db = require("./db");

const OUTPUT_DIR = path.resolve(
  process.env.OUTPUT_DIR || path.join(__dirname, "..", "output")
);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const PYTHON_SERVICE_URL = (
  process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:4000"
).replace(/\/$/, "");
const PYTHON_SERVICE_API_KEY = process.env.PYTHON_SERVICE_API_KEY || "";
const POLL_INTERVAL_MS = Number(process.env.PYTHON_POLL_INTERVAL_MS || 3000);
const JOB_TIMEOUT_MS = Number(
  process.env.PYTHON_JOB_TIMEOUT_MS || 60 * 60 * 1000
); // 60 min default

const queue = [];
let running = false;

function authHeaders() {
  return PYTHON_SERVICE_API_KEY
    ? { Authorization: `Bearer ${PYTHON_SERVICE_API_KEY}` }
    : {};
}

function enqueue(userId, url) {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO jobs (id, user_id, url, status) VALUES (?, ?, ?, 'queued')"
  ).run(id, userId, url);
  queue.push(id);
  process.nextTick(drain);
  return id;
}

function setStatus(id, patch) {
  const fields = Object.keys(patch);
  const values = fields.map((k) => patch[k]);
  const sql = `UPDATE jobs SET ${fields
    .map((k) => `${k} = ?`)
    .join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...values, id);
}

function drain() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  runJob(id)
    .catch((err) => {
      setStatus(id, {
        status: "failed",
        error: err?.message || String(err),
        finished_at: new Date().toISOString(),
      });
    })
    .finally(() => {
      running = false;
      if (queue.length > 0) process.nextTick(drain);
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob(id) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!job) return;

  setStatus(id, { status: "started" });

  // 1) Submit job to Python pipeline
  let pythonJobId;
  try {
    const resp = await fetch(`${PYTHON_SERVICE_URL}/api/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ youtube_url: job.url }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Pipeline returned HTTP ${resp.status}: ${body.slice(0, 300)}`
      );
    }
    const data = await resp.json();
    pythonJobId = data.job_id;
    if (!pythonJobId) throw new Error("Pipeline did not return job_id.");
    setStatus(id, { python_job_id: pythonJobId });
  } catch (err) {
    throw new Error(`Could not submit job to pipeline: ${err.message}`);
  }

  // 2) Poll the pipeline until terminal status or timeout
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let payload;
    try {
      const resp = await fetch(
        `${PYTHON_SERVICE_URL}/api/v1/jobs/${pythonJobId}`,
        { headers: authHeaders() }
      );
      if (!resp.ok) {
        consecutiveErrors++;
        if (consecutiveErrors > 20) {
          throw new Error(
            `Pipeline unreachable: ${resp.status} for ${consecutiveErrors} consecutive polls`
          );
        }
        continue;
      }
      payload = await resp.json();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors > 20) {
        throw new Error(`Pipeline unreachable: ${err.message}`);
      }
      continue;
    }

    if (payload.status === "completed") {
      const outputFilename = payload.output_filename;
      if (!outputFilename) {
        throw new Error(
          "Pipeline marked job completed but did not return output_filename."
        );
      }
      const absPath = path.join(OUTPUT_DIR, outputFilename);
      setStatus(id, {
        status: "finished",
        output_filename: outputFilename,
        output_path: absPath,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    if (payload.status === "failed") {
      throw new Error(payload.error || "Pipeline failed without a message.");
    }
    // status is "queued" or "running" — keep polling
  }

  throw new Error(
    `Job timed out after ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes without completing.`
  );
}

// On startup, requeue any jobs left in queued/started state so a crash
// doesn't leave them stuck forever.
function recoverPending() {
  const rows = db
    .prepare(
      "SELECT id FROM jobs WHERE status IN ('queued','started') ORDER BY created_at ASC"
    )
    .all();
  for (const row of rows) {
    db.prepare("UPDATE jobs SET status = 'queued' WHERE id = ?").run(row.id);
    queue.push(row.id);
  }
  if (queue.length > 0) process.nextTick(drain);
}
recoverPending();

module.exports = { enqueue, OUTPUT_DIR };
