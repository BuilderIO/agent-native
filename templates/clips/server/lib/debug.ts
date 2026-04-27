/**
 * Verbose-log gating. Enable with `DEBUG=true` (or `DEBUG=1`) — and
 * `CLIPS_DEBUG=true` works too if you want to scope it. Errors and one-time
 * startup messages stay on `console.error`/`console.warn` directly; per-chunk,
 * per-finalize chatter goes through `debugLog` so it stays quiet by default.
 */

const truthy = (v: string | undefined) => v === "1" || v === "true";
const enabled = truthy(process.env.DEBUG) || truthy(process.env.CLIPS_DEBUG);

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
