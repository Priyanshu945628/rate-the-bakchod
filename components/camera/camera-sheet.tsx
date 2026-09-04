"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { limits } from "@/lib/config";
import {
  COLOUR_LENSES,
  FACE_LENSES,
  ORIGINAL,
  filterCss,
  isFaceLens,
  type Lens,
} from "@/lib/lenses/catalog";
import { KeyboardInset } from "../keyboard-inset";
import { FlipCameraIcon, SpinnerIcon, XIcon } from "../icons";
import { fit, renderFrame } from "../photo-filters";
import { LensCarousel } from "./lens-carousel";
import { LensStage } from "./lens-stage";

/**
 * The camera: the whole screen, a live preview, and one shot on its way out of it.
 *
 * Two things open this — the button in the top bar and the `+` in the phone's tab bar,
 * both in `camera-launcher.tsx` — and it ends in one of the two places a picture can go
 * here: a story, or a post. No file picker anywhere in between.
 *
 * One dial under the preview holds both kinds of lens, because turning it is one gesture
 * either way, but they land at different moments:
 *
 *   - a **colour** preset is CSS on the preview and `ctx.filter` on the bytes, so what
 *     gets sent is what was on screen. A still keeps its unfiltered frame and can be
 *     re-graded freely; a clip is drawn through the filter as it records, because a
 *     recorded video cannot be re-graded on the way out.
 *   - a **face** lens is drawn twice. `lens-stage.tsx` draws it live on a canvas over the
 *     preview, tracking the head off a detection the server sends back a couple of times a
 *     second; then the shutter posts the raw frame and the server draws the version that
 *     actually gets sent. The bytes stay the server's to make — the preview is for aiming.
 *     Stills only: a sixty-second clip is eighteen hundred detections.
 *
 * Portalled to `document.body`. Both buttons that open it sit inside `glass-bar`
 * elements, and `backdrop-filter` makes an ancestor a containing block for fixed
 * children — rendered where it is used, `fixed inset-0` would mean the top bar rather
 * than the screen.
 */

/** What the shutter produced, waiting for a destination. */
type Shot =
  | { kind: "IMAGE"; url: string; frame: HTMLCanvasElement }
  | { kind: "VIDEO"; url: string; file: File };

/** A face lens as the server drew it, for the still currently in review. */
type Render = { lens: string; url: string; file: File };

type Mode = "photo" | "video";
type Destination = "story" | "post";

/** Asked for as long and short edge. A still is kept at the size the server keeps. */
const CAPTURE_LONG = limits.maxImageEdge;
const CAPTURE_SHORT = 900;

/** A clip is recorded at what the server's ffmpeg pass would scale it to anyway. */
const CLIP_MAX_EDGE = 1280;
const CLIP_BITRATE = 2_500_000;
const CLIP_FPS = 30;

/**
 * In order of preference. mp4 where it is offered — Safari records nothing else, and
 * the server stores H.264 regardless, so a clip that arrives as one is a clip that does
 * not have to be transcoded twice. WebM after it, since that is all Chrome and Firefox
 * will record.
 */
const CLIP_TYPES = [
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** What a baked still has to come out within, matching the upload route's own ceilings. */
const CAPS = {
  maxEdge: limits.maxImageEdge,
  uploadMaxBytes: limits.maxUploadBytes,
};

export function CameraSheet({
  filters,
  onClose,
}: {
  /** Whether `ctx.filter` works here. Probed by the button that opened this. */
  filters: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const shell = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  /** Handle for the loop that feeds a recording, so it can be cancelled from anywhere. */
  const frame = useRef(0);
  /** The chosen filter, read once per drawn frame while recording. */
  const live = useRef("");
  /**
   * Which lens request is the current one.
   *
   * Tapping through four lenses quickly leaves four requests in flight, and they do not
   * come back in order — a horse that finishes after the uncle it was replaced by would
   * otherwise win. Only the newest sequence is allowed to land.
   */
  const seq = useRef(0);

  const [mode, setMode] = useState<Mode>("photo");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [mirrored, setMirrored] = useState(false);
  const [cameras, setCameras] = useState(1);
  const [lens, setLens] = useState(ORIGINAL);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [render, setRender] = useState<Render | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);

  const css = filterCss(lens);
  /** The drawn version of the lens that is actually selected, if it is ready. */
  const drawn = render && render.lens === lens ? render : null;

  /**
   * The dial, assembled from what is possible right now.
   *
   * Face lenses need a still, so they are absent from Video mode and from a clip in
   * review. Colour presets need `ctx.filter`, so on a browser without it they are absent
   * everywhere rather than shown and quietly not applied.
   */
  const faceable = shot ? shot.kind === "IMAGE" : mode === "photo";
  const dial = useMemo(() => {
    const list: Lens[] = [COLOUR_LENSES[0]!];
    if (faceable) list.push(...FACE_LENSES);
    if (filters) list.push(...COLOUR_LENSES.slice(1));
    return list;
  }, [faceable, filters]);

  /**
   * End a take.
   *
   * Kept stable and up here because two very different things ask for it: the shutter,
   * and the timer that will not let a clip run past what the server accepts.
   */
  const stop = useCallback(() => {
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }, []);

  /**
   * One stream for as long as the sheet is open, re-taken when the camera is flipped or
   * when Video mode needs a microphone Photo mode never asked for. Asking for the
   * microphone only at that point is deliberate: a permission prompt for something
   * nobody has reached yet is a prompt that gets refused.
   */
  useEffect(() => {
    let cancelled = false;

    async function open() {
      const devices = navigator.mediaDevices;
      if (!devices?.getUserMedia) {
        setError("No camera here.");
        return;
      }
      try {
        const media = await devices.getUserMedia({
          video: videoConstraints(facing),
          audio: mode === "video",
        });
        if (cancelled) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream.current = media;
        if (preview.current) preview.current.srcObject = media;
        setError(null);
        // What the camera gave back, not what was asked for. A laptop webcam reports no
        // facing at all and points at the person using it, so absent means mirror — the
        // way every self-view has always behaved.
        const settings = media.getVideoTracks()[0]?.getSettings();
        setMirrored(settings?.facingMode !== "environment");
        // Only worth a flip button if there is somewhere to flip to, and only countable
        // after permission: before it, browsers report one unlabelled entry.
        const list = await devices.enumerateDevices().catch(() => []);
        if (!cancelled) setCameras(list.filter((device) => device.kind === "videoinput").length);
      } catch (cause) {
        if (!cancelled) setError(reason(cause));
      }
    }

    void open();

    return () => {
      cancelled = true;
      const media = stream.current;
      stream.current = null;
      if (media) for (const track of media.getTracks()) track.stop();
    };
  }, [facing, mode]);

  // The page behind a full-screen camera should not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    shell.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape out, and Tab kept inside — the same trap `photo-viewer.tsx` uses, widened to
  // the caption field. Escape is ignored mid-upload, where leaving would abandon a
  // request that is already on its way.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = shell.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // A shot's preview URL lives exactly as long as the shot: dropped on a retake, and
  // again when the sheet closes. Nothing outside this component ever holds it.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  // Same for a drawn lens, which is replaced every time another one is tapped.
  useEffect(() => {
    if (!render) return;
    return () => URL.revokeObjectURL(render.url);
  }, [render]);

  // The clock on a take, and the ceiling on it. The server refuses anything longer, so
  // the take ends itself here rather than letting somebody film ninety seconds to be
  // told no afterwards.
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= limits.maxVideoDurationMs) stop();
    }, 200);
    return () => clearInterval(timer);
  }, [recording, stop]);

  // Closing mid-take must not leave the recorder running or its loop drawing.
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      const rec = recorder.current;
      recorder.current = null;
      if (rec && rec.state !== "inactive") {
        // Cleared first: `onstop` would hand a shot to a component that is gone, and the
        // object URL it made would never be revoked.
        rec.onstop = null;
        rec.stop();
      }
    },
    [],
  );

  /**
   * Turn the dial.
   *
   * A colour preset is instant — the string it carries is the whole effect. A face lens
   * on a still already taken is a request, fired from here rather than from an effect
   * watching the selection, which would be a setState in an effect and is also a worse
   * description of what happened: a person tapped a thing.
   *
   * In the live view there is nothing to send yet: `lens-stage.tsx` picks the change up from
   * the selection and draws it on the preview until the shutter fires.
   */
  async function choose(id: string) {
    setLens(id);
    // Mirrored into a ref as well: the recording loop runs outside React and cannot read
    // state, and this is what it reads each frame.
    live.current = filterCss(id);
    if (!isFaceLens(id) || shot?.kind !== "IMAGE") return;
    const frameToSend = shot.frame;
    await applyLens(id, () => renderFrame(frameToSend, "", CAPS));
  }

  /**
   * Ask the server to draw a lens, and keep the result if it is still the wanted one.
   *
   * The unfiltered still is what goes up every time, never a previously drawn one —
   * stacking a moustache onto a horse is not a lens, it is a mistake that cannot be
   * undone. A failure puts the dial back on the original, so Send can never quietly
   * despatch a picture without the effect that was asked for.
   */
  async function applyLens(id: string, source: () => Promise<File>) {
    const mine = ++seq.current;
    setRendering(id);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", await source());
      body.set("lens", id);
      const res = await fetch("/api/lens", { method: "POST", body });
      if (seq.current !== mine) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That lens did not come out.");
        setLens(ORIGINAL);
        live.current = "";
        setRendering(null);
        return;
      }
      const blob = await res.blob();
      if (seq.current !== mine) return;
      setRender({
        lens: id,
        url: URL.createObjectURL(blob),
        file: new File([blob], "lens.webp", { type: blob.type || "image/webp" }),
      });
      setRendering(null);
    } catch {
      if (seq.current !== mine) return;
      setError("That lens did not come out.");
      setLens(ORIGINAL);
      live.current = "";
      setRendering(null);
    }
  }

  function flip() {
    // Both of these re-take the stream, so the shutter goes back to waiting: the frame on
    // screen belongs to a camera that is being stopped, and there is a moment where it is
    // the last one there will be.
    setReady(false);
    setFacing((current) => (current === "user" ? "environment" : "user"));
  }

  function switchTo(next: Mode) {
    if (next === mode || recording) return;
    setReady(false);
    setMode(next);
    setElapsed(0);
    // A clip cannot carry a face lens, so one selected in Photo mode does not follow the
    // dial into Video — better an obvious jump back to the original than a swatch that
    // stays lit and does nothing.
    if (next === "video" && isFaceLens(lens)) {
      setLens(ORIGINAL);
      live.current = "";
    }
  }

  function retake() {
    seq.current += 1;
    setShot(null);
    setRender(null);
    setRendering(null);
    setCaption("");
    setError(null);
    setElapsed(0);
    // Nudged rather than assumed: a `<video>` that was hidden through the review keeps
    // its stream, but not in every browser its playback.
    void preview.current?.play().catch(() => {});
  }

  /** The shutter, in Photo mode. */
  function capture() {
    const video = preview.current;
    if (!video?.videoWidth) return;
    const size = fit(video.videoWidth, video.videoHeight, limits.maxImageEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    // Deliberately unfiltered. `renderFrame` bakes whichever colour preset is chosen at
    // the moment Send is pressed, and a face lens goes up as it is — which is what keeps
    // the dial under a still live.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("That shot did not come out.");
          return;
        }
        setShot({ kind: "IMAGE", url: URL.createObjectURL(blob), frame: canvas });
        // Where a face lens was already chosen in the viewfinder, this is the moment it
        // becomes real. The blob is the still, so nothing has to be re-encoded for it.
        if (isFaceLens(lens)) {
          const file = new File([blob], "shot.webp", { type: blob.type || "image/webp" });
          void applyLens(lens, async () => file);
        }
      },
      "image/webp",
      0.92,
    );
  }

  /**
   * The shutter, in Video mode.
   *
   * The camera's own track is never recorded. Every frame is drawn into a canvas through
   * `ctx.filter` and the canvas is what gets recorded, which is the only way a filter
   * ends up in the clip itself — there is no re-grading a finished video, so a filter
   * tapped mid-take applies from that moment on and what came before keeps the look it
   * was shot with.
   */
  function record() {
    const video = preview.current;
    const media = stream.current;
    if (!video?.videoWidth || !media) return;
    const type =
      typeof MediaRecorder === "undefined"
        ? undefined
        : CLIP_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!type) {
      setError("This browser cannot record.");
      return;
    }

    const size = fit(video.videoWidth, video.videoHeight, CLIP_MAX_EDGE, true);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    live.current = css;
    const draw = () => {
      ctx.filter = live.current || "none";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(CLIP_FPS);
    // The microphone is taken off the camera's stream; a canvas has no sound of its own.
    // The track is borrowed, not owned — closing the sheet stops it with the rest.
    for (const track of media.getAudioTracks()) canvasStream.addTrack(track);

    const rec = new MediaRecorder(canvasStream, {
      mimeType: type,
      videoBitsPerSecond: CLIP_BITRATE,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    rec.onstop = () => {
      cancelAnimationFrame(frame.current);
      for (const track of canvasStream.getVideoTracks()) track.stop();
      recorder.current = null;
      const blob = new Blob(chunks, { type });
      if (!blob.size) {
        setError("That clip did not come out.");
        return;
      }
      const file = new File([blob], `clip.${clipExtension(type)}`, { type });
      setShot({ kind: "VIDEO", url: URL.createObjectURL(blob), file });
    };
    recorder.current = rec;
    setElapsed(0);
    setRecording(true);
    // Timesliced so a clip cut short by a closed tab or a crash still has most of its
    // data in hand rather than one blob that was never finished.
    rec.start(400);
  }

  /** Off to one of the two places this ends. */
  async function send(destination: Destination) {
    if (!shot || busy || rendering) return;
    setBusy(destination);
    setError(null);
    try {
      // Three sources, one per kind of lens: a clip is already what it is, a face lens is
      // the bytes the server sent back, and a colour preset is baked here and now.
      let file: File;
      if (shot.kind === "VIDEO") {
        file = shot.file;
      } else if (isFaceLens(lens)) {
        if (!drawn) {
          setError("That lens did not come out.");
          setBusy(null);
          return;
        }
        file = drawn.file;
      } else {
        file = await renderFrame(shot.frame, css, CAPS);
      }
      if (file.size > limits.maxUploadBytes) {
        setError("That is too big to upload.");
        setBusy(null);
        return;
      }
      const body = new FormData();
      body.set("file", file);
      const trimmed = caption.trim();
      if (trimmed) body.set("caption", trimmed);

      const res = await fetch(destination === "story" ? "/api/stories" : "/api/posts", {
        method: "POST",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not go through.");
        setBusy(null);
        return;
      }
      // The tray and the feed are both server-rendered, and this sheet is mounted nowhere
      // near either of them — a refresh is how what was just sent turns up.
      router.refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through.");
      setBusy(null);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Camera" className="fixed inset-0 z-[60] bg-black">
      {/* The caption sits at the bottom of the screen, so this is one of the few surfaces
          that has to know where the on-screen keyboard is. */}
      <KeyboardInset />

      <div ref={shell} tabIndex={-1} className="flex h-full w-full flex-col outline-none">
        <div className="flex items-center px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            aria-label="Close camera"
            className="flex h-9 w-9 items-center justify-center rounded-pill bg-panel/70 text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            <XIcon className="h-4 w-4" />
          </button>

          {!shot && cameras > 1 ? (
            <button
              type="button"
              onClick={flip}
              disabled={recording}
              aria-label="Switch camera"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-pill bg-panel/70 text-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              <FlipCameraIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1">
          {/* `object-contain`, the same call the call window makes: the frame is asked for
              the right way up, and bars beat a haircut when it comes back some other
              shape. What is on screen here is exactly what the shutter draws. */}
          <video
            ref={preview}
            autoPlay
            muted
            playsInline
            hidden={shot !== null}
            onLoadedMetadata={() => setReady(true)}
            style={{ filter: css || undefined, transform: mirrored ? "scaleX(-1)" : undefined }}
            className="h-full w-full object-contain"
          />

          {/* The live face lens, drawn over the preview. Mounted only while one is selected,
              so an ordinary viewfinder is still just a `<video>` with nothing on top of it. */}
          {shot === null && isFaceLens(lens) && ready ? (
            <LensStage video={preview} lens={lens} mirrored={mirrored} tone={filters} />
          ) : null}

          {shot?.kind === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={drawn ? drawn.url : shot.url}
              alt=""
              style={{ filter: css || undefined }}
              className="h-full w-full object-contain"
            />
          ) : null}

          {/* Already filtered in the pixels, so no `style` here — and playable, because a
              clip is the one thing worth watching back before sending it. */}
          {shot?.kind === "VIDEO" ? (
            <video
              src={shot.url}
              autoPlay
              playsInline
              controls
              className="h-full w-full object-contain"
            />
          ) : null}

          {recording ? (
            <span className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-black/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              {clock(elapsed)}
            </span>
          ) : null}
        </div>

        <div className="shrink-0 px-3 pt-2 pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+var(--kb))]">
          {error ? <p className="mb-2 text-center text-xs text-danger">{error}</p> : null}

          {shot ? (
            <>
              {/* A clip gets no dial. It was drawn through its colour preset as it
                  recorded, and a face lens was never on offer for it. */}
              {shot.kind === "IMAGE" && dial.length > 1 ? (
                <div className="mb-2">
                  <LensCarousel
                    lenses={dial}
                    value={lens}
                    rendering={rendering}
                    disabled={busy !== null}
                    onChange={(id) => void choose(id)}
                  />
                </div>
              ) : null}

              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={limits.captionMaxLength}
                placeholder="Context, if it needs any"
                aria-label="Caption"
                className="h-10 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={retake}
                  disabled={busy !== null}
                  className="h-9 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => void send("story")}
                  disabled={busy !== null || rendering !== null}
                  className="ml-auto flex h-9 items-center gap-2 rounded-ctl border border-line-strong px-4 text-sm font-medium text-ink transition-colors hover:bg-panel-2 disabled:opacity-60"
                >
                  {busy === "story" ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                  Story
                </button>
                <button
                  type="button"
                  onClick={() => void send("post")}
                  disabled={busy !== null || rendering !== null}
                  className="flex h-9 items-center gap-2 rounded-ctl bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busy === "post" ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                  Post
                </button>
              </div>
            </>
          ) : (
            <>
              {/* The same dial as in review, live. A colour preset changes the preview on
                  the spot and stays live through a take — that is what makes it an effect
                  on a clip rather than a decision before one. A face lens cannot show
                  itself here, so its swatch is the promise and the shutter is where it
                  is kept. */}
              {dial.length > 1 ? (
                <LensCarousel
                  lenses={dial}
                  value={lens}
                  rendering={rendering}
                  disabled={recording}
                  onChange={(id) => void choose(id)}
                />
              ) : null}

              <div className="mt-3 flex justify-center">
                <div className="flex items-center gap-0.5 rounded-pill border border-line-strong bg-panel/70 p-0.5">
                  {MODES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => switchTo(option)}
                      disabled={recording}
                      aria-pressed={mode === option}
                      className={`h-7 rounded-pill px-4 text-[11px] font-medium capitalize transition-colors disabled:opacity-40 ${
                        mode === option ? "bg-panel-3 text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={mode === "photo" ? capture : recording ? stop : record}
                  disabled={!ready}
                  aria-label={
                    mode === "photo" ? "Take photo" : recording ? "Stop recording" : "Start recording"
                  }
                  className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-accent/80 transition-transform active:scale-95 disabled:opacity-40"
                >
                  <span
                    className={`transition-all ${
                      mode === "photo"
                        ? "h-14 w-14 rounded-full bg-accent"
                        : recording
                          ? "h-6 w-6 rounded-[5px] bg-danger"
                          : "h-14 w-14 rounded-full bg-danger"
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Photo first: it is what the button is for most of the time. */
const MODES: Mode[] = ["photo", "video"];

/**
 * The frame to ask the camera for.
 *
 * A phone held upright asks for a portrait frame, so the preview fills a tall screen
 * instead of sitting in bars, and a webcam above a desktop window keeps its landscape
 * shape. Both stay `ideal`: a camera that can do neither should open with whatever it has
 * rather than fail with `OverconstrainedError`. Same reasoning as `videoConstraints` in
 * `components/call/call-provider.tsx`, one size up — a call is only ever 720p, while a
 * still here is kept at what the server keeps.
 */
function videoConstraints(facingMode: "user" | "environment"): MediaTrackConstraints {
  const portrait =
    window.matchMedia("(orientation: portrait)").matches &&
    window.matchMedia("(pointer: coarse)").matches;
  return {
    facingMode,
    width: { ideal: portrait ? CAPTURE_SHORT : CAPTURE_LONG },
    height: { ideal: portrait ? CAPTURE_LONG : CAPTURE_SHORT },
  };
}

/** Elapsed take, as a clock. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Cosmetic — the upload route sniffs magic bytes and never reads the name. */
function clipExtension(mimeType: string): string {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

/**
 * A `getUserMedia` failure as something a person can act on.
 *
 * The DOMException names are the only reliable part; their messages vary by browser and
 * some of them name an internal device path, which is no use under a viewfinder.
 */
function reason(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access blocked.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found.";
  if (name === "NotReadableError") return "The camera is already in use.";
  return "The camera did not open.";
}
