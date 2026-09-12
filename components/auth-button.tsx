"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signInWithEmail, startGoogleSignIn } from "@/lib/sign-in";
import type { ClientViewer } from "@/lib/types";
import { Avatar } from "./avatar";
import { SpinnerIcon } from "./icons";

export function AuthButton({ viewer }: { viewer: ClientViewer | null }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pick" | "email">("pick");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("pick");
        setError(null);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function signIn() {
    setBusy(true);
    const message = await startGoogleSignIn(pathname);
    if (message) {
      setBusy(false);
      alert(message);
    }
  }

  async function handleEmailSignIn() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const message = await signInWithEmail(email, password);
    if (message) {
      setError(message);
      setBusy(false);
    } else {
      setOpen(false);
      router.refresh();
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.refresh();
    setBusy(false);
  }

  if (!viewer) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={busy}
          className="flex h-10 items-center gap-2 rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
          Sign in
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-card border border-line bg-panel p-3 shadow-pop">
            {mode === "pick" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={signIn}
                  disabled={busy}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-ctl bg-accent text-sm font-semibold text-accent-ink disabled:opacity-50"
                >
                  {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                  Sign in with Google
                </button>
                <button
                  type="button"
                  onClick={() => setMode("email")}
                  className="flex h-10 w-full items-center justify-center rounded-ctl border border-line text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  Sign in with email
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className="h-9 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && void handleEmailSignIn()}
                  className="h-9 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => void handleEmailSignIn()}
                  disabled={busy || !email.trim() || !password}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-ctl bg-accent text-xs font-semibold text-accent-ink disabled:opacity-50"
                >
                  {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("pick"); setError(null); }}
                  className="w-full text-center text-[11px] text-faint hover:text-muted"
                >
                  Back
                </button>
                {error && <p className="text-xs text-danger">{error}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/u/${encodeURIComponent(viewer.handle)}`}
        className="flex items-center gap-3 rounded-ctl transition-opacity hover:opacity-80"
      >
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium text-ink">{viewer.displayName}</div>
          <div className="text-xs text-faint">@{viewer.handle}</div>
        </div>
        <Avatar src={viewer.avatarUrl} name={viewer.displayName} size={36} />
      </Link>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="h-9 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
