---
name: tracking
description: >-
  Server-side analytics tracking with pluggable providers. Use when adding
  analytics events, registering custom tracking providers, or configuring
  built-in providers (PostHog, Mixpanel, Amplitude, Webhook).
---

# Tracking

## Rule

The tracking system provides a single `track()` call that fans out to all registered providers. Built-in providers auto-register from env vars -- set the var and tracking starts. Custom providers can be registered for any analytics backend. Tracking is server-side only, best-effort, and never blocks request handling.

## How It Works

1. At server startup, `registerBuiltinProviders()` checks env vars and registers any configured providers.
2. Application code calls `track(eventName, properties, meta)` from actions, plugins, or server routes.
3. The registry fans out the event to every registered provider. Errors are caught and logged -- a failing provider never crashes the caller.
4. Built-in providers batch HTTP calls (flush every 10 seconds or 50 events, whichever comes first).

## API

### `track(name, properties?, meta?)`

Fire an analytics event.

```ts
import { track } from "@agent-native/core/tracking";

track("meal.logged", { mealName: "Salad", calories: 350 }, { userId: "steve@builder.io" });
```

### `identify(userId, traits?)`

Identify a user with traits. Forwarded to providers that support it.

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

### `registerTrackingProvider(provider)`

Register a custom provider.

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
  },
  identify(userId, traits) {
    // Optional
  },
  flush() {
    // Optional -- called on graceful shutdown
  },
});
```

### `flushTracking()`

Flush all providers (call before process exit).

## Built-in Providers

Set the env var and the provider auto-registers at startup. No SDK dependencies -- all providers use raw HTTP.

| Provider   | Env vars                                                  |
| ---------- | --------------------------------------------------------- |
| PostHog    | `POSTHOG_API_KEY` (required), `POSTHOG_HOST` (optional, defaults to `https://us.i.posthog.com`) |
| Mixpanel   | `MIXPANEL_TOKEN`                                          |
| Amplitude  | `AMPLITUDE_API_KEY`                                       |
| Agent Native Analytics | `AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` (server), `AGENT_NATIVE_ANALYTICS_ENDPOINT` (optional, defaults to `https://analytics.agent-native.com/track`) |
| Webhook    | `TRACKING_WEBHOOK_URL` (required), `TRACKING_WEBHOOK_AUTH` (optional, sent as `Authorization` header) |

Multiple providers can be active simultaneously. All receive every event.

Browser-side `trackEvent()` also forwards to Agent Native Analytics when `VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` is present. Use `VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT` to override the default browser endpoint. The built-in Agent Native Analytics sender is quiet on localhost/local dev by default; set `AGENT_NATIVE_ANALYTICS_ALLOW_LOCALHOST=true` only for an intentional local ingestion test.

## Provider Interface

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  flush?(): void | Promise<void>;
}

interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
}
```

## Design Decisions

- **globalThis singleton** -- the registry uses a `Symbol.for` key on globalThis so multiple ESM graph instances (dev-mode Vite + Nitro, symlinks) share one provider set.
- **Best-effort fan-out** -- provider errors are caught and logged, never propagated. A broken analytics integration must not break app functionality.
- **Batched HTTP** -- built-in providers enqueue events and flush every 10 seconds or 50 events, minimizing outbound requests.
- **NOT bridged to the event bus** -- tracking and the event bus are separate concerns. The event bus is for triggering automations; tracking is for analytics. Do not subscribe to `track()` calls from the event bus or vice versa.

## Key Files

| File                                           | Purpose                                     |
| ---------------------------------------------- | ------------------------------------------- |
| `packages/core/src/tracking/registry.ts`       | `track()`, `identify()`, `registerTrackingProvider()`, `flushTracking()` |
| `packages/core/src/tracking/providers.ts`      | Built-in providers (PostHog, Mixpanel, Amplitude, Agent Native Analytics, Webhook) and `registerBuiltinProviders()` |
| `packages/core/src/tracking/types.ts`          | `TrackingEvent` and `TrackingProvider` interfaces |

## Related Skills

- `secrets` -- API keys for tracking providers can be registered as secrets
- `server-plugins` -- `registerBuiltinProviders()` is called by the core-routes plugin at startup
- `actions` -- call `track()` from action handlers to record user/agent activity
