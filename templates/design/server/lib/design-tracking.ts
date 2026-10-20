import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { track, type TrackingSource } from "@agent-native/core/tracking";

export const DESIGN_CREATION_METHODS = [
  "blank",
  "prompt",
  "template",
  "duplicate",
  "context_clone",
  "import_figma",
  "import_url",
  "import_analytics",
  "agent",
] as const;

export type DesignCreationMethod = (typeof DESIGN_CREATION_METHODS)[number];

export type DesignGenerationPath = "generate_design" | "variants" | "screens";

function isActionContext(source: TrackingSource): source is ActionRunContext {
  return (
    typeof source === "object" &&
    source !== null &&
    "caller" in source &&
    typeof (source as { caller?: unknown }).caller === "string"
  );
}

/**
 * True only for a request the Design UI sent. Agent tool calls, MCP, A2A and
 * automations read and write the same actions, so counting them as a person's
 * view or export would inflate every human funnel step.
 */
export function isHumanCaller(source: TrackingSource | undefined): boolean {
  return Boolean(
    source && isActionContext(source) && source.caller === "frontend",
  );
}

/**
 * Server-side Design analytics. Funnel steps are derived in the warehouse from
 * these facts, so every event carries the same join keys (run, turn, thread,
 * caller) and is recorded on every occurrence unless its contract says
 * otherwise. Tracking runs after the write it describes has committed, so it
 * must never throw.
 */
export function trackDesign(
  name: string,
  properties: Record<string, unknown>,
  source?: TrackingSource,
): void {
  try {
    const joinKeys =
      source && isActionContext(source)
        ? {
            ...(source.runId ? { run_id: source.runId } : {}),
            ...(source.turnId ? { turn_id: source.turnId } : {}),
            ...(source.threadId ? { thread_id: source.threadId } : {}),
            caller: source.caller,
          }
        : {};
    // Routes call actions' `run()` without a ctx; attribute those events to
    // the request's user instead of recording them anonymously.
    const requestUserEmail = source ? undefined : getRequestUserEmail();
    track(
      name,
      {
        ...joinKeys,
        ...properties,
        app_name: "design",
        template_name: "design",
      },
      source ?? (requestUserEmail ? { userId: requestUserEmail } : undefined),
    );
  } catch {
    // coercion-ok: analytics is best-effort and must never fail the operation it describes.
  }
}

export function trackingErrorType(error: unknown): string {
  if (error && typeof error === "object") {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return `http_${status}`;
    if ((error as { name?: unknown }).name === "AbortError") return "cancelled";
  }
  return "error";
}
