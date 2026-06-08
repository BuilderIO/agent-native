import { agentNativePath } from "./api-path.js";

/**
 * Fire an analytics event from browser/app code. This is the client-side twin
 * of the server `track()` from `@agent-native/core/tracking`: it POSTs to the
 * `/_agent-native/track` framework route, which forwards the event to the SAME
 * registered server-side providers (PostHog, Mixpanel, Amplitude, webhook,
 * etc.). The event is attributed server-side to the signed-in user (and active
 * org) — callers do not pass an identity.
 *
 * ```ts
 * import { track } from "@agent-native/core/client";
 *
 * track("checkout.completed", { total: 49.99, items: 3 });
 * ```
 *
 * Fire-and-forget by design: it never blocks the UI, never throws, and
 * swallows network errors. The returned promise resolves once the request
 * settles (useful in tests) but does not reject.
 *
 * This is intentionally distinct from the framework's internal browser
 * analytics (`trackEvent` / pageview tracking in `analytics.ts`), which feeds
 * Agent Native's own product telemetry. Use `track()` for your app's own
 * analytics events.
 */
export function track(
  name: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (typeof fetch !== "function") return Promise.resolve();
  if (typeof name !== "string" || !name.trim()) return Promise.resolve();

  let body: string;
  try {
    body = JSON.stringify(
      properties === undefined ? { name } : { name, properties },
    );
  } catch {
    // Non-serializable properties — drop rather than throw into the caller.
    return Promise.resolve();
  }

  return fetch(agentNativePath("/_agent-native/track"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Custom header forces a preflight cross-origin; the framework CSRF
      // middleware trusts it as a first-party marker. Matches the convention
      // used by other client writes (application-state, guided-questions).
      "X-Agent-Native-CSRF": "1",
    },
    body,
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
