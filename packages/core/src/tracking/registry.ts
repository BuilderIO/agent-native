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

export function track(
  name: string,
  properties?: Record<string, unknown>,
  meta?: { userId?: string },
): void {
  const event: TrackingEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
    userId: meta?.userId,
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
