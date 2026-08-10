import type { ActionRunContext } from "../action.js";
import { getRequestContext } from "../server/request-context.js";
import type { TrackingProvider, TrackingEvent } from "./types.js";

const REGISTRY_KEY = Symbol.for("@agent-native/core/tracking.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, TrackingProvider>;
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
  };
}

export function track(
  name: string,
  properties?: Record<string, unknown>,
  source?: TrackingSource,
): void {
  const { userId, anonymousId, sessionId } = resolveTrackingSource(source);
  const event: TrackingEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
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
