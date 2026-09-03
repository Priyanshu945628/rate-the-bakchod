"use client";

import { HangUpIcon, PhoneIcon, VideoIcon } from "../icons";
import { Avatar } from "../avatar";
import { useCall } from "./call-provider";
import { RINGTONE, useCallTone } from "./tones";

/**
 * Somebody is ringing.
 *
 * A full-screen sheet rather than a corner toast, deliberately: a call is the one thing
 * in this app that expires if it is ignored, and a notification that can be missed by
 * looking at the wrong half of the screen is the wrong shape for it.
 *
 * The ring itself lives in `./tones` alongside the caller's ringback, so the two
 * sounds are defined next to each other and cannot drift into being the same one.
 */

export function IncomingCall() {
  const { call, accept, hangUp } = useCall();
  const ringing = call?.status === "incoming";
  useCallTone(ringing ? RINGTONE : null);

  if (!call || call.status !== "incoming") return null;

  const Kind = call.kind === "VIDEO" ? VideoIcon : PhoneIcon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming ${call.kind === "VIDEO" ? "video" : "voice"} call`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="panel w-full max-w-[320px] px-5 py-6 text-center">
        <span className="relative mx-auto flex h-[92px] w-[92px] items-center justify-center">
          <span className="absolute inset-0 rounded-pill border border-line-strong motion-safe:animate-ping" />
          <Avatar src={call.peer.avatarUrl} name={call.peer.displayName} size={84} />
        </span>

        <p className="mt-4 truncate text-[15px] font-semibold text-ink">
          {call.peer.displayName}
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[12.5px] text-muted">
          <Kind className="h-3.5 w-3.5" />
          {call.kind === "VIDEO" ? "Video call" : "Voice call"}
        </p>

        <div className="mt-6 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={hangUp}
            aria-label="Decline"
            className="flex h-14 w-14 items-center justify-center rounded-pill bg-danger text-white transition-opacity hover:opacity-90"
          >
            <HangUpIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={accept}
            aria-label="Answer"
            className="flex h-14 w-14 items-center justify-center rounded-pill bg-accent text-accent-ink transition-opacity hover:opacity-90"
          >
            <PhoneIcon className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
