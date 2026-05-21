"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { BrandMark } from "./BrandMark";

export function TopNav() {
  const { user, ready, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (
        accountRef.current &&
        !accountRef.current.contains(e.target as Node)
      ) {
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const linkClass = (href: string) =>
    `text-base transition-colors ${
      pathname === href
        ? "text-primary font-semibold border-b-2 border-primary pb-1"
        : "text-on-surface-variant hover:text-on-surface"
    }`;

  function handleLogout() {
    setAccountOpen(false);
    logout();
    router.push("/");
  }

  return (
    <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-xl border-b border-black/10 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center px-4 md:px-10 py-4 max-w-[1200px] mx-auto">
        <Link href="/" className="flex items-center" aria-label="Home">
          <BrandMark variant="nav" />
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link href="/" className={linkClass("/")}>
            Generator
          </Link>
          {user && (
            <Link href="/history" className={linkClass("/history")}>
              History
            </Link>
          )}
          {ready && !user && (
            <Link
              href="/login"
              className="bg-primary text-on-primary px-4 py-2 rounded-lg font-semibold hover:shadow-[0_0_18px_rgba(163,0,1,0.45)] transition-all"
            >
              Log in
            </Link>
          )}
          {ready && user && (
            <div ref={accountRef} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((v) => !v)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-black/5 transition-colors select-none"
              >
                <span
                  aria-hidden
                  className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold text-sm shadow-[0_2px_8px_rgba(163,0,1,0.25)]"
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <svg
                  aria-hidden
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-4 h-4 text-on-surface-variant transition-transform ${
                    accountOpen ? "rotate-180" : ""
                  }`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {accountOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-64 glass-card rounded-2xl shadow-[0_12px_32px_-8px_rgba(0,0,0,0.18)] overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-black/5 select-none">
                    <div className="text-sm font-semibold text-on-surface truncate">
                      {user.name}
                    </div>
                    <div className="text-xs text-on-surface-variant truncate">
                      {user.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-black/5 transition-colors flex items-center gap-2"
                  >
                    <svg
                      aria-hidden
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 text-on-surface-variant"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden p-2 rounded-lg border border-black/10 text-on-surface"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            {menuOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-black/10 bg-background">
          <div className="flex flex-col gap-1 px-4 py-3 max-w-[1200px] mx-auto">
            {ready && user && (
              <div className="flex items-center gap-3 px-3 py-3 mb-1 border-b border-black/5">
                <span className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold text-sm">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-on-surface truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-on-surface-variant truncate">
                    {user.email}
                  </div>
                </div>
              </div>
            )}
            <Link
              href="/"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-black/5 text-on-surface"
            >
              Generator
            </Link>
            {user && (
              <Link
                href="/history"
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-black/5 text-on-surface"
              >
                History
              </Link>
            )}
            {ready && !user && (
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2 rounded-lg bg-primary text-on-primary text-center font-semibold"
              >
                Log in
              </Link>
            )}
            {ready && user && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                  router.push("/");
                }}
                className="px-3 py-2 rounded-lg text-left hover:bg-black/5 text-on-surface"
              >
                Log out
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
