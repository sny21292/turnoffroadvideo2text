"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  JobResponse,
  RqStatus,
  downloadJob,
  getJob,
  submitJob,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { CheckCircleIcon, PlayCircleIcon } from "./icons";

type UiState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "polling"; job: JobResponse }
  | { kind: "done"; job: JobResponse }
  | { kind: "error"; message: string };

const FRIENDLY_STATUS: Record<RqStatus, string> = {
  queued: "Queued",
  scheduled: "Queued",
  deferred: "Queued",
  started: "Processing video",
  finished: "Done",
  failed: "Failed",
  canceled: "Canceled",
  stopped: "Stopped",
};

export function UrlGenerator() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<UiState>({ kind: "idle" });
  const [downloading, setDownloading] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => stopPolling, []);

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function reset() {
    stopPolling();
    setUrl("");
    setState({ kind: "idle" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || state.kind === "submitting" || state.kind === "polling")
      return;
    if (!user) {
      router.push(`/login?from=${encodeURIComponent("/")}`);
      return;
    }
    setState({ kind: "submitting" });
    try {
      const job = await submitJob(url.trim());
      setState({ kind: "polling", job });
      startPolling(job.job_id);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not submit job.",
      });
    }
  }

  function startPolling(jobId: string) {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const job = await getJob(jobId);
        if (job.status === "finished") {
          stopPolling();
          setState({ kind: "done", job });
        } else if (
          job.status === "failed" ||
          job.status === "canceled" ||
          job.status === "stopped"
        ) {
          stopPolling();
          setState({
            kind: "error",
            message: job.error ?? `Job ${job.status}`,
          });
        } else {
          setState({ kind: "polling", job });
        }
      } catch {
        // transient — retry next tick
      }
    }, 1500);
  }

  async function handleDownload() {
    if (state.kind !== "done") return;
    setDownloading(true);
    try {
      await downloadJob(state.job);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Download failed.",
      });
    } finally {
      setDownloading(false);
    }
  }

  const isBusy = state.kind === "submitting" || state.kind === "polling";
  const isLoggedOut = ready && !user;

  return (
    <div className="w-full max-w-3xl glass-card rounded-2xl p-6 md:p-10 ai-glow relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-1000 pointer-events-none" />

      <form
        onSubmit={handleSubmit}
        className="relative flex flex-col md:flex-row gap-4"
      >
        <div className="flex-grow relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <PlayCircleIcon className="w-6 h-6 text-on-surface-variant" />
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube video URL..."
            required
            disabled={isBusy}
            className="w-full bg-white border border-black/10 rounded-xl py-4 pl-12 pr-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={isBusy}
          className="bg-primary text-on-primary px-8 py-4 rounded-xl font-semibold whitespace-nowrap hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {state.kind === "submitting"
            ? "Submitting…"
            : state.kind === "polling"
            ? "Processing…"
            : isLoggedOut
            ? "Log in to Generate"
            : "Generate Installation Guide"}
        </button>
      </form>

      {state.kind === "polling" && (
        <div className="relative mt-6 flex items-center justify-center gap-3 text-sm text-on-surface-variant">
          <Spinner />
          <span>
            {FRIENDLY_STATUS[state.job.status]}…{" "}
            <span className="font-mono text-xs opacity-70">
              job {state.job.job_id.slice(0, 8)}
            </span>
          </span>
        </div>
      )}

      {state.kind === "done" && state.job.download_url && (
        <div className="relative mt-6 flex flex-col items-center gap-3">
          <span className="text-sm text-on-surface-variant">
            Your guide is ready.
          </span>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="bg-primary text-on-primary px-6 py-3 rounded-xl font-semibold hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-95 transition-all disabled:opacity-60"
            >
              {downloading ? "Downloading…" : "Download Guide"}
            </button>
            <Link
              href="/history"
              className="border border-black/10 text-on-surface px-6 py-3 rounded-xl font-semibold hover:bg-black/5 transition-colors"
            >
              View history
            </Link>
            <button
              type="button"
              onClick={reset}
              className="text-on-surface-variant hover:text-on-surface px-3 py-3 text-sm font-semibold transition-colors"
            >
              Process another
            </button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="relative mt-6 flex flex-col items-center gap-3">
          <span className="text-sm text-error">{state.message}</span>
          <button
            type="button"
            onClick={reset}
            className="border border-black/10 text-on-surface px-6 py-3 rounded-xl font-semibold hover:bg-black/5 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-4 md:gap-6">
        <BadgeItem>4K Extraction</BadgeItem>
        <BadgeItem>Markdown Ready</BadgeItem>
        <BadgeItem>Multi-language support</BadgeItem>
      </div>
    </div>
  );
}

function BadgeItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-on-surface-variant font-mono text-xs tracking-wider">
      <CheckCircleIcon className="w-4 h-4" />
      <span>{children}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-primary"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
