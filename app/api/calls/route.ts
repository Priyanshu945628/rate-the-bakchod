import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  acceptCall,
  declineCall,
  endCall,
  relaySignal,
  startCall,
} from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every stage of a call, on one endpoint, dispatched on `phase`.
 *
 * One route rather than five because they are one conversation between two browsers
 * and this server is only the wire between them — splitting it up would spread a
 * single state machine across five files that all have to agree.
 *
 * Only `invite` is metered. The rest is SDP and ICE, and a single answered call is
 * dozens of those; a budget a normal call can exhaust is a budget that breaks calling.
 */
const PHASES = ["invite", "accept", "decline", "end", "signal"] as const;
type Phase = (typeof PHASES)[number];

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  let body: {
    phase?: unknown;
    conversationId?: unknown;
    callId?: unknown;
    kind?: unknown;
    signal?: unknown;
  };
  try {
    body = (await readJsonBody(request)) as typeof body;
  } catch (err) {
    return handleRouteError(err);
  }

  if (!isPhase(body.phase)) return jsonError("Unknown call phase.", 400);

  // The invite spends from the `call` bucket; everything after it is the same call
  // finding its way through, and is authenticated but not counted.
  if (body.phase === "invite") {
    const auth = await authorizeWrite("call");
    if ("response" in auth) return auth.response;

    try {
      if (typeof body.conversationId !== "string" || body.conversationId.length === 0) {
        return jsonError("Which conversation?", 400);
      }
      if (body.kind !== "VOICE" && body.kind !== "VIDEO") {
        return jsonError("Voice or video?", 400);
      }

      const call = await startCall(auth.user, body.conversationId, body.kind);
      return NextResponse.json(call, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      return handleRouteError(err);
    }
  }

  try {
    const user = await requireUser();
    if (typeof body.callId !== "string" || body.callId.length === 0) {
      return jsonError("Which call?", 400);
    }

    switch (body.phase) {
      case "accept":
        await acceptCall(user, body.callId);
        break;
      case "decline":
        await declineCall(user, body.callId);
        break;
      case "end":
        await endCall(user, body.callId);
        break;
      case "signal":
        if (body.signal === undefined || body.signal === null) {
          return jsonError("Nothing to relay.", 400);
        }
        await relaySignal(user, body.callId, body.signal);
        break;
    }

    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
