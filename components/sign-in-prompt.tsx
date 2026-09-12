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
  const [mode, setMode] = useState<"pick" | "email">("pick");
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
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={size === "xs" ? "text-xs text-faint" : "text-sm text-muted"}>
          {children}
        </p>

        {mode === "pick" ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="flex h-8 items-center gap-2 rounded-ctl bg-accent px-3 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
              Google
            </button>
            <button
              type="button"
              onClick={() => setMode("email")}
              className="flex h-8 items-center rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              Email
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-end gap-2">
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
            <button
              type="button"
              onClick={() => { setMode("pick"); setError(null); }}
              className="text-[11px] text-faint hover:text-muted"
            >
              Back
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
