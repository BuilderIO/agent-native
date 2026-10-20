import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { track, type TrackingSource } from "@agent-native/core/tracking";

function isActionContext(source: TrackingSource): source is ActionRunContext {
  return (
    typeof source === "object" &&
    source !== null &&
    "caller" in source &&
    typeof (source as { caller?: unknown }).caller === "string"
  );
}

/**
 * Server-side Slides analytics. Funnel steps are derived in the warehouse
 * from these facts, so every event carries the same join keys (run, turn,
 * thread, caller) and is recorded on every occurrence; do not dedupe here.
 */
export function trackSlides(
  name: string,
  properties: Record<string, unknown>,
  source?: TrackingSource,
): void {
  const joinKeys =
    source && isActionContext(source)
      ? {
          ...(source.runId ? { run_id: source.runId } : {}),
          ...(source.turnId ? { turn_id: source.turnId } : {}),
          ...(source.threadId ? { thread_id: source.threadId } : {}),
          caller: source.caller,
        }
      : {};
  // Routes call actions' `run()` without a ctx; attribute those events to the
  // request's user instead of recording them anonymously.
  const requestUserEmail = source ? undefined : getRequestUserEmail();
  try {
    track(
      name,
      {
        ...joinKeys,
        ...properties,
        app_name: "slides",
        template_name: "slides",
      },
      source ?? (requestUserEmail ? { userId: requestUserEmail } : undefined),
    );
  } catch {
    // coercion-ok: analytics is best-effort and must never fail the operation it describes.
  }
}

export function generationAttemptIdOf(
  generationContext: unknown,
): string | undefined {
  if (
    !generationContext ||
    typeof generationContext !== "object" ||
    Array.isArray(generationContext)
  ) {
    return undefined;
  }
  const id = (generationContext as { generationAttemptId?: unknown })
    .generationAttemptId;
  return typeof id === "string" && id ? id : undefined;
}

export function promptLengthBucket(prompt: unknown): string {
  const length = typeof prompt === "string" ? prompt.trim().length : 0;
  if (length === 0) return "0";
  if (length <= 50) return "1-50";
  if (length <= 500) return "50-500";
  return "500+";
}
