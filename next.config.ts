import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Files the lens route needs at runtime that nothing imports.
   *
   * `renderLens` reads its art out of `public/lenses/` by name and spawns
   * `scripts/detect-face.mjs`, which reads the Haar cascades beside itself — three sets of
   * files the tracer cannot see, because none of them are ever `import`ed. Under Nixpacks
   * this is insurance rather than load-bearing: `next start` runs with the whole repo as
   * its working directory, so all three are already there. It matters the day the deploy
   * becomes `output: "standalone"`, which copies only what the trace names.
   *
   * OpenCV itself deliberately stays out of the app's own graph — nothing here imports it,
   * so Turbopack never sees a 10.8MB emscripten bundle. That is the point of running
   * detection in a child process, and importing `@techstark/opencv-js` from a route would
   * quietly undo it.
   */
  outputFileTracingIncludes: {
    "/api/lens": [
      "scripts/detect-face.mjs",
      "lib/lenses/cascades/**/*",
      "public/lenses/**/*",
      "node_modules/@techstark/opencv-js/**/*",
    ],
  },
};

export default nextConfig;
