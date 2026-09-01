import type { ActionRunContext } from "../action.js";
import { resolveDeployEnvironment } from "../server/deploy-environment.js";
import { getRequestContext } from "../server/request-context.js";
import { ANALYTICS_CLIENT_PLATFORM_PROPERTY } from "../shared/analytics-platform.js";
import { isQaTestEmail } from "../shared/qa-test-email.js";
import type { TrackingProvider, TrackingEvent } from "./types.js";

export { isQaTestEmail } from "../shared/qa-test-email.js";

const REGISTRY_KEY = Symbol.for("@agent-native/core/tracking.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, TrackingProvider>;
}

function isTrackingSuppressed(
  userId: string | undefined,
  properties?: Record<string, unknown>,
): boolean {
  return (
    getRequestContext()?.isSyntheticTraffic === true ||
    isQaTestEmail(userId) ||
    isQaTestEmail(properties?.email) ||
    isQaTestEmail(properties?.userEmail)
  );
}

function getRegistry(): Map<string, TrackingProvider> {
  const g = globalThis as unknown as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

export function registerTrackingProvider(provider: TrackingProvider): void {
  if (!provider?.name) {
    throw new Error("registerTrackingProvider: provider.name is required");
  }
  if (typeof provider.track !== "function") {
    throw new Error(
      "registerTrackingProvider: provider.track must be a function",
    );
  }
  getRegistry().set(provider.name, provider);
}

export function unregisterTrackingProvider(name: string): boolean {
  return getRegistry().delete(name);
}

export function listTrackingProviders(): string[] {
  return Array.from(getRegistry().keys());
}

export interface TrackingMeta {
  userId?: string;
  anonymousId?: string;
  /** Overrides the ambient request's browser session. */
  sessionId?: string;
  /**
   * When the event actually happened, in epoch ms. Defaults to now.
   *
   * Needed by callers that buffer and flush a batch of events at the end of a
   * unit of work — an agent run emits its trace, generation, and tool spans in
   * one burst, and stamping all of them with the flush time collapses a
   * multi-second waterfall into a single instant. PostHog orders an LLM trace
   * tree by event timestamp, so without this the tree renders with a synthetic
   * timeline.
   */
  occurredAt?: number;
}

/**
 * Who an event is attributed to. Pass an action's `ctx` straight through —
 * `track("project_created", { template }, ctx)` — instead of restating
 * `{ userId: ctx.userEmail }` at every call site.
 */
export type TrackingSource = TrackingMeta | ActionRunContext;

// `caller` is required on ActionRunContext and absent from TrackingMeta, so it
// is the one field that tells the two apart without the caller declaring which
// shape it passed.
function isActionRunContext(
  source: TrackingSource,
): source is ActionRunContext {
  return typeof (source as ActionRunContext).caller === "string";
}

function resolveTrackingSource(source: TrackingSource | undefined): {
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  occurredAt?: number;
} {
  // The browser session rides the request, not the caller's arguments, so it
  // resolves the same way whether the UI called the action or the agent did.
  const ambientSessionId = getRequestContext()?.browserSessionId;
  if (!source) return { sessionId: ambientSessionId };
  if (isActionRunContext(source)) {
    return { userId: source.userEmail, sessionId: ambientSessionId };
  }
  return {
    userId: source.userId,
    anonymousId: source.anonymousId,
    sessionId: source.sessionId ?? ambientSessionId,
    occurredAt: source.occurredAt,
  };
}

export function track(
  name: string,
  properties?: Record<string, unknown>,
  source?: TrackingSource,
): void {
  const { userId, anonymousId, sessionId, occurredAt } =
    resolveTrackingSource(source);
  if (isTrackingSuppressed(userId, properties)) return;
  const clientPlatform = getRequestContext()?.clientPlatform;
  const trackedProperties = {
    ...(properties ?? {}),
    deployment_environment: resolveDeployEnvironment(),
    ...(clientPlatform
      ? { [ANALYTICS_CLIENT_PLATFORM_PROPERTY]: clientPlatform }
      : {}),
  };
  const event: TrackingEvent = {
    name,
    properties: trackedProperties,
    // A caller-supplied `occurredAt` of 0 is not a real event time, so `||`
    // rather than `??` is deliberate here.
    timestamp: new Date(occurredAt || Date.now()).toISOString(),
    userId,
    anonymousId,
    sessionId,
  };

  for (const provider of getRegistry().values()) {
    try {
      const result = provider.track(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(
            `[tracking] Provider "${provider.name}" rejected:`,
            err,
          );
        });
      }
    } catch (err) {
      console.error(`[tracking] Provider "${provider.name}" threw:`, err);
    }
  }
}

export function identify(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  if (isTrackingSuppressed(userId, traits)) return;
  for (const provider of getRegistry().values()) {
    if (!provider.identify) continue;
    try {
      const result = provider.identify(userId, traits);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // best-effort
    }
  }
}

export function flushTracking(): Promise<void[]> {
  const promises: Promise<void>[] = [];
  for (const provider of getRegistry().values()) {
    if (!provider.flush) continue;
    try {
      const result = provider.flush();
      if (result) {
        promises.push(
          result.catch((err) => {
            console.error(
              `[tracking] Provider "${provider.name}" flush rejected:`,
              err,
            );
          }),
        );
      }
    } catch (err) {
      console.error(`[tracking] Provider "${provider.name}" flush threw:`, err);
      // best-effort
    }
  }
  return Promise.all(promises);
}
