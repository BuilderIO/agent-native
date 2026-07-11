/**
 * Demo mode gate.
 *
 * Demo mode replaces contact/free-text names, email addresses, and numbers in every action
 * result with deterministic fake data — for both the UI and what the agent
 * sees — while preserving labels, IDs, dates, URLs, and structure so the app
 * keeps working. The redaction WALK (see ./redact.ts) is expensive on large
 * payloads, so callers MUST gate it behind this function and only walk when it
 * returns true.
 *
 * This gate itself is intentionally cheap:
 *   - An env-forced deployment (a hosted demo site) short-circuits with zero
 *     I/O — `DEMO_MODE=true`.
 *   - The per-user runtime toggle lives in `application_state` under the
 *     `demo-mode` key (`{ enabled: boolean }`), written by the settings UI and
 *     the `toggle-demo-mode` agent action. It's read behind a short in-process
 *     TTL cache keyed by user, so a tight agent tool-call loop doesn't hit the
 *     DB on every result.
 */
import { readAppState } from "../application-state/script-helpers.js";

const TTL_MS = 3_000;
const cache = new Map<string, { value: boolean; at: number }>();

/** Deployment-wide force (hosted demo site). Zero cost — no I/O. */
export function isDemoModeForced(): boolean {
  return process.env.DEMO_MODE === "true";
}

/**
 * Whether demo-mode redaction should run for the current request/user.
 * Cheap by design — safe to call before every action result; the expensive
 * walk only happens when this is true.
 */
export async function isDemoModeEnabled(): Promise<boolean> {
  if (isDemoModeForced()) return true;
  try {
    let sessionKey = "_";
    try {
      const { getRequestUserEmail } =
        await import("../server/request-context.js");
      sessionKey = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL ?? "_";
    } catch {
      // request-context unavailable (CLI / non-server) — use default key
    }
    const now = Date.now();
    const hit = cache.get(sessionKey);
    if (hit && now - hit.at < TTL_MS) return hit.value;
    const state = await readAppState("demo-mode");
    const enabled = state?.enabled === true;
    cache.set(sessionKey, { value: enabled, at: now });
    return enabled;
  } catch {
    // No request context / DB unavailable — fail closed (no redaction).
    return false;
  }
}
