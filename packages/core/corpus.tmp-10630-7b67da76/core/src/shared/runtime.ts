/**
 * Runtime detection utilities.
 *
 * Detect whether the code is running in Node.js, Cloudflare Workers,
 * Deno, or another edge runtime. Used to gracefully skip Node-only
 * features (filesystem, PTY, file watching) on edge runtimes.
 */

/** True when running in a full Node.js environment (not CF Workers, not Deno). */
export function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string" &&
    !("__cf_env" in globalThis) &&
    !("Deno" in globalThis)
  );
}

/** True when running in Cloudflare Workers/Pages. */
export function isCloudflareRuntime(): boolean {
  return (
    "__cf_env" in globalThis ||
    (typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers")
  );
}

/** True when running in any edge/serverless runtime (not full Node.js). */
export function isEdgeRuntime(): boolean {
  return !isNodeRuntime();
}
