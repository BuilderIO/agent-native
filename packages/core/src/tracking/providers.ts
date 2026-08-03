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

import { reshapeTrackedExceptionProperties } from "./posthog-exception.js";
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

interface EnqueueOptions {
  flushImmediately?: boolean;
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
  options?: EnqueueOptions,
): void {
  const queue = getQueue();
  queue.push({ url, body, headers });
  if (options?.flushImmediately || queue.length >= MAX_BATCH_SIZE) {
    void drainQueue();
  } else if (!getTimer()) {
    const timer = setTimeout(() => {
      void drainQueue();
    }, BATCH_INTERVAL_MS);
    if (timer.unref) timer.unref();
    setTimer(timer);
  }
}

function drainQueue(): Promise<void[]> {
  const t = getTimer();
  if (t) {
    clearTimeout(t);
    setTimer(null);
  }
  const queue = getQueue();
  const batch = queue.splice(0, queue.length);
  return Promise.all(
    batch.map((item) =>
      fetch(item.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...item.headers },
        body: item.body,
      }).then(
        () => undefined,
        () => undefined,
      ),
    ),
  );
}

function isLocalhostUrl(value: string | undefined): boolean {
  if (!value || !value.trim()) return false;
  const raw = value.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    const { hostname } = new URL(withProtocol);
    const h = hostname.toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "[::1]" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function shouldSkipAgentNativeAnalyticsForLocalhost(): boolean {
  if (process.env.AGENT_NATIVE_ANALYTICS_ALLOW_LOCALHOST === "true") {
    return false;
  }
  if (process.env.NODE_ENV === "development") return true;
  return [
    process.env.APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.URL,
    process.env.DEPLOY_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ].some(isLocalhostUrl);
}

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.FUNCTION_NAME,
  );
}

function agentNativeAnalyticsFlushesImmediately(): boolean {
  const mode =
    process.env.AGENT_NATIVE_ANALYTICS_FLUSH_MODE?.trim().toLowerCase();
  if (mode === "batch") return false;
  if (mode === "immediate") return true;
  return isServerlessRuntime();
}

// ─── PostHog ───────────────────────────────────────────────────────────────

function isPostHogAiObservabilityEvent(eventName: string): boolean {
  return eventName.startsWith("$ai_");
}

/**
 * `$ai_*` and `$exception` are ingested through PostHog's dedicated endpoint
 * rather than `/capture/`, and `$exception` additionally has to carry
 * `$exception_list` — the framework's own `captureException()` emits camelCase
 * fields that PostHog would otherwise render as an empty, ungroupable issue.
 */
function createPostHogProvider(
  apiKey: string,
  host: string,
  errorTracking: boolean,
): TrackingProvider {
  const sendToEventsEndpoint = (
    event: TrackingEvent,
    properties: Record<string, unknown> | undefined,
    distinctId: string,
  ): void => {
    enqueue(
      `${host}/i/v0/e/`,
      JSON.stringify({
        api_key: apiKey,
        event: event.name,
        properties: {
          distinct_id: distinctId,
          ...properties,
          timestamp: event.timestamp,
        },
      }),
    );
  };

  return {
    name: "posthog",
    track(event: TrackingEvent) {
      const distinctId = event.userId || "anonymous";
      if (isPostHogAiObservabilityEvent(event.name)) {
        sendToEventsEndpoint(event, event.properties, distinctId);
        return;
      }

      if (event.name === "$exception") {
        // `POSTHOG_ERROR_TRACKING=false` keeps product analytics flowing while
        // another backend owns crashes. Drop rather than downgrade to
        // `/capture/`: a malformed exception is what this branch exists to
        // prevent.
        if (!errorTracking) return;
        const reshaped = reshapeTrackedExceptionProperties(event.properties);
        if (reshaped) {
          sendToEventsEndpoint(event, reshaped, distinctId);
          return;
        }
        // No recognizable exception fields. Fall through to `/capture/` so the
        // event is still recorded as-is rather than becoming an issue with
        // nothing in it.
      }

      enqueue(
        `${host}/capture/`,
        JSON.stringify({
          api_key: apiKey,
          event: event.name,
          distinct_id: distinctId,
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
      return drainQueue().then(() => undefined);
    },
  };
}

/**
 * Send one event to PostHog only, bypassing the provider fan-out.
 *
 * For payloads whose *shape* is PostHog-specific and whose *content* other
 * backends must not receive. `track()` broadcasts to every configured provider,
 * so a PostHog-only integration (e.g. enabling a survey id) would otherwise
 * start exporting that integration's content — including user-authored text —
 * to Mixpanel, Amplitude, webhooks, and Agent Native Analytics as a side
 * effect nobody opted into.
 *
 * Returns `false` when PostHog is not configured, so callers can tell "not
 * sent" from "sent".
 */
export function sendPostHogEvent(
  name: string,
  properties: Record<string, unknown>,
  distinctId: string,
): boolean {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return false;
  const host = (process.env.POSTHOG_HOST || POSTHOG_DEFAULT_HOST).replace(
    /\/+$/,
    "",
  );
  enqueue(
    `${host}/capture/`,
    JSON.stringify({
      api_key: apiKey,
      event: name,
      distinct_id: distinctId,
      properties: { ...properties, timestamp: new Date().toISOString() },
    }),
  );
  return true;
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
      return drainQueue().then(() => undefined);
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
      return drainQueue().then(() => undefined);
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
      return drainQueue().then(() => undefined);
    },
  };
}

// ─── Agent Native Analytics ───────────────────────────────────────────────

function createAgentNativeAnalyticsProvider(
  publicKey: string,
  endpoint: string,
): TrackingProvider {
  const flushImmediately = agentNativeAnalyticsFlushesImmediately();
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
          anonymousId: event.anonymousId,
          timestamp: event.timestamp,
        }),
        undefined,
        { flushImmediately },
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
        undefined,
        { flushImmediately },
      );
    },
    flush: () => {
      return drainQueue().then(() => undefined);
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
    registerTrackingProvider(
      createPostHogProvider(
        posthogKey,
        host,
        process.env.POSTHOG_ERROR_TRACKING?.trim().toLowerCase() !== "false",
      ),
    );
  }

  const mixpanelToken = process.env.MIXPANEL_TOKEN;
  if (mixpanelToken) {
    registerTrackingProvider(createMixpanelProvider(mixpanelToken));
  }

  const amplitudeKey = process.env.AMPLITUDE_API_KEY;
  if (amplitudeKey) {
    registerTrackingProvider(createAmplitudeProvider(amplitudeKey));
  }

  const agentNativeAnalyticsKey =
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY ||
    process.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (
    agentNativeAnalyticsKey &&
    !shouldSkipAgentNativeAnalyticsForLocalhost()
  ) {
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
