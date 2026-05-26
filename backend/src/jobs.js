const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { authMiddleware } = require("./auth");
const { enqueue, OUTPUT_DIR } = require("./queue");

const router = express.Router();

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
const MAX_EXTRA_INSTRUCTION_LEN = 500;

function jobToResponse(job) {
  return {
    job_id: job.id,
    url: job.url,
    status: job.status,
    error: job.error,
    download_url: job.status === "finished" ? `/jobs/${job.id}/download` : null,
    created_at: job.created_at,
    finished_at: job.finished_at,
    extra_instruction: job.extra_instruction ?? null,
  };
}

router.post("/", authMiddleware, (req, res) => {
  const { url, extra_instruction } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "A YouTube URL is required." });
  }
  const trimmedUrl = url.trim();
  if (!YT_REGEX.test(trimmedUrl)) {
    return res.status(400).json({ error: "Please enter a valid YouTube URL." });
  }

  let extra = null;
  if (extra_instruction != null) {
    if (typeof extra_instruction !== "string") {
      return res.status(400).json({ error: "Extra instruction must be a string." });
    }
    const trimmedExtra = extra_instruction.trim();
    if (trimmedExtra.length > MAX_EXTRA_INSTRUCTION_LEN) {
      return res.status(400).json({
        error: `Extra instruction is too long (max ${MAX_EXTRA_INSTRUCTION_LEN} characters).`,
      });
    }
    if (trimmedExtra.length > 0) extra = trimmedExtra;
  }

  const id = enqueue(req.user.id, trimmedUrl, extra);
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
  if (job.status !== "finished") {
    return res.status(409).json({ error: "Job is not ready yet." });
  }

  // New flow: pipeline writes <videoId>.docx into OUTPUT_DIR and records the basename
  // in output_filename. Old jobs (pre-pipeline) used output_path absolute and .pdf.
  let filePath, downloadName, contentType;
  if (job.output_filename) {
    filePath = path.join(OUTPUT_DIR, job.output_filename);
    downloadName = job.output_filename;
    contentType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (job.output_path) {
    filePath = job.output_path;
    downloadName = `installation-guide-${job.id.slice(0, 8)}.pdf`;
    contentType = "application/pdf";
  } else {
    return res.status(410).json({ error: "Output file path is missing." });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: "Output file is no longer available." });
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${downloadName}"`
  );
  fs.createReadStream(filePath).pipe(res);
});

router.delete("/:id", authMiddleware, (req, res) => {
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  // Resolve the on-disk file the same way the download endpoint does.
  let filePath;
  if (job.output_filename) {
    filePath = path.join(OUTPUT_DIR, job.output_filename);
  } else if (job.output_path) {
    filePath = job.output_path;
  }
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
  res.json({ ok: true });
});

module.exports = router;
