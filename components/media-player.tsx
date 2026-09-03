"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExpandIcon,
  PauseIcon,
  PlayIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "./icons";

/**
 * The app's video and audio player. Nothing on the site uses the `controls`
 * attribute any more.
 *
 * Native controls are the one part of a page a stylesheet cannot reach: every
 * browser draws a different bar, in its own colours, at its own size, and on a
 * dark surface Chrome's and Safari's look like two different products stacked in
 * the same feed. This replaces them with the app's own buttons.
 *
 * Two variants:
 *
 *   - `feed` — the whole bar: play/pause, scrub, elapsed and total, mute, and
 *     fullscreen on video. Used in posts.
 *   - `story` — mute only, bottom-right. A story already has its segment bars for
 *     progress and taps for navigation; a second set of controls would fight them.
 *
 * **The scrubber is three divs and an invisible range**, not the usual
 * `linear-gradient` track fill: a track, a fill sized in percent, a thumb, and an
 * `opacity-0` `<input type="range">` laid over the lot to keep dragging, clicking
 * and arrow keys behaving exactly as people expect. The gradient trick would put
 * the first gradient in the app's CSS, and there aren't any.
 *
 * Keys, when the frame itself has focus: Space or K to play, ← → to jump five
 * seconds, M to mute, F for fullscreen.
 */

type Media = HTMLVideoElement | HTMLAudioElement;

export function MediaPlayer({
  src,
  kind,
  poster,
  aspectRatio,
  variant = "feed",
  autoPlay = false,
  startMuted = false,
  maxHeight = "70vh",
  paused,
  onEnded,
  className,
}: {
  src: string;
  kind: "VIDEO" | "AUDIO";
  poster?: string | null;
  /** CSS `aspect-ratio` for the video frame. Ignored for audio. */
  aspectRatio?: string;
  variant?: "feed" | "story";
  autoPlay?: boolean;
  startMuted?: boolean;
  /** Cap on the video frame, as a CSS length. Ignored for audio and stories. */
  maxHeight?: string;
  /**
   * Play state driven from outside — the story viewer's hold-to-pause. Leave it
   * undefined and the player is the only thing that decides.
   */
  paused?: boolean;
  onEnded?: () => void;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const media = useRef<Media | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(startMuted);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [full, setFull] = useState(false);

  const isVideo = kind === "VIDEO";
  const isStory = variant === "story";
  // Story chrome sits on the viewer's black backdrop and video controls sit on the
  // black letterbox, so both are light regardless of palette. Only the audio card
  // in a post is on a themed surface.
  const onDark = isVideo || isStory;

  // Read once. `muted` is deliberately not a React prop below: the button writes
  // the property directly, and a controlled `muted` would put React and the button
  // in a fight over it on every render.
  const initialMuted = useRef(startMuted);

  const attach = useCallback((el: Media | null) => {
    media.current = el;
    if (!el) return;
    el.muted = initialMuted.current;
    // A cached file can have its metadata before React has attached a listener,
    // and then the duration would read 0:00 until the first tick.
    if (Number.isFinite(el.duration)) setDuration(el.duration);
    setMuted(el.muted);
    setPlaying(!el.paused);
  }, []);

  useEffect(() => {
    const el = media.current;
    if (!el || paused === undefined) return;
    if (paused) el.pause();
    // A refused play() is ordinary — autoplay policies, a backgrounded tab. The
    // button is right there.
    else void el.play().catch(() => {});
  }, [paused]);

  useEffect(() => {
    function sync() {
      setFull(document.fullscreenElement === frame.current);
    }
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggle() {
    const el = media.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  function toggleMute() {
    const el = media.current;
    if (!el) return;
    // Set the property, not the state: `volumechange` is what tells us it took.
    el.muted = !el.muted;
  }

  function seekTo(next: number) {
    const el = media.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const clamped = Math.min(Math.max(next, 0), el.duration);
    el.currentTime = clamped;
    setTime(clamped);
  }

  async function toggleFullscreen() {
    const box = frame.current;
    if (!box) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await box.requestFullscreen();
    } catch {
      // iOS Safari refuses fullscreen on anything but the video element itself.
      // Nothing useful to say about it.
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Only when the frame itself holds focus. A focused button already reads Space
    // as a click, and the scrubber already reads the arrows as a seek — handling
    // them here too would double every press.
    if (event.target !== event.currentTarget) return;
    const el = media.current;
    if (!el) return;

    switch (event.key) {
      case " ":
      case "k":
      case "K":
        event.preventDefault();
        toggle();
        break;
      case "ArrowRight":
        event.preventDefault();
        seekTo(el.currentTime + 5);
        break;
      case "ArrowLeft":
        event.preventDefault();
        seekTo(el.currentTime - 5);
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        if (isVideo) void toggleFullscreen();
        break;
      default:
        break;
    }
  }

  const mediaProps = {
    ref: attach,
    src,
    preload: "metadata" as const,
    autoPlay,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      onEnded?.();
    },
    onTimeUpdate: (e: React.SyntheticEvent<Media>) =>
      setTime(e.currentTarget.currentTime),
    onDurationChange: (e: React.SyntheticEvent<Media>) => {
      const value = e.currentTarget.duration;
      setDuration(Number.isFinite(value) ? value : 0);
    },
    onLoadedMetadata: (e: React.SyntheticEvent<Media>) => {
      const value = e.currentTarget.duration;
      setDuration(Number.isFinite(value) ? value : 0);
    },
    onVolumeChange: (e: React.SyntheticEvent<Media>) =>
      setMuted(e.currentTarget.muted),
  };

  const controls = isStory ? (
    // Over a video the button floats in the corner. An audio story has no picture
    // to float over — it sits in the caption column with the text.
    <div className={isVideo ? "absolute bottom-3 right-3 z-10" : ""}>
      <MuteButton muted={muted} onClick={toggleMute} onDark />
    </div>
  ) : (
    <div
      className={`flex items-center gap-2 px-2 ${
        isVideo
          ? "absolute inset-x-0 bottom-0 z-10 h-11 bg-black/55"
          : "h-9"
      }`}
    >
      <IconButton
        label={playing ? "Pause" : "Play"}
        onClick={toggle}
        onDark={onDark}
      >
        {playing ? (
          <PauseIcon className="h-4 w-4" />
        ) : (
          <PlayIcon className="h-4 w-4" />
        )}
      </IconButton>

      <Scrubber
        time={time}
        duration={duration}
        onSeek={seekTo}
        onDark={onDark}
      />

      <span
        className={`shrink-0 text-[11px] font-medium tabular-nums ${
          onDark ? "text-white/80" : "text-muted"
        }`}
      >
        {clock(time)} / {clock(duration)}
      </span>

      <MuteButton muted={muted} onClick={toggleMute} onDark={onDark} />

      {isVideo && (
        <IconButton
          label={full ? "Leave fullscreen" : "Fullscreen"}
          onClick={() => void toggleFullscreen()}
          onDark={onDark}
        >
          <ExpandIcon className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );

  if (!isVideo) {
    return (
      <div
        ref={frame}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Audio clip"
        className={`relative ${className ?? ""}`}
      >
        <audio {...mediaProps} className="hidden" />
        {controls}
      </div>
    );
  }

  return (
    <div
      ref={frame}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Video"
      style={
        isStory ? undefined : aspectRatio ? { aspectRatio, maxHeight } : undefined
      }
      className={`relative overflow-hidden bg-black ${className ?? ""}`}
    >
      <video
        {...mediaProps}
        poster={poster ?? undefined}
        playsInline
        // Tapping the picture is how everyone expects video to pause. Stories are
        // the exception: there, a tap means next.
        onClick={isStory ? undefined : toggle}
        // With a known ratio the frame is already the right shape and the video
        // fills it. Without one — a freshly picked file, before the server has
        // measured it — the video sets its own height and the cap applies here.
        style={isStory || aspectRatio ? undefined : { maxHeight }}
        className={
          isStory || aspectRatio
            ? "h-full w-full object-contain"
            : "w-full object-contain"
        }
      />
      {controls}
    </div>
  );
}

/**
 * Track, fill, thumb, and an invisible range on top.
 *
 * `opacity-0` rather than `appearance-none`: the native input keeps its hit area
 * and its keyboard behaviour, so dragging the thumb and clicking the track both
 * work without a single pointer event handler here.
 */
function Scrubber({
  time,
  duration,
  onSeek,
  onDark,
}: {
  time: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onDark: boolean;
}) {
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="relative h-4 min-w-0 flex-1">
      <div
        className={`pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-pill ${
          onDark ? "bg-white/25" : "bg-line"
        }`}
      />
      <div
        style={{ width: `${pct}%` }}
        className={`pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-pill ${
          onDark ? "bg-white" : "bg-ink"
        }`}
      />
      <div
        style={{ left: `${pct}%` }}
        className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill ${
          onDark ? "bg-white" : "bg-ink"
        }`}
      />
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 0}
        step={0.01}
        value={time}
        onChange={(e) => onSeek(Number(e.target.value))}
        disabled={duration <= 0}
        aria-label="Seek"
        aria-valuetext={`${clock(time)} of ${clock(duration)}`}
        className="absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  );
}

function MuteButton({
  muted,
  onClick,
  onDark,
}: {
  muted: boolean;
  onClick: () => void;
  onDark: boolean;
}) {
  return (
    <IconButton label={muted ? "Unmute" : "Mute"} onClick={onClick} onDark={onDark}>
      {muted ? (
        <SpeakerOffIcon className="h-4 w-4" />
      ) : (
        <SpeakerIcon className="h-4 w-4" />
      )}
    </IconButton>
  );
}

function IconButton({
  label,
  onClick,
  onDark,
  children,
}: {
  label: string;
  onClick: () => void;
  onDark: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill transition-colors ${
        onDark
          ? "text-white/85 hover:bg-white/15 hover:text-white"
          : "text-muted hover:bg-panel-3 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** `1:04`, and `1:02:03` once a clip runs past the hour. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
