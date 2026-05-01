/**
 * Built-in tracking providers that auto-register from env vars.
 *
 * No SDK dependencies — uses raw HTTP to keep core lightweight.
 * Set the env var and tracking starts automatically.
 *
 * POSTHOG_API_KEY + POSTHOG_HOST  → PostHog
 * MIXPANEL_TOKEN                  → Mixpanel
 * AMPLITUDE_API_KEY               → Amplitude
 * AGENT_NATIVE_ANALYTICS_PUBLIC_KEY → Agent Native Analytics
 *
 * Call `registerBuiltinProviders()` at server startup (done
 * automatically by the core-routes plugin).
 */

import { registerTrackingProvider } from "./registry.js";
import type { TrackingProvider, TrackingEvent } from "./types.js";

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";
const AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT =
  "https://analytics.agent-native.com/track";
const BATCH_INTERVAL_MS = 10_000;
const MAX_BATCH_SIZE = 50;

// ─── Batched sender ────────────────────────────────────────────────────────

interface QueuedEvent {
  url: string;
  body: string;
  headers?: Record<string, string>;
}

// Use globalThis so multiple ESM graph instances (Vite dev + Nitro symlinks)
// share one queue, matching the same pattern as the tracking registry.
const QUEUE_KEY = Symbol.for("@agent-native/core/tracking.queue");
const TIMER_KEY = Symbol.for("@agent-native/core/tracking.timer");

interface GlobalWithQueue {
  [QUEUE_KEY]?: QueuedEvent[];
  [TIMER_KEY]?: ReturnType<typeof setTimeout> | null;
}

function getQueue(): QueuedEvent[] {
  const g = globalThis as unknown as GlobalWithQueue;
  if (!g[QUEUE_KEY]) g[QUEUE_KEY] = [];
  return g[QUEUE_KEY]!;
}

function getTimer(): ReturnType<typeof setTimeout> | null {
  const g = globalThis as unknown as GlobalWithQueue;
  return g[TIMER_KEY] ?? null;
}

function setTimer(t: ReturnType<typeof setTimeout> | null): void {
  (globalThis as unknown as GlobalWithQueue)[TIMER_KEY] = t;
}

function enqueue(
  url: string,
  body: string,
  headers?: Record<string, string>,
): void {
  const queue = getQueue();
  queue.push({ url, body, headers });
  if (queue.length >= MAX_BATCH_SIZE) {
    drainQueue();
  } else if (!getTimer()) {
    setTimer(setTimeout(drainQueue, BATCH_INTERVAL_MS));
  }
}

function drainQueue(): void {
  const t = getTimer();
  if (t) {
    clearTimeout(t);
    setTimer(null);
  }
  const queue = getQueue();
  const batch = queue.splice(0, queue.length);
  for (const item of batch) {
    fetch(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...item.headers },
      body: item.body,
    }).catch(() => {});
  }
}

// ─── PostHog ───────────────────────────────────────────────────────────────

function createPostHogProvider(apiKey: string, host: string): TrackingProvider {
  return {
    name: "posthog",
    track(event: TrackingEvent) {
      enqueue(
        `${host}/capture/`,
        JSON.stringify({
          api_key: apiKey,
          event: event.name,
          distinct_id: event.userId || "anonymous",
          properties: {
            ...event.properties,
            timestamp: event.timestamp,
          },
        }),
      );
    },
    identify(userId, traits) {
      enqueue(
        `${host}/capture/`,
        JSON.stringify({
          api_key: apiKey,
          event: "$identify",
          distinct_id: userId,
          properties: { $set: traits },
        }),
      );
    },
    flush: () => {
      drainQueue();
      return Promise.resolve();
    },
  };
}

// ─── Mixpanel ──────────────────────────────────────────────────────────────

function createMixpanelProvider(token: string): TrackingProvider {
  return {
    name: "mixpanel",
    track(event: TrackingEvent) {
      const data = {
        event: event.name,
        properties: {
          token,
          distinct_id: event.userId || "anonymous",
          time: event.timestamp
            ? new Date(event.timestamp).getTime() / 1000
            : undefined,
          ...event.properties,
        },
      };
      enqueue("https://api.mixpanel.com/track", JSON.stringify([data]));
    },
    identify(userId, traits) {
      const data = {
        $token: token,
        $distinct_id: userId,
        $set: traits,
      };
      enqueue("https://api.mixpanel.com/engage", JSON.stringify([data]));
    },
    flush: () => {
      drainQueue();
      return Promise.resolve();
    },
  };
}

// ─── Amplitude ─────────────────────────────────────────────────────────────

function createAmplitudeProvider(apiKey: string): TrackingProvider {
  return {
    name: "amplitude",
    track(event: TrackingEvent) {
      const data = {
        api_key: apiKey,
        events: [
          {
            event_type: event.name,
            user_id: event.userId || "anonymous",
            event_properties: event.properties,
            time: event.timestamp
              ? new Date(event.timestamp).getTime()
              : undefined,
          },
        ],
      };
      enqueue("https://api2.amplitude.com/2/httpapi", JSON.stringify(data));
    },
    identify(userId, traits) {
      const data = {
        api_key: apiKey,
        events: [
          {
            event_type: "$identify",
            user_id: userId,
            user_properties: { $set: traits },
          },
        ],
      };
      enqueue("https://api2.amplitude.com/2/httpapi", JSON.stringify(data));
    },
    flush: () => {
      drainQueue();
      return Promise.resolve();
    },
  };
}

// ─── Webhook (custom HTTP endpoint) ───────────────────────────────────────

function createWebhookProvider(
  url: string,
  authHeader?: string,
): TrackingProvider {
  const extra = authHeader ? { Authorization: authHeader } : undefined;
  return {
    name: "webhook",
    track(event: TrackingEvent) {
      enqueue(
        url,
        JSON.stringify({
          event: event.name,
          properties: event.properties,
          userId: event.userId,
          timestamp: event.timestamp,
        }),
        extra,
      );
    },
    identify(userId, traits) {
      enqueue(
        url,
        JSON.stringify({
          event: "$identify",
          userId,
          traits,
          timestamp: new Date().toISOString(),
        }),
        extra,
      );
    },
    flush: () => {
      drainQueue();
      return Promise.resolve();
    },
  };
}

// ─── Agent Native Analytics ───────────────────────────────────────────────

function createAgentNativeAnalyticsProvider(
  publicKey: string,
  endpoint: string,
): TrackingProvider {
  return {
    name: "agent-native-analytics",
    track(event: TrackingEvent) {
      enqueue(
        endpoint,
        JSON.stringify({
          publicKey,
          event: event.name,
          properties: event.properties ?? {},
          userId: event.userId,
          timestamp: event.timestamp,
        }),
      );
    },
    identify(userId, traits) {
      enqueue(
        endpoint,
        JSON.stringify({
          publicKey,
          event: "$identify",
          userId,
          properties: traits ?? {},
          timestamp: new Date().toISOString(),
        }),
      );
    },
    flush: () => {
      drainQueue();
      return Promise.resolve();
    },
  };
}

// ─── Auto-registration ────────────────────────────────────────────────────

let _registered = false;

export function registerBuiltinProviders(): void {
  if (_registered) return;
  _registered = true;

  const posthogKey = process.env.POSTHOG_API_KEY;
  if (posthogKey) {
    const host = (process.env.POSTHOG_HOST || POSTHOG_DEFAULT_HOST).replace(
      /\/+$/,
      "",
    );
    registerTrackingProvider(createPostHogProvider(posthogKey, host));
  }

  const mixpanelToken = process.env.MIXPANEL_TOKEN;
  if (mixpanelToken) {
    registerTrackingProvider(createMixpanelProvider(mixpanelToken));
  }

  const amplitudeKey = process.env.AMPLITUDE_API_KEY;
  if (amplitudeKey) {
    registerTrackingProvider(createAmplitudeProvider(amplitudeKey));
  }

  const agentNativeAnalyticsKey = process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (agentNativeAnalyticsKey) {
    registerTrackingProvider(
      createAgentNativeAnalyticsProvider(
        agentNativeAnalyticsKey,
        (
          process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT ||
          AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT
        ).replace(/\/+$/, ""),
      ),
    );
  }

  const webhookUrl = process.env.TRACKING_WEBHOOK_URL;
  if (webhookUrl) {
    registerTrackingProvider(
      createWebhookProvider(webhookUrl, process.env.TRACKING_WEBHOOK_AUTH),
    );
  }
}
