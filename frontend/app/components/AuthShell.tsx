import Link from "next/link";
import { AutoAwesomeIcon, CheckCircleIcon } from "./icons";

export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="pt-24 md:pt-28 pb-12 px-4 md:px-8 max-w-[1200px] mx-auto w-full flex-1 flex items-stretch">
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-stretch">
        <section className="hidden lg:flex relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[#5a0001] text-on-primary p-12 flex-col justify-between">
          <div className="absolute inset-0 opacity-30 mix-blend-overlay bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.4),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(173,198,255,0.5),transparent_55%)]" />
          <svg
            aria-hidden="true"
            className="absolute inset-0 w-full h-full opacity-20"
            viewBox="0 0 600 600"
            preserveAspectRatio="none"
          >
            <defs>
              <pattern
                id="grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          <div className="relative">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-xs font-mono tracking-widest uppercase">
              <AutoAwesomeIcon className="w-4 h-4" />
              Video2Text
            </span>
            <h2 className="mt-10 text-4xl font-bold leading-tight tracking-tight">
              Turn every install video into a finished guide.
            </h2>
            <p className="mt-4 text-white/85 max-w-md">
              Drop a YouTube link — our AI watches it, captures the right
              frames, and writes a clean, branded PDF for your team.
            </p>
          </div>

          <ul className="relative space-y-3 mt-10">
            {[
              "Step-by-step PDFs with screenshots",
              "Personal history of every video you've processed",
              "Re-download any guide whenever you need it",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-white/90">
                <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                <span className="text-sm leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>

          <div className="relative mt-8 text-xs font-mono uppercase tracking-widest text-white/70">
            Secure · Encrypted · Yours
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full glass-card rounded-3xl p-6 sm:p-10 ai-glow">
            <Link
              href="/"
              className="text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors"
            >
              ← Back to home
            </Link>
            <h1 className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight">
              {title}
            </h1>
            <p className="mt-2 text-on-surface-variant">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <div className="mt-8 pt-6 border-t border-black/5 text-sm text-on-surface-variant text-center">
              {footer}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
