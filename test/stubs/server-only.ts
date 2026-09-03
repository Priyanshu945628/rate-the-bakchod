/**
 * `server-only` throws when imported outside a React Server Component build.
 * Vitest is neither, so it is aliased to this empty module (see vitest.config.ts)
 * — the guard exists to protect the client bundle, and tests are not that.
 */
export {};
