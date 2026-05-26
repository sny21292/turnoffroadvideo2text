const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    output_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);
`);

// Idempotent migrations — safe to re-run on every boot.
const jobsColumns = new Set(
  db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name)
);
if (!jobsColumns.has("python_job_id")) {
  db.exec("ALTER TABLE jobs ADD COLUMN python_job_id TEXT");
}
if (!jobsColumns.has("output_filename")) {
  db.exec("ALTER TABLE jobs ADD COLUMN output_filename TEXT");
}
if (!jobsColumns.has("extra_instruction")) {
  db.exec("ALTER TABLE jobs ADD COLUMN extra_instruction TEXT");
}

module.exports = db;
