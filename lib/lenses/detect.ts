/**
 * Finding the face, from the web process's side.
 *
 * Spawns `scripts/detect-face.mjs`, hands it a raw greyscale buffer through a temp file,
 * and reads back JSON. The child is where OpenCV lives; see that file for why.
 *
 * Detection happens on a small copy. Haar is quadratic in pixels and learns nothing from
 * resolution — a face is the same arrangement of light and dark at 512px as at 1600 — so
 * shrinking first is most of what makes this fast enough to sit in a request.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Detected } from "./geometry";

/** Longest edge the classifier looks at. */
export const DETECT_EDGE = 512;

/** Generous: a cold child is ~350ms of WASM startup plus ~70ms of work. */
const TIMEOUT_MS = 15_000;

interface DetectorOutput {
  faces?: Detected[];
  error?: string;
}

/**
 * Every face in a greyscale buffer, largest first is *not* guaranteed — the caller picks.
 *
 * Never throws. A crashed, missing or slow detector answers the same as a photo with
 * nobody in it, because the caller has a sensible answer for that already and failing a
 * send at the shutter is the worst outcome available. The reason is logged either way, so
 * a detector that is broken everywhere leaves a trail rather than quietly turning every
 * lens into a guess.
 */
export async function detectFaces(
  grey: Buffer,
  width: number,
  height: number,
): Promise<Detected[]> {
  const workDir = await mkdtemp(path.join(tmpdir(), `rtb-lens-${randomUUID()}-`));
  const rawPath = path.join(workDir, "grey.raw");
  try {
    await writeFile(rawPath, grey);
    const script = path.join(process.cwd(), "scripts", "detect-face.mjs");
    const stdout = await run(process.execPath, [script, rawPath, String(width), String(height)]);
    const parsed = JSON.parse(stdout) as DetectorOutput;
    if (parsed.error) console.error(`lens detector: ${parsed.error}`);
    return parsed.faces ?? [];
  } catch (err) {
    console.error("lens detector failed:", err instanceof Error ? err.message : err);
    return [];
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The house pattern: spawn, accumulate, SIGKILL on a deadline. */
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`detector timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`could not launch the detector: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`detector exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}
