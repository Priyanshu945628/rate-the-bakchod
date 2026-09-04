/**
 * Finding the face, from the web process's side.
 *
 * Keeps one long-lived `scripts/detect-face.mjs` running and talks to it over a pipe: a
 * header line, then the raw greyscale bytes, then a JSON line back. The child is where
 * OpenCV lives; see that file for why it is a child at all.
 *
 * Why it is kept warm rather than spawned per request: the WASM runtime costs ~350ms to
 * start against ~70ms of actual work, so a fresh process spends five sixths of its life
 * booting. That was tolerable when the only caller was the shutter. The live viewfinder
 * asks roughly every 650ms, and at that rate a spawn per frame would burn most of a core
 * for every open camera.
 *
 * Detection happens on a small copy. Haar is quadratic in pixels and learns nothing from
 * resolution — a face is the same arrangement of light and dark at 512px as at 1600 — so
 * shrinking first is most of what makes this fast enough to sit in a request.
 *
 * Nothing here throws. A crashed, missing or wedged detector answers the same as a photo
 * with nobody in it, because the caller already has a sensible answer for that and failing
 * a send at the shutter is the worst outcome available.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Detected } from "./geometry";

/** Longest edge the classifier looks at when a lens is being drawn. */
export const DETECT_EDGE = 512;

/**
 * Longest edge for live tracking.
 *
 * Smaller than the shutter's copy, and not for detection speed — that is already fast
 * enough. It is the upload: a frame every 650ms from a phone on mobile data has to stay
 * small, and a face filling a 384px frame is still 150px of classifier window.
 */
export const TRACK_EDGE = 384;

/** One frame's work, warm. Long enough to sit behind a queue, short enough to give up. */
const REQUEST_MS = 10_000;

/** Booting the WASM runtime, on a cold and possibly loaded machine. */
const START_MS = 25_000;

/** No camera open for this long and the 10MB WASM heap can go back to the OS. */
const IDLE_MS = 120_000;

interface Reply {
  id?: number;
  faces?: Detected[];
  error?: string;
  ready?: boolean;
}

interface Waiter {
  settle: (faces: Detected[]) => void;
  fail: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Detector {
  child: ChildProcess;
  /** Settles when the child has its cascades loaded and is listening, or when it dies. */
  ready: Promise<void>;
  arrive: () => void;
  refuse: (err: Error) => void;
  waiting: Map<number, Waiter>;
  seq: number;
  inbox: string;
  idle: NodeJS.Timeout | null;
  dead: boolean;
}

/**
 * One detector per process, on `globalThis` so a dev-server hot reload reuses the child it
 * already paid to start instead of leaking one per edit.
 */
const globalForDetector = globalThis as unknown as { __rtbDetector?: Detector | null };

/** Frames run one at a time. Haar is CPU-bound, so overlapping them buys nothing. */
let chain: Promise<unknown> = Promise.resolve();

/**
 * Every face in a greyscale buffer. Largest first is *not* guaranteed — the caller picks.
 *
 * The reason for a failure is logged, so a detector that is broken everywhere leaves a
 * trail rather than quietly turning every lens into a guess.
 */
export async function detectFaces(
  grey: Buffer,
  width: number,
  height: number,
): Promise<Detected[]> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return [];
  if (grey.length < width * height) return [];

  const work = () => ask(grey, width, height);
  const next = chain.then(work, work);
  chain = next.then(
    () => {},
    () => {},
  );

  try {
    return await next;
  } catch (err) {
    console.error("lens detector failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Send one frame and wait for its answer, starting the child if it is not up. */
async function ask(grey: Buffer, width: number, height: number): Promise<Detected[]> {
  let detector = detectorProcess();
  await started(detector);
  // The idle deadline can land inside that await — the frame is not in `waiting` yet, so
  // nothing was holding the child open. Writing into the pipe it just closed would stall
  // for the full request timeout, so take a fresh one instead.
  if (detector.dead) {
    detector = detectorProcess();
    await started(detector);
  }

  return new Promise<Detected[]>((resolve, reject) => {
    const id = (detector.seq += 1);
    const timer = setTimeout(() => {
      detector.waiting.delete(id);
      const err = new Error(`detector timed out after ${REQUEST_MS}ms`);
      // A frame that never came back means the child is wedged inside OpenCV, where
      // nothing can interrupt it. The only cure is a new one.
      stop(detector, err);
      reject(err);
    }, REQUEST_MS);

    detector.waiting.set(id, { settle: resolve, fail: reject, timer });
    hold(detector);
    detector.child.stdin?.write(`${JSON.stringify({ id, width, height })}\n`);
    detector.child.stdin?.write(grey.subarray(0, width * height));
  });
}

/** The handshake, with a deadline of its own — a child that never boots must not hang. */
function started(detector: Detector): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`detector did not start within ${START_MS}ms`);
      stop(detector, err);
      reject(err);
    }, START_MS);
    detector.ready.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** The running child, or a freshly started one. */
function detectorProcess(): Detector {
  const existing = globalForDetector.__rtbDetector;
  if (existing && !existing.dead) return existing;

  const script = path.join(process.cwd(), "scripts", "detect-face.mjs");
  const child = spawn(process.execPath, [script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let arrive: () => void = () => {};
  let refuse: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    arrive = resolve;
    refuse = reject;
  });
  // Nothing may be awaiting it yet, and a rejected promise with no handler is fatal.
  ready.catch(() => {});

  const detector: Detector = {
    child,
    ready,
    arrive,
    refuse,
    waiting: new Map(),
    seq: 0,
    inbox: "",
    idle: null,
    dead: false,
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    detector.inbox += chunk;
    for (;;) {
      const cut = detector.inbox.indexOf("\n");
      if (cut === -1) return;
      const line = detector.inbox.slice(0, cut);
      detector.inbox = detector.inbox.slice(cut + 1);
      if (line.trim()) receive(detector, line);
    }
  });
  // The child's own noise, and emscripten's. Never a reply; draining it stops the pipe
  // filling up and blocking the child mid-frame.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", () => {});
  child.stdin?.on("error", () => {});
  child.on("error", (err) =>
    stop(detector, new Error(`could not launch the detector: ${err.message}`)),
  );
  child.on("close", (code) =>
    stop(detector, new Error(`detector exited ${code ?? "unexpectedly"}`)),
  );

  globalForDetector.__rtbDetector = detector;
  return detector;
}

/** One reply line: the ready handshake, or a frame's answer. */
function receive(detector: Detector, line: string) {
  let parsed: Reply;
  try {
    parsed = JSON.parse(line) as Reply;
  } catch {
    console.error("lens detector: unreadable reply");
    return;
  }

  if (parsed.error) console.error(`lens detector: ${parsed.error}`);
  if (parsed.ready) {
    detector.arrive();
    return;
  }
  if (typeof parsed.id !== "number") return;

  const waiter = detector.waiting.get(parsed.id);
  if (!waiter) return;
  detector.waiting.delete(parsed.id);
  clearTimeout(waiter.timer);
  hold(detector);
  waiter.settle(parsed.faces ?? []);
}

/**
 * End the child and fail everything still waiting on it.
 *
 * Clearing the singleton is the important half: the next frame starts a new child rather
 * than writing into a closed pipe forever.
 */
function stop(detector: Detector, err: Error) {
  if (detector.dead) return;
  detector.dead = true;
  if (detector.idle) clearTimeout(detector.idle);
  if (globalForDetector.__rtbDetector === detector) globalForDetector.__rtbDetector = null;
  detector.refuse(err);
  for (const waiter of detector.waiting.values()) {
    clearTimeout(waiter.timer);
    waiter.fail(err);
  }
  detector.waiting.clear();
  detector.child.kill("SIGKILL");
}

/** Push the idle deadline out. Unrefed, so a waiting detector never holds the process up. */
function hold(detector: Detector) {
  if (detector.idle) clearTimeout(detector.idle);
  detector.idle = setTimeout(() => {
    if (detector.waiting.size > 0) return hold(detector);
    detector.dead = true;
    if (globalForDetector.__rtbDetector === detector) globalForDetector.__rtbDetector = null;
    // Closing the pipe is the child's shutdown signal; it frees its cascades and exits.
    detector.child.stdin?.end();
  }, IDLE_MS);
  detector.idle.unref?.();
}
