"use client";

import { useEffect } from "react";
import { HangUpIcon, PhoneIcon, VideoIcon } from "../icons";
import { Avatar } from "../avatar";
import { useCall } from "./call-provider";

/**
 * Somebody is ringing.
 *
 * A full-screen sheet rather than a corner toast, deliberately: a call is the one thing
 * in this app that expires if it is ignored, and a notification that can be missed by
 * looking at the wrong half of the screen is the wrong shape for it.
 *
 * The ring is synthesised rather than loaded. Two oscillators through a gain envelope
 * is a few dozen lines and no asset, no cache, no format negotiation — and it can be
 * stopped exactly, which an `<audio loop>` that has already started buffering cannot.
 * Browsers will not start an `AudioContext` without a gesture; when they refuse, the
 * panel is simply silent, which is why the visual is not decoration.
 */

/** The two tones of a UK-ish double ring, and the pattern that makes it a ring. */
const TONES = [420, 320];
const PULSE_MS = 400;
const GAP_MS = 200;
const CYCLE_MS = 3200;

function useRingtone(playing: boolean): void {
  useEffect(() => {
    if (!playing || typeof window.AudioContext !== "function") return;

    const ctx = new window.AudioContext();
    let stopped = false;

    const pulse = (at: number) => {
      // A gain envelope per pulse, not a global mute: an oscillator started and stopped
      // on a bare gain of 1 clicks audibly at both ends.
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.09, at + 0.02);
      gain.gain.setValueAtTime(0.09, at + PULSE_MS / 1000 - 0.03);
      gain.gain.linearRampToValueAtTime(0, at + PULSE_MS / 1000);
      gain.connect(ctx.destination);

      for (const hz of TONES) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = hz;
        osc.connect(gain);
        osc.start(at);
        osc.stop(at + PULSE_MS / 1000);
      }
    };

    const cycle = () => {
      if (stopped) return;
      pulse(ctx.currentTime);
      pulse(ctx.currentTime + (PULSE_MS + GAP_MS) / 1000);
    };

    void ctx.resume().catch(() => {});
    cycle();
    const timer = setInterval(cycle, CYCLE_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      void ctx.close().catch(() => {});
    };
  }, [playing]);
}

export function IncomingCall() {
  const { call, accept, hangUp } = useCall();
  useRingtone(call?.status === "incoming");

  if (!call || call.status !== "incoming") return null;

  const Kind = call.kind === "VIDEO" ? VideoIcon : PhoneIcon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming ${call.kind === "VIDEO" ? "video" : "voice"} call`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
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

        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={hangUp}
            aria-label="Decline"
            className="flex h-12 w-12 items-center justify-center rounded-pill bg-danger text-white transition-opacity hover:opacity-90"
          >
            <HangUpIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={accept}
            aria-label="Answer"
            className="flex h-12 w-12 items-center justify-center rounded-pill bg-accent text-accent-ink transition-opacity hover:opacity-90"
          >
            <PhoneIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
