"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../avatar";
import {
  CameraOffIcon,
  FlipCameraIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  VideoIcon,
} from "../icons";
import { useCall } from "./call-provider";

/**
 * The call itself: the whole screen, on every size.
 *
 * Full-bleed rather than a panel in the middle of a scrim, for the same reason a
 * phone's own dialler is: a call is the only thing you are doing while it is
 * happening, and a 560px box on a 390px screen spends most of its width on borders
 * while the person you are talking to gets a thumbnail. The remote picture is the
 * background; everything else floats over it and can be tapped through to nothing.
 *
 * `h-dvh` rather than `inset-0`, deliberately. A fixed element pinned to all four
 * edges is sized against the *layout* viewport, which on mobile Safari and Chrome
 * extends underneath the address bar — so the hang-up button ends up behind browser
 * chrome exactly when somebody needs it. The dynamic unit tracks the toolbars, and
 * `env(safe-area-inset-*)` keeps the bars off the notch and the home indicator.
 *
 * Both `<video>` elements take their stream through a ref, because `srcObject` is not
 * an attribute and React will not set it from a prop. The local one is always muted —
 * it is the same microphone the room already contains, and unmuted it is a feedback
 * loop.
 *
 * A *callback* ref, and that distinction is the whole reason their picture used to be
 * a black rectangle. The remote element is only mounted once the call is live (see
 * `showRemote`), which is well after the remote stream reaches state — so an effect
 * keyed on the stream ran while the element did not exist yet, and never ran again,
 * because the stream's identity had not changed. A callback ref fires on both edges:
 * when the element mounts, and whenever the stream it is being handed changes.
 */

function useMediaRef(stream: MediaStream | null) {
  return useCallback(
    (node: HTMLMediaElement | null) => {
      if (!node) return;
      if (node.srcObject !== stream) node.srcObject = stream;
      // `autoplay` starts an element that already has a source when it mounts, but
      // one whose source is swapped afterwards can be left paused. Asking costs
      // nothing, and a rejection here only means autoplay was refused.
      if (stream) void node.play().catch(() => {});
    },
    [stream],
  );
}

/** Seconds since the call connected. Its own ticker: 30s resolution is not a timer. */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * One round control.
 *
 * `on` is the *engaged* state — muted, camera off, speaker off — and inverts the fill
 * rather than tinting it, because a red mute button and a red hang-up button next to
 * each other is how people end calls by accident.
 */
function Control({
  label,
  on = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const skin = danger
    ? "bg-danger text-white"
    : on
      ? "bg-accent text-accent-ink"
      : "bg-white/10 text-ink hover:bg-white/15";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={danger ? undefined : on}
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-pill transition-colors ${skin}`}
    >
      {children}
    </button>
  );
}

export function CallWindow() {
  const { call, local, remote, hangUp, toggleMute, toggleCamera, switchCamera, cameras } =
    useCall();
  const [speakerOff, setSpeakerOff] = useState(false);
  const live = call?.status === "live";
  const reconnecting = call?.status === "reconnecting";
  const elapsed = useElapsed(live || reconnecting);
  const remoteVideo = useMediaRef(remote);
  const localVideo = useMediaRef(local);
  const remoteAudio = useMediaRef(remote);

  if (!call || call.status === "incoming") return null;

  const video = call.kind === "VIDEO";
  /**
   * Their picture is only worth showing once there is one.
   *
   * The stream is part of the condition rather than assumed from the status: a black
   * rectangle where a face should be reads as a broken call, while the avatar stage
   * with the timer running reads as a call whose picture has not arrived — which is
   * what it is.
   */
  const showRemote = video && remote !== null && (live || reconnecting);

  const status = live
    ? clock(elapsed)
    : reconnecting
      ? "Reconnecting…"
      : call.status === "connecting"
        ? "Connecting…"
        : call.status === "ringing"
          ? "Ringing…"
          : "Calling…";

  /**
   * Online or offline, and only while it is still the answer to a question.
   *
   * Once a call connects, presence is answered by the call. Before that it is the
   * difference between waiting for someone who can hear it and waiting for nobody.
   */
  const presence =
    call.outgoing && (call.status === "calling" || call.status === "ringing")
      ? call.peer.online === false
        ? "Offline"
        : "Online"
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${video ? "Video" : "Voice"} call with ${call.peer.displayName}`}
      className="fixed inset-x-0 top-0 z-[70] flex h-dvh flex-col overflow-hidden bg-bg"
    >
      <div className="relative min-h-0 flex-1">
        {showRemote ? (
          // `object-contain`, so a frame that is not the shape of this screen gets bars
          // rather than a haircut. The sender is asked for a picture the right way up
          // (see `videoConstraints`), but nothing stops the other end being a laptop,
          // or a phone being turned over mid-call, and the failure mode of `cover` in
          // that moment is a face cropped to its nose.
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            muted={speakerOff}
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-panel px-6 text-center">
              <span className="relative flex items-center justify-center">
                {!live && !reconnecting ? (
                  <span className="absolute inset-[-10px] rounded-pill border border-line-strong motion-safe:animate-ping" />
                ) : null}
                <Avatar src={call.peer.avatarUrl} name={call.peer.displayName} size={128} />
              </span>
              <span className="block max-w-full truncate text-[19px] font-semibold text-ink">
                {call.peer.displayName}
              </span>
              <span className="flex items-center gap-2 text-[13.5px] tabular-nums text-muted">
                {video ? (
                  <VideoIcon className="h-4 w-4" />
                ) : (
                  <PhoneIcon className="h-4 w-4" />
                )}
                {status}
                {presence ? (
                  <>
                    <span aria-hidden>·</span>
                    {presence}
                  </>
                ) : null}
              </span>
            </div>
            {/* Whenever the picture is not on screen — a voice call, or a video call
                whose stream has not arrived yet. Their audio has to come out of
                something, and on a video call the `<video>` above is that something. */}
            <audio ref={remoteAudio} autoPlay muted={speakerOff} />
          </>
        )}

        {/*
          The header only earns its place over a live picture — under the avatar
          stage the same three facts are already the middle of the screen.
        */}
        {showRemote ? (
          <div className="glass-bar absolute inset-x-0 top-0 flex items-center gap-3 border-x-0 border-t-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Avatar src={call.peer.avatarUrl} name={call.peer.displayName} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink">
                {call.peer.displayName}
              </span>
              <span className="block text-[12px] tabular-nums text-muted">{status}</span>
            </span>
          </div>
        ) : null}

        {/*
          Local preview, mirrored the way every camera app mirrors it — an unmirrored
          self-view is the one thing people reliably read as broken. Portrait tile on
          a phone, landscape on a desktop, because that is the shape each camera
          actually produces.
        */}
        {video && local ? (
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className={`absolute bottom-3 right-3 h-[124px] w-[92px] scale-x-[-1] rounded-ctl border border-line-strong bg-panel object-cover lg:h-[132px] lg:w-[196px] ${
              call.cameraOff ? "opacity-0" : ""
            }`}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-line bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:gap-4">
        <Control label={call.muted ? "Unmute" : "Mute"} on={call.muted} onClick={toggleMute}>
          {call.muted ? <MicOffIcon className="h-6 w-6" /> : <MicIcon className="h-6 w-6" />}
        </Control>

        <Control
          label={speakerOff ? "Turn sound on" : "Turn sound off"}
          on={speakerOff}
          onClick={() => setSpeakerOff((s) => !s)}
        >
          {speakerOff ? (
            <SpeakerOffIcon className="h-6 w-6" />
          ) : (
            <SpeakerIcon className="h-6 w-6" />
          )}
        </Control>

        {video ? (
          <Control
            label={call.cameraOff ? "Turn camera on" : "Turn camera off"}
            on={call.cameraOff}
            onClick={toggleCamera}
          >
            {call.cameraOff ? (
              <CameraOffIcon className="h-6 w-6" />
            ) : (
              <VideoIcon className="h-6 w-6" />
            )}
          </Control>
        ) : null}

        {/* Only when there is somewhere to switch to. */}
        {video && cameras > 1 ? (
          <Control label="Switch camera" onClick={switchCamera}>
            <FlipCameraIcon className="h-6 w-6" />
          </Control>
        ) : null}

        <Control label="Hang up" danger onClick={hangUp}>
          <HangUpIcon className="h-6 w-6" />
        </Control>
      </div>
    </div>
  );
}
