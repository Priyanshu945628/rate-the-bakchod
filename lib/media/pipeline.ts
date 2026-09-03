import "server-only";

/**
 * Upload normalisation.
 *
 * Everything a user uploads is re-encoded before it is stored. That gives us
 * three things at once: a predictable web-playable format, a hard ceiling on
 * dimensions and duration, and — importantly — metadata stripping. Re-encoding
 * is what removes EXIF, including the GPS coordinates phones embed in photos.
 * We never want to hand those to a public archive.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { limits } from "../config";

export type MediaKind = "IMAGE" | "VIDEO" | "AUDIO";

export interface NormalizedMedia {
  kind: MediaKind;
  data: Buffer;
  mimeType: string;
  bytes: number;
  sha256: string;
  phash: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** JPEG poster frame, for video only. */
  poster: Buffer | null;
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

// ---------------------------------------------------------------------------
// Type sniffing
// ---------------------------------------------------------------------------

function at(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Buffer, offset: number, s: string): boolean {
  if (buf.length < offset + s.length) return false;
  return buf.subarray(offset, offset + s.length).toString("latin1") === s;
}

/**
 * Determine the real type from magic bytes. The browser-declared Content-Type
 * is attacker-controlled and is never trusted for this decision.
 */
export function sniffKind(buf: Buffer): MediaKind | null {
  // Images
  if (at(buf, 0, [0xff, 0xd8, 0xff])) return "IMAGE"; // JPEG
  if (at(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "IMAGE"; // PNG
  if (ascii(buf, 0, "GIF8")) return "IMAGE";
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WEBP")) return "IMAGE";
  if (at(buf, 0, [0x42, 0x4d])) return "IMAGE"; // BMP
  if (ascii(buf, 4, "ftypavif") || ascii(buf, 4, "ftypheic") || ascii(buf, 4, "ftypmif1")) {
    return "IMAGE";
  }

  // Video
  if (at(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "VIDEO"; // Matroska / WebM
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "AVI ")) return "VIDEO";
  if (ascii(buf, 4, "ftyp")) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("M4A") || brand === "M4B ") return "AUDIO";
    return "VIDEO"; // mp4, mov, m4v, 3gp
  }

  // Audio
  if (ascii(buf, 0, "ID3")) return "AUDIO";
  if (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "AUDIO"; // MPEG frame
  if (ascii(buf, 0, "OggS")) return "AUDIO";
  if (ascii(buf, 0, "fLaC")) return "AUDIO";
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WAVE")) return "AUDIO";

  return null;
}

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe
// ---------------------------------------------------------------------------

function run(bin: string, args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaError(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new MediaError(`Failed to launch ${bin}: ${err.message}. Is it on PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      // ffmpeg writes everything to stderr, so surface its tail on failure.
      else reject(new MediaError(`${bin} exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideoStream: boolean;
}

async function probe(file: string): Promise<ProbeResult> {
  const out = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ], 30_000);

  const parsed = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const seconds = parsed.format?.duration ? Number(parsed.format.duration) : NaN;

  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideoStream: Boolean(video),
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Difference hash: downscale to 9x8 greyscale and record whether each pixel is
 * brighter than its right-hand neighbour. Near-identical images produce
 * near-identical hashes, which catches re-uploads that a sha256 would miss.
 */
export async function perceptualHash(image: Buffer): Promise<string | null> {
  try {
    const raw = await sharp(image)
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();

    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? "1" : "0";
      }
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

/** Hamming distance between two perceptual hashes; lower means more similar. */
export function phashDistance(a: string, b: string): number {
  const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  return x.toString(2).split("").filter((c) => c === "1").length;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

async function normalizeImage(input: Buffer): Promise<NormalizedMedia> {
  // .rotate() with no argument applies the EXIF orientation and then discards
  // it; sharp drops all other metadata unless withMetadata() is called. That is
  // deliberate here — it is how GPS tags get removed.
  const pipeline = sharp(input, { failOn: "error" })
    .rotate()
    .resize({
      width: limits.maxImageEdge,
      height: limits.maxImageEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    kind: "IMAGE",
    data,
    mimeType: "image/webp",
    bytes: data.byteLength,
    sha256: sha256Of(data),
    phash: await perceptualHash(data),
    width: info.width,
    height: info.height,
    durationMs: null,
    poster: null,
  };
}

async function normalizeVideo(input: Buffer, workDir: string): Promise<NormalizedMedia> {
  const src = path.join(workDir, "in");
  const out = path.join(workDir, "out.mp4");
  const posterPath = path.join(workDir, "poster.jpg");
  await writeFile(src, input);

  const meta = await probe(src);
  if (!meta.hasVideoStream) {
    throw new MediaError("That file has no video stream.");
  }
  if (meta.durationMs !== null && meta.durationMs > limits.maxVideoDurationMs) {
    throw new MediaError(
      `Video is ${Math.round(meta.durationMs / 1000)}s — the limit is ` +
        `${limits.maxVideoDurationMs / 1000}s.`,
    );
  }

  await run("ffmpeg", [
    "-y",
    "-i", src,
    "-t", String(limits.maxVideoDurationMs / 1000),
    "-map_metadata", "-1",           // strip container metadata wholesale
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",           // required for Safari/iOS playback
    "-vf", "scale='min(1280,iw)':-2",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",       // moov atom first, so it streams
    out,
  ]);

  // Poster from 1s in, or the first frame for very short clips.
  const seek = meta.durationMs !== null && meta.durationMs < 1500 ? "0" : "1";
  await run("ffmpeg", [
    "-y", "-ss", seek, "-i", out,
    "-frames:v", "1", "-vf", "scale='min(800,iw)':-2",
    "-q:v", "4", posterPath,
  ], 60_000);

  const data = await readFile(out);
  const poster = await readFile(posterPath).catch(() => null);
  const finalMeta = await probe(out);

  return {
    kind: "VIDEO",
    data,
    mimeType: "video/mp4",
    bytes: data.byteLength,
    sha256: sha256Of(data),
    phash: poster ? await perceptualHash(poster) : null,
    width: finalMeta.width,
    height: finalMeta.height,
    durationMs: finalMeta.durationMs,
    poster,
  };
}

async function normalizeAudio(input: Buffer, workDir: string): Promise<NormalizedMedia> {
  const src = path.join(workDir, "in");
  const out = path.join(workDir, "out.m4a");
  await writeFile(src, input);

  const meta = await probe(src);
  if (meta.durationMs !== null && meta.durationMs > limits.maxAudioDurationMs) {
    throw new MediaError(
      `Audio is ${Math.round(meta.durationMs / 1000)}s — the limit is ` +
        `${limits.maxAudioDurationMs / 1000}s.`,
    );
  }

  await run("ffmpeg", [
    "-y",
    "-i", src,
    "-t", String(limits.maxAudioDurationMs / 1000),
    "-map_metadata", "-1",
    "-vn",                            // drop cover art, which can carry metadata
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    out,
  ]);

  const data = await readFile(out);
  const finalMeta = await probe(out);

  return {
    kind: "AUDIO",
    data,
    mimeType: "audio/mp4",
    bytes: data.byteLength,
    sha256: sha256Of(data),
    phash: null,
    width: null,
    height: null,
    durationMs: finalMeta.durationMs,
    poster: null,
  };
}

/**
 * Entry point: validate, then re-encode into a known-good form.
 * Temporary working files are always cleaned up, including on failure.
 */
export async function normalizeUpload(input: Buffer): Promise<NormalizedMedia> {
  if (input.byteLength === 0) throw new MediaError("That file is empty.");
  if (input.byteLength > limits.maxUploadBytes) {
    throw new MediaError(
      `File is ${(input.byteLength / 1048576).toFixed(1)} MB — the limit is ` +
        `${limits.maxUploadBytes / 1048576} MB.`,
    );
  }

  const kind = sniffKind(input);
  if (kind === null) {
    throw new MediaError("Unsupported file type. Send an image, video, or audio clip.");
  }

  if (kind === "IMAGE") return normalizeImage(input);

  const workDir = await mkdtemp(path.join(tmpdir(), `rtb-${randomUUID()}-`));
  try {
    return kind === "VIDEO"
      ? await normalizeVideo(input, workDir)
      : await normalizeAudio(input, workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
