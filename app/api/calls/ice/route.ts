import { NextResponse } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { serverEnv } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ICE servers a browser should use to find its way to the other browser.
 *
 * Behind auth and served rather than inlined as a `NEXT_PUBLIC_` variable, because
 * TURN credentials are credentials: baked into the client bundle they would be a relay
 * anyone could bill traffic to. Signed in and short-lived in memory is the weakest
 * form this can take and still work.
 *
 * The STUN entry is the public Google one, which only ever answers "here is how the
 * internet sees you" and needs no account.
 */
const STUN = "stun:stun.l.google.com:19302";

interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Sign in first.", 401);

    const iceServers: IceServer[] = [{ urls: STUN }];
    const turn = serverEnv.turn;
    if (turn) {
      iceServers.push({
        urls: turn.url,
        ...(turn.username ? { username: turn.username } : {}),
        ...(turn.credential ? { credential: turn.credential } : {}),
      });
    }

    return NextResponse.json(
      { iceServers },
      // Private, and not cached anywhere in between: these are per-account
      // credentials even when they happen to be shared ones today.
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
