// Pure decision logic for the agent-native CLI launcher shim, kept dependency
// free so it can be unit tested without touching the filesystem.
//
// The tsx source fallback and mtime freshness check exist for local monorepo
// development only. Published installs ship both src and dist, and tarball
// extraction can leave .ts files newer than .js — that must never route to tsx
// (not a runtime dependency), or `npx @agent-native/core ...` fails with
// `spawn tsx ENOENT`. The `isSourceCheckout` gate is what keeps installed
// packages on the shipped dist build.

/**
 * @param {object} input
 * @param {boolean} input.isSourceCheckout Whether we run from a monorepo checkout.
 * @param {boolean} input.sourceEntryExists Whether the .ts CLI entry exists.
 * @param {boolean} input.distEntryExists Whether the compiled .js CLI entry exists.
 * @param {Array<{sourceExists: boolean, distExists: boolean, sourceMtimeMs: number, distMtimeMs: number}>} [input.freshness]
 * @returns {boolean}
 */
export function shouldUseSourceFallback({
  isSourceCheckout,
  sourceEntryExists,
  distEntryExists,
  freshness = [],
}) {
  if (!isSourceCheckout) return false;
  if (!sourceEntryExists) return false;
  if (!distEntryExists) return true;
  return freshness.some(
    (pair) =>
      pair.sourceExists &&
      pair.distExists &&
      pair.sourceMtimeMs > pair.distMtimeMs,
  );
}
