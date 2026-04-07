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
    typeof (globalThis as any).__cf_env === "undefined" &&
    typeof (globalThis as any).Deno === "undefined"
  );
}

/** True when running in Cloudflare Workers/Pages. */
export function isCloudflareRuntime(): boolean {
  return (
    typeof (globalThis as any).__cf_env !== "undefined" ||
    (typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers")
  );
}

/** True when running in any edge/serverless runtime (not full Node.js). */
export function isEdgeRuntime(): boolean {
  return !isNodeRuntime();
}
