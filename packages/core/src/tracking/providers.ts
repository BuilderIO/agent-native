/**
 * Built-in tracking providers that auto-register from env vars.
 *
 * No SDK dependencies — uses raw HTTP to keep core lightweight.
 * Set the env var and tracking starts automatically.
 *
 * POSTHOG_API_KEY + POSTHOG_HOST  → PostHog
 * MIXPANEL_TOKEN                  → Mixpanel
 * AMPLITUDE_API_KEY               → Amplitude
 *
 * Call `registerBuiltinProviders()` at server startup (done
 * automatically by the core-routes plugin).
 */

import { registerTrackingProvider } from "./registry.js";
import type { TrackingProvider, TrackingEvent } from "./types.js";

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";
const BATCH_INTERVAL_MS = 10_000;
const MAX_BATCH_SIZE = 50;

// ─── Batched sender ────────────────────────────────────────────────────────

interface QueuedEvent {
  url: string;
  body: string;
}

let _queue: QueuedEvent[] = [];
let _timer: ReturnType<typeof setTimeout> | null = null;

function enqueue(url: string, body: string): void {
  _queue.push({ url, body });
  if (_queue.length >= MAX_BATCH_SIZE) {
    drainQueue();
  } else if (!_timer) {
    _timer = setTimeout(drainQueue, BATCH_INTERVAL_MS);
  }
}

function drainQueue(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  const batch = _queue;
  _queue = [];
  for (const item of batch) {
    fetch(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
}
