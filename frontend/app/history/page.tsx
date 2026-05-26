"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  JobResponse,
  deleteJob,
  downloadJob,
  listJobs,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";

const STATUS_STYLES: Record<string, string> = {
  finished: "bg-emerald-100 text-emerald-800 border-emerald-200",
  failed: "bg-error/10 text-error border-error/30",
  canceled: "bg-error/10 text-error border-error/30",
  stopped: "bg-error/10 text-error border-error/30",
  queued: "bg-secondary/20 text-on-secondary border-secondary/40",
  scheduled: "bg-secondary/20 text-on-secondary border-secondary/40",
  deferred: "bg-secondary/20 text-on-secondary border-secondary/40",
  started:
    "bg-amber-100 text-amber-900 border-amber-200 animate-[pulse_2s_ease-in-out_infinite]",
};

const STATUS_LABEL: Record<string, string> = {
  finished: "Ready",
  failed: "Failed",
  canceled: "Canceled",
  stopped: "Stopped",
  queued: "Queued",
  scheduled: "Queued",
  deferred: "Queued",
  started: "Processing",
};

export default function HistoryPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [jobs, setJobs] = useState<JobResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await listJobs();
      setJobs(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?from=/history");
      return;
    }
    refresh();
  }, [ready, user, router, refresh]);

  // Keep auto-refreshing while any job is still in flight.
  useEffect(() => {
    if (!jobs) return;
    const anyPending = jobs.some(
      (j) =>
        j.status === "queued" ||
        j.status === "started" ||
        j.status === "scheduled" ||
        j.status === "deferred"
    );
    if (!anyPending) return;
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [jobs, refresh]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.url.toLowerCase().includes(q) ||
        j.job_id.toLowerCase().includes(q) ||
        j.status.toLowerCase().includes(q) ||
        (j.extra_instruction ?? "").toLowerCase().includes(q)
    );
  }, [jobs, query]);

  const stats = useMemo(() => {
    if (!jobs) return { total: 0, ready: 0, pending: 0, failed: 0 };
    return {
      total: jobs.length,
      ready: jobs.filter((j) => j.status === "finished").length,
      pending: jobs.filter(
        (j) =>
          j.status === "queued" ||
          j.status === "started" ||
          j.status === "scheduled" ||
          j.status === "deferred"
      ).length,
      failed: jobs.filter(
        (j) =>
          j.status === "failed" ||
          j.status === "canceled" ||
          j.status === "stopped"
      ).length,
    };
  }, [jobs]);

  async function handleDownload(job: JobResponse) {
    setBusyId(job.job_id);
    try {
      await downloadJob(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(job: JobResponse) {
    if (!window.confirm("Delete this entry from your history?")) return;
    setBusyId(job.job_id);
    try {
      await deleteJob(job.job_id);
      setJobs((prev) => prev?.filter((j) => j.job_id !== job.job_id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready || !user) {
    return (
      <main className="pt-32 px-4 max-w-[1200px] mx-auto w-full">
        <div className="h-40 animate-pulse rounded-2xl bg-surface-container" />
      </main>
    );
  }

  return (
    <main className="pt-28 md:pt-32 pb-20 px-4 md:px-10 max-w-[1200px] mx-auto w-full">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
        <div>
          <span className="inline-block font-mono text-xs text-primary uppercase tracking-widest mb-2">
            Your Library
          </span>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            History
          </h1>
          <p className="mt-2 text-on-surface-variant max-w-xl">
            Every YouTube link you&apos;ve submitted, ready to download as a
            Word document whenever you need it again.
          </p>
        </div>
        <Link
          href="/"
          className="bg-primary text-on-primary px-5 py-3 rounded-xl font-semibold text-center hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-[0.98] transition-all"
        >
          + New guide
        </Link>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Ready" value={stats.ready} accent="emerald" />
        <StatCard label="Processing" value={stats.pending} accent="amber" />
        <StatCard label="Failed" value={stats.failed} accent="error" />
      </div>

      <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by URL or status…"
          className="flex-1 sm:max-w-md bg-white border border-black/10 rounded-xl py-2.5 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all"
        />
        <button
          type="button"
          onClick={refresh}
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors self-start sm:self-auto"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-error/10 border border-error/30 text-error text-sm px-4 py-3">
          {error}
        </div>
      )}

      {jobs === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl bg-surface-container"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasJobs={(jobs?.length ?? 0) > 0} query={query} />
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((job) => (
            <JobRow
              key={job.job_id}
              job={job}
              busy={busyId === job.job_id}
              onDownload={() => handleDownload(job)}
              onDelete={() => handleDelete(job)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "amber" | "error";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : accent === "error"
      ? "text-error"
      : "text-on-surface";
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function JobRow({
  job,
  busy,
  onDownload,
  onDelete,
}: {
  job: JobResponse;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const badge =
    STATUS_STYLES[job.status] ||
    "bg-surface-container text-on-surface-variant border-black/10";
  const label = STATUS_LABEL[job.status] || job.status;
  return (
    <li className="glass-card rounded-2xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${badge}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
            {label}
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant tracking-wider">
            #{job.job_id.slice(0, 8)}
          </span>
        </div>
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-on-surface font-medium hover:text-primary transition-colors"
          title={job.url}
        >
          {job.url}
        </a>
        <div className="mt-1 text-xs text-on-surface-variant">
          {formatDate(job.created_at)}
          {job.error ? (
            <span className="ml-2 text-error">· {job.error}</span>
          ) : null}
        </div>
        {job.extra_instruction ? (
          <div
            className="mt-1.5 text-xs italic text-on-surface-variant flex items-start gap-1"
            title={job.extra_instruction}
          >
            <span aria-hidden className="select-none">💬</span>
            <span className="line-clamp-2 break-words">
              &ldquo;{job.extra_instruction}&rdquo;
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 md:flex-shrink-0">
        {job.status === "finished" && job.download_url ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDownload}
            className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {busy ? "Downloading…" : "Download .docx"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete entry"
          title="Delete entry"
          className="border border-black/10 text-on-surface-variant hover:text-error hover:border-error/40 hover:bg-error/5 px-3 py-2 rounded-xl text-sm transition-colors disabled:opacity-60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </li>
  );
}

function EmptyState({ hasJobs, query }: { hasJobs: boolean; query: string }) {
  if (hasJobs && query) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center">
        <p className="text-on-surface-variant">
          No entries matched &quot;{query}&quot;.
        </p>
      </div>
    );
  }
  return (
    <div className="glass-card rounded-3xl p-10 md:p-16 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-7 h-7 text-primary"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
          <line x1="9" y1="11" x2="13" y2="11" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">
        No guides yet
      </h2>
      <p className="mt-2 text-on-surface-variant max-w-md mx-auto">
        Drop a YouTube link on the generator and your guide will appear here
        the moment it&apos;s ready.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block bg-primary text-on-primary px-6 py-3 rounded-xl font-semibold hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-[0.98] transition-all"
      >
        Generate your first guide
      </Link>
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
