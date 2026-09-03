import Link from "next/link";
import { AuthButton } from "@/components/auth-button";

/**
 * Where `/auth/callback` sends a sign-in that did not complete.
 *
 * The two failure modes have different fixes, so the callback passes a reason
 * and this page names the setting to go and check. No values from the session or
 * the provider are echoed here — only the fixed strings below.
 */

const REASONS: Record<string, string> = {
  no_code:
    "Google sent you back without an authorisation code. That usually means the redirect URL is not on the allow-list — in Supabase, Authentication → URL Configuration, it must contain your site origin with /auth/callback appended.",
  exchange:
    "The code came back but could not be exchanged for a session. Check that Google is enabled under Authentication → Providers in Supabase, and that the Site URL there matches the origin you are browsing from.",
};

export default async function AuthErrorPage(props: PageProps<"/auth/error">) {
  const { reason } = await props.searchParams;
  const key = Array.isArray(reason) ? reason[0] : reason;
  const detail =
    (key && REASONS[key]) ??
    "Something broke between Google and Supabase on the way back.";

  return (
    <div className="mx-auto w-full max-w-[560px] pt-6">
      <section className="panel px-5 py-6 shadow-card">
        <h1 className="text-lg font-bold text-ink">Sign-in did not finish</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
        <p className="mt-3 text-xs text-faint">Nothing was saved.</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <AuthButton viewer={null} />
          <Link
            href="/"
            className="flex h-10 items-center rounded-ctl border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Back to the feed
          </Link>
        </div>
      </section>
    </div>
  );
}
