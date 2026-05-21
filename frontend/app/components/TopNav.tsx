"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../lib/auth-context";
import { BrandMark } from "./BrandMark";

export function TopNav() {
  const { user, ready, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClass = (href: string) =>
    `text-base transition-colors ${
      pathname === href
        ? "text-primary font-semibold border-b-2 border-primary pb-1"
        : "text-on-surface-variant hover:text-on-surface"
    }`;

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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold text-sm">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="text-sm text-on-surface-variant max-w-[140px] truncate">
                  {user.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.push("/");
                }}
                className="border border-black/10 text-on-surface px-4 py-2 rounded-lg text-sm font-semibold hover:bg-black/5 transition-colors"
              >
                Log out
              </button>
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
                Log out ({user.email})
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
