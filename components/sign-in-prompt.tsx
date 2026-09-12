"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signInWithEmail, startGoogleSignIn } from "@/lib/sign-in";
import { SpinnerIcon } from "./icons";

export function SignInPrompt({
  children,
  size = "sm",
  className = "",
}: {
  children: React.ReactNode;
  size?: "sm" | "xs";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  async function start() {
    setBusy(true);
    setError(null);
    const message = await startGoogleSignIn(pathname);
    if (message) {
      setError(message);
      setBusy(false);
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
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={size === "xs" ? "text-xs text-faint" : "text-sm text-muted"}>
          {children}
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="flex h-8 shrink-0 items-center gap-2 rounded-ctl bg-accent px-3 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
          Sign in with Google
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowEmail(!showEmail)}
        className="text-[11px] text-faint hover:text-muted"
      >
        or use email
      </button>

      {showEmail && (
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="h-8 w-40 rounded-ctl border border-line bg-panel-2 px-2 text-xs text-ink placeholder:text-faint"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && void handleEmailSignIn()}
            className="h-8 w-36 rounded-ctl border border-line bg-panel-2 px-2 text-xs text-ink placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void handleEmailSignIn()}
            disabled={busy || !email.trim() || !password}
            className="flex h-8 items-center gap-1.5 rounded-ctl bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="h-3 w-3 animate-spin" />}
            Sign in
          </button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
