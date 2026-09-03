import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `.mts`, not `.ts`: this package is CommonJS (Next's postcss and eslint configs
// rely on that), and Vite's native config loader warns about ESM syntax in a
// file it has to load as CJS. The extension settles it without touching the rest.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` throws on import outside an RSC build. The tests here cover
      // pure logic from server modules, so the guard is stubbed out.
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
