/**
 * Face detection, in a child process that stays alive.
 *
 * Reads framed requests on stdin and writes one JSON line per reply:
 *
 *   → {"id":7,"width":384,"height":512}\n  followed by width*height raw grey bytes
 *   ← {"id":7,"faces":[{"x":67,"y":190,"width":188,"height":188,"eyes":[…]}]}\n
 *
 * A header line and then the bytes, rather than JSON all the way, because a raw greyscale
 * frame contains every byte value including newlines — there is nothing in it to delimit.
 *
 * Out of process on purpose. Haar detection is synchronous and CPU-bound: a few hundred
 * milliseconds inside the web process would stall every other request, including the event
 * streams the chat holds open. Here it stalls nothing and a wedged run can be killed.
 *
 * Long-lived on purpose too. Starting the WASM runtime costs ~350ms against ~70ms of
 * actual work, so a process per frame would spend five sixths of its life booting — and
 * the live viewfinder asks for a frame every 650ms.
 *
 * Greyscale in, because that is all the classifier looks at — decoding and resizing belong
 * to sharp in the parent, which is already holding the image.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CASCADES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "lenses",
  "cascades",
);

/**
 * Smallest face to look for, as a fraction of the shorter edge.
 *
 * A quarter of the frame is a deliberately high floor. Lowering it does find more faces,
 * but what it mostly finds is small false positives — an eyebrow, a patterned collar, a
 * face in the background — and a lens drawn onto one of those is worse than a lens drawn
 * onto a sensible guess. The subject of a photo somebody is putting a lens on is not a
 * quarter of the way across the frame; they are most of it.
 */
const MIN_FACE = 0.24;
/** Smallest eye, as a fraction of the face's width. */
const MIN_EYE = 0.14;
/** Eyes live in the top of the box; below this is nose and mouth, and false positives. */
const EYE_BAND = 0.62;

/** Nothing but replies goes to stdout — a stray line would corrupt the stream. */
function reply(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function die(message) {
  reply({ error: message });
  process.exit(0);
}

const module_ = await import("@techstark/opencv-js").catch((err) =>
  die(`could not load opencv: ${err instanceof Error ? err.message : String(err)}`),
);
const cvModule = module_.default ?? module_;

/**
 * Wait for the WASM runtime.
 *
 * The wrapper object is not cosmetic. The emscripten Module carries a legacy `then`
 * method, so a promise resolved *with* it adopts it as a thenable and never settles —
 * the event loop stops dead, and even an outer timeout never fires. Resolving a plain
 * object that holds it sidesteps promise adoption entirely.
 */
const { cv } = await new Promise((resolve) => {
  if (typeof cvModule.Mat === "function") resolve({ cv: cvModule });
  else cvModule.onRuntimeInitialized = () => resolve({ cv: cvModule });
});

/** Cascades reach the WASM heap through its in-memory filesystem, not a path. */
function loadCascade(file) {
  cv.FS_createDataFile("/", file, readFileSync(path.join(CASCADES, file)), true, false, false);
  const classifier = new cv.CascadeClassifier();
  if (!classifier.load(file)) throw new Error(`could not load ${file}`);
  return classifier;
}

let faceCascade;
let eyeCascade;
try {
  // Read once, for the life of the process. This is the whole reason it has one.
  faceCascade = loadCascade("haarcascade_frontalface_alt2.xml");
  eyeCascade = loadCascade("haarcascade_eye.xml");
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}

reply({ ready: true });

/**
 * One frame.
 *
 * Every Mat and vector is deleted on the way out: the WASM heap is not garbage collected,
 * and a leak here would grow for as long as somebody keeps the camera open.
 */
function detect(bytes, width, height) {
  let grey;
  try {
    grey = cv.matFromArray(height, width, cv.CV_8UC1, bytes);
    // Flattens out under- and over-exposure, which is most of what a phone selfie in bad
    // light suffers from, and is the single change that most improves the hit rate.
    cv.equalizeHist(grey, grey);

    const min = Math.max(24, Math.round(Math.min(width, height) * MIN_FACE));

    // Strict first. A second pass only where the first found nothing: a beard, heavy
    // glasses or a head turned slightly all lose the strict pass, and a marginal detection
    // beats the centred guess the caller falls back to. It relaxes how carefully the
    // window is stepped and how many neighbours must agree — never the minimum size,
    // because a smaller window is how the loose pass would start reporting eyebrows as
    // faces.
    let faces = detectFaces(faceCascade, grey, min, 1.1, 4);
    if (faces.length === 0) faces = detectFaces(faceCascade, grey, min, 1.05, 2);

    return faces.map((face) => ({ ...face, eyes: detectEyes(eyeCascade, grey, face) }));
  } finally {
    grey?.delete();
  }
}

function detectFaces(cascade, mat, min, scaleFactor, neighbours) {
  const found = new cv.RectVector();
  try {
    cascade.detectMultiScale(
      mat,
      found,
      scaleFactor,
      neighbours,
      0,
      new cv.Size(min, min),
      new cv.Size(0, 0),
    );
    const out = [];
    for (let i = 0; i < found.size(); i += 1) {
      const r = found.get(i);
      out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return out;
  } finally {
    found.delete();
  }
}

function detectEyes(cascade, mat, face) {
  const band = Math.max(1, Math.round(face.height * EYE_BAND));
  let roi;
  const found = new cv.RectVector();
  try {
    roi = mat.roi(new cv.Rect(face.x, face.y, face.width, band));
    const min = Math.max(8, Math.round(face.width * MIN_EYE));
    cascade.detectMultiScale(roi, found, 1.1, 3, 0, new cv.Size(min, min), new cv.Size(0, 0));
    const out = [];
    for (let i = 0; i < found.size(); i += 1) {
      const r = found.get(i);
      // Back into the whole image's coordinates, as the centre of the eye rather than
      // its corner — a centre is what every anchor is measured from.
      out.push({ cx: face.x + r.x + r.width / 2, cy: face.y + r.y + r.height / 2 });
    }
    return out;
  } catch {
    return [];
  } finally {
    found.delete();
    roi?.delete();
  }
}

/**
 * The request loop.
 *
 * stdin arrives in whatever sized chunks the pipe felt like, so nothing can be assumed to
 * be whole: a header may land split across two chunks, and two requests may land in one.
 * Everything is buffered and consumed only once complete.
 */
let inbox = Buffer.alloc(0);
let head = null;

process.stdin.on("data", (chunk) => {
  inbox = inbox.length === 0 ? chunk : Buffer.concat([inbox, chunk]);
  for (;;) {
    if (!head) {
      const cut = inbox.indexOf(0x0a);
      if (cut === -1) return;
      const line = inbox.subarray(0, cut).toString("utf8");
      inbox = inbox.subarray(cut + 1);
      try {
        head = JSON.parse(line);
      } catch {
        die(`unreadable request header: ${line.slice(0, 80)}`);
      }
    }

    const need = head.width * head.height;
    if (!Number.isInteger(need) || need <= 0) die("request header has no usable size");
    if (inbox.length < need) return;

    const bytes = inbox.subarray(0, need);
    inbox = inbox.subarray(need);
    const request = head;
    head = null;

    try {
      reply({ id: request.id, faces: detect(bytes, request.width, request.height) });
    } catch (err) {
      reply({
        id: request.id,
        faces: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

// The parent closing the pipe is the shutdown signal. Emscripten leaves handles open, so
// nothing here would exit on its own.
process.stdin.on("end", () => {
  faceCascade?.delete();
  eyeCascade?.delete();
  process.exit(0);
});
