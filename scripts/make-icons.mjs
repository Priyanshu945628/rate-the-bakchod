// Regenerates the installed-app icons from the mark in `app/icon.svg`.
//
//   node scripts/make-icons.mjs
//
// Run it when the mark changes. The outputs are committed, because a manifest
// that points at icons built during deploy is a manifest that 404s if the build
// step is ever skipped.
//
// Two shapes, and the difference matters. `icon-*.png` is the app as drawn —
// rounded tile, mark at full size — and is used wherever the platform shows the
// icon as given. `maskable-*.png` is full-bleed with the mark pulled in to 72%,
// because Android crops a maskable icon to whatever silhouette the launcher
// prefers and only guarantees the middle 80%; a rounded tile handed to that gets
// its own corners shaved off.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Literal hexes, as in `app/icon.svg`: these are rendered to PNG and can never
// read the app's stylesheet. --color-bg and --color-ink.
const BG = "#08090a";
const INK = "#f4f4f5";

/** The dial, in a 32-unit box. `scale` shrinks it about its own centre. */
function svg({ radius, scale }) {
  const mark = `<g fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round">
    <path d="M7.4 19.6a8.6 8.6 0 0 1 17.2 0"/>
    <path d="M16 19.6 21 13.8"/>
  </g>
  <circle cx="16" cy="19.6" r="2" fill="${INK}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${radius}" fill="${BG}"/>
  <g transform="translate(16 16.3) scale(${scale}) translate(-16 -16.3)">${mark}</g>
</svg>`;
}

const TARGETS = [
  { file: "public/icons/icon-192.png", size: 192, radius: 7, scale: 1 },
  { file: "public/icons/icon-512.png", size: 512, radius: 7, scale: 1 },
  { file: "public/icons/maskable-192.png", size: 192, radius: 0, scale: 0.72 },
  { file: "public/icons/maskable-512.png", size: 512, radius: 0, scale: 0.72 },
  // iOS masks this itself and ignores transparency, so it is full-bleed too.
  { file: "app/apple-icon.png", size: 180, radius: 0, scale: 1 },
];

for (const { file, size, radius, scale } of TARGETS) {
  const out = join(root, file);
  await mkdir(dirname(out), { recursive: true });
  const png = await sharp(Buffer.from(svg({ radius, scale })), { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(out, png);
  console.log(`${file}  ${png.length} bytes`);
}
