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

  experimental: {
    /**
     * Room for a real upload to survive the proxy.
     *
     * Because `proxy.ts` exists and matches `/api/posts`, Next clones every request
     * body so the proxy and the route handler can each read it. The clone is capped,
     * and the default cap is 10MB — but a body over it is not refused. The clone is
     * cut off at the limit and EOF is pushed into it (`server/body-streams.js`), so
     * the handler is handed a multipart body that stops mid-part and
     * `request.formData()` throws a bare `TypeError`. That is how an 11MB video came
     * back as "Something broke on our side. (TypeError)" from a composer advertising
     * 100MB.
     *
     * Keep this above `limits.maxUploadBytes` in `lib/config.ts` plus multipart
     * framing. The cost is memory rather than disk: the clone is buffered, so a
     * full-size upload holds its own copy here on top of the ones the handler makes
     * while decoding it.
     */
    proxyClientMaxBodySize: "104mb",
  },
};

export default nextConfig;
