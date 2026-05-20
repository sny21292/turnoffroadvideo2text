const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { authMiddleware } = require("./auth");
const { enqueue } = require("./queue");

const router = express.Router();

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;

function jobToResponse(job) {
  return {
    job_id: job.id,
    url: job.url,
    status: job.status,
    error: job.error,
    download_url: job.status === "finished" ? `/jobs/${job.id}/download` : null,
    created_at: job.created_at,
    finished_at: job.finished_at,
  };
}

router.post("/", authMiddleware, (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "A YouTube URL is required." });
  }
  const trimmed = url.trim();
  if (!YT_REGEX.test(trimmed)) {
    return res.status(400).json({ error: "Please enter a valid YouTube URL." });
  }
  const id = enqueue(req.user.id, trimmed);
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return res.status(202).json(jobToResponse(job));
});

router.get("/", authMiddleware, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY datetime(created_at) DESC")
    .all(req.user.id);
  res.json({ jobs: rows.map(jobToResponse) });
});

router.get("/:id", authMiddleware, (req, res) => {
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(jobToResponse(job));
});

router.get("/:id/download", authMiddleware, (req, res) => {
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.status !== "finished" || !job.output_path) {
    return res.status(409).json({ error: "Job is not ready yet." });
  }
  if (!fs.existsSync(job.output_path)) {
    return res.status(410).json({ error: "Output file is no longer available." });
  }
  const filename = `installation-guide-${job.id.slice(0, 8)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(job.output_path).pipe(res);
});

router.delete("/:id", authMiddleware, (req, res) => {
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.output_path && fs.existsSync(job.output_path)) {
    try { fs.unlinkSync(job.output_path); } catch { /* ignore */ }
  }
  db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
  res.json({ ok: true });
});

module.exports = router;
