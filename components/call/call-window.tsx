"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "../avatar";
import { CameraOffIcon, HangUpIcon, MicIcon, MicOffIcon, VideoIcon } from "../icons";
import { useCall } from "./call-provider";

/**
 * The call itself.
 *
 * A fixed sheet over everything rather than a panel in the page: a call outlives the
 * route it was started from, and the person on the other end should not vanish because
 * somebody tapped a profile link.
 *
 * Both `<video>` elements take their stream through a ref, because `srcObject` is not
 * an attribute and React will not set it from a prop. The local one is muted — it is
 * the same microphone the room already contains, and unmuted it is a feedback loop.
 */

function useMediaRef<T extends HTMLMediaElement>(stream: MediaStream | null) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return ref;
}

/** Seconds since the call connected. Its own ticker: 30s resolution is not a timer. */
function useElapsed(live: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return seconds;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CallWindow() {
  const { call, local, remote, hangUp, toggleMute, toggleCamera } = useCall();
  const live = call?.status === "live";
  const elapsed = useElapsed(live);
  const remoteVideo = useMediaRef<HTMLVideoElement>(remote);
  const localVideo = useMediaRef<HTMLVideoElement>(local);
  const remoteAudio = useMediaRef<HTMLAudioElement>(remote);

  if (!call || call.status === "incoming") return null;

  const video = call.kind === "VIDEO";
  const status = live ? clock(elapsed) : call.status === "ringing" ? "Ringing…" : "Connecting…";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${video ? "Video" : "Voice"} call with ${call.peer.displayName}`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
    >
      <div className="panel flex w-full max-w-[560px] flex-col overflow-hidden">
        <div className="relative flex aspect-[4/3] items-center justify-center bg-panel-3">
          {video ? (
            <>
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className={`h-full w-full object-cover ${live ? "" : "opacity-0"}`}
              />
              {!live ? (
                <span className="absolute">
                  <Avatar src={call.peer.avatarUrl} name={call.peer.displayName} size={96} />
                </span>
              ) : null}
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                className="absolute bottom-3 right-3 h-[84px] w-[112px] rounded-ctl border border-line-strong bg-panel object-cover"
              />
            </>
          ) : (
            <>
              <Avatar src={call.peer.avatarUrl} name={call.peer.displayName} size={112} />
              <audio ref={remoteAudio} autoPlay />
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-ink">
              {call.peer.displayName}
            </span>
            <span className="block text-[12px] tabular-nums text-muted">{status}</span>
          </span>

          <button
            type="button"
            onClick={toggleMute}
            aria-label={call.muted ? "Unmute" : "Mute"}
            aria-pressed={call.muted}
            className="flex h-10 w-10 items-center justify-center rounded-pill border border-line-strong text-muted transition-colors hover:text-ink"
          >
            {call.muted ? <MicOffIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
          </button>

          {video ? (
            <button
              type="button"
              onClick={toggleCamera}
              aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"}
              aria-pressed={call.cameraOff}
              className="flex h-10 w-10 items-center justify-center rounded-pill border border-line-strong text-muted transition-colors hover:text-ink"
            >
              {call.cameraOff ? (
                <CameraOffIcon className="h-5 w-5" />
              ) : (
                <VideoIcon className="h-5 w-5" />
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={hangUp}
            aria-label="Hang up"
            className="flex h-10 w-10 items-center justify-center rounded-pill bg-danger text-white transition-opacity hover:opacity-90"
          >
            <HangUpIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
