"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { useAuth } from "../lib/auth-context";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("from") || "/";
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to keep working on your installation guides."
      footer={null}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
          disabled={loading}
          placeholder="you@company.com"
        />

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label
              htmlFor="password"
              className="text-sm font-semibold text-on-surface"
            >
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
          />
        </div>

        {error && (
          <div className="rounded-xl bg-error/10 border border-error/30 text-error text-sm px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-primary text-on-primary px-6 py-3.5 rounded-xl font-semibold hover:shadow-[0_0_20px_rgba(163,0,1,0.5)] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}

function Field({
  id,
  label,
  type,
  required,
  disabled,
  value,
  onChange,
  placeholder,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-on-surface mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
      />
      {hint && (
        <p className="mt-1.5 text-xs text-on-surface-variant">{hint}</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
