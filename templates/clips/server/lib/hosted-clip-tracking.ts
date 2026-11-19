import { track } from "@agent-native/core/tracking";

/** Analytics is best-effort and must never fail a user path; a failure is logged. */
export function trackHostedClipEvent(
  name: string,
  props: Record<string, unknown>,
  context?: { authUserId: string },
): void {
  try {
    track(
      name,
      { app_name: "clips", template_name: "clips", ...props },
      context,
    );
  } catch (error) {
    // coercion-ok: analytics is best-effort and must never fail a user path; the failure is logged.
    console.warn("[clips-hosted] tracking failed", {
      event: name,
      error: error instanceof Error ? error.message : "non-Error thrown",
    });
  }
}
