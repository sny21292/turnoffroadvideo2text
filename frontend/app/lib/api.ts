export const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export type ApiUser = { id: number; name: string; email: string };

export type RqStatus =
  | "queued"
  | "started"
  | "deferred"
  | "scheduled"
  | "finished"
  | "failed"
  | "canceled"
  | "stopped";

export type JobResponse = {
  job_id: string;
  url: string;
  status: RqStatus;
  download_url: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

const TOKEN_KEY = "v2t.token";
const USER_KEY = "v2t.user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): ApiUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: ApiUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("v2t:auth-change"));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("v2t:auth-change"));
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new Error(await parseError(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string) {
  const data = await apiFetch<{ token: string; user: ApiUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveSession(data.token, data.user);
  return data.user;
}

export function logout() {
  clearSession();
}

export async function submitJob(url: string): Promise<JobResponse> {
  return apiFetch<JobResponse>("/jobs", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function getJob(id: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/jobs/${id}`);
}

export async function listJobs(): Promise<JobResponse[]> {
  const data = await apiFetch<{ jobs: JobResponse[] }>("/jobs");
  return data.jobs;
}

export async function deleteJob(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/jobs/${id}`, { method: "DELETE" });
}

export function downloadUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // Match: filename="something.docx" OR filename=something.docx (with optional UTF-8 form)
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1].trim());
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

export async function downloadJob(job: JobResponse): Promise<void> {
  if (!job.download_url) throw new Error("Job is not ready yet.");
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${job.download_url}`, { headers });
  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new Error(await parseError(res));
  }
  // Prefer the server's Content-Disposition filename so we always serve the
  // correct extension (.docx for new jobs, .pdf for legacy ones). Fall back to
  // a sensible default if the header is missing.
  const serverName = filenameFromContentDisposition(res.headers.get("Content-Disposition"));
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = serverName || `installation-guide-${job.job_id.slice(0, 8)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}
