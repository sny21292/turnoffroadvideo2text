"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { useAuth } from "../lib/auth-context";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await register(name, email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Get a personal history of every guide you generate."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-semibold text-on-surface mb-1.5"
          >
            Full name
          </label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            disabled={loading}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-on-surface mb-1.5"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            disabled={loading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
          />
        </div>

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
            required
            minLength={6}
            autoComplete="new-password"
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary focus:outline-none transition-all disabled:opacity-60"
          />
          <p className="mt-1.5 text-xs text-on-surface-variant">
            Use a strong password — at least 6 characters.
          </p>
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
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-xs text-on-surface-variant text-center">
          By creating an account, you agree to our Terms of Service and Privacy
          Policy.
        </p>
      </form>
    </AuthShell>
  );
}
