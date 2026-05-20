const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const db = require("./db");

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, "..", "output"));
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const PYTHON_SCRIPT = process.env.PYTHON_SCRIPT || "";

const queue = [];
let running = false;

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
  const sql = `UPDATE jobs SET ${fields.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
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

function runJob(id) {
  return new Promise((resolve, reject) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    if (!job) return resolve();

    const outputPath = path.join(OUTPUT_DIR, `${id}.pdf`);
    setStatus(id, { status: "started" });

    if (!PYTHON_SCRIPT || !fs.existsSync(PYTHON_SCRIPT)) {
      // Fallback for local dev: write a tiny placeholder PDF so the flow
      // is testable before the client's Python script is wired up.
      const minimalPdf = Buffer.from(
        "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF",
        "utf8"
      );
      fs.writeFile(outputPath, minimalPdf, (err) => {
        if (err) return reject(err);
        setStatus(id, {
          status: "finished",
          output_path: outputPath,
          finished_at: new Date().toISOString(),
        });
        resolve();
      });
      return;
    }

    const child = spawn(PYTHON_BIN, [PYTHON_SCRIPT, job.url, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        setStatus(id, {
          status: "finished",
          output_path: outputPath,
          finished_at: new Date().toISOString(),
        });
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Python script exited with code ${code}`));
      }
    });
  });
}

// On startup, requeue any jobs left in queued/started state so a crash
// doesn't leave them stuck forever.
function recoverPending() {
  const rows = db
    .prepare("SELECT id FROM jobs WHERE status IN ('queued','started') ORDER BY created_at ASC")
    .all();
  for (const row of rows) {
    db.prepare("UPDATE jobs SET status = 'queued' WHERE id = ?").run(row.id);
    queue.push(row.id);
  }
  if (queue.length > 0) process.nextTick(drain);
}
recoverPending();

module.exports = { enqueue, OUTPUT_DIR };
