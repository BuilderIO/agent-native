
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

/** @param {string} version */
export function supportsNodeVersion(version) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 22);
}
