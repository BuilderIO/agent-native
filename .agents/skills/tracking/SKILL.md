---
name: tracking
description: >-
  Server-side analytics tracking with pluggable providers. Use when adding
  analytics events, registering custom tracking providers, or configuring
  built-in providers (PostHog, Mixpanel, Amplitude, Webhook).
scope: dev
metadata:
  internal: true
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

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "user@example.com" },
);
```

### `identify(userId, traits?)`

Identify a user with traits. Forwarded to providers that support it.

```ts
import { identify } from "@agent-native/core/tracking";

identify("user@example.com", { plan: "pro", company: "ExampleCo" });
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

| Provider               | Env vars                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostHog                | `POSTHOG_API_KEY` (required), `POSTHOG_HOST` (optional, defaults to `https://us.i.posthog.com`)                                                    |
| Mixpanel               | `MIXPANEL_TOKEN`                                                                                                                                   |
| Amplitude              | `AMPLITUDE_API_KEY`                                                                                                                                |
| Agent Native Analytics | `AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` (server), `AGENT_NATIVE_ANALYTICS_ENDPOINT` (optional, defaults to `https://analytics.agent-native.com/track`) |
| Webhook                | `TRACKING_WEBHOOK_URL` (required), `TRACKING_WEBHOOK_AUTH` (optional, sent as `Authorization` header)                                              |

Multiple providers can be active simultaneously. All receive every event.

Browser-side `trackEvent()` also forwards to Agent Native Analytics when `VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY` is present. Use `VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT` to override the default browser endpoint. The built-in Agent Native Analytics sender is quiet on localhost/local dev by default; set `AGENT_NATIVE_ANALYTICS_ALLOW_LOCALHOST=true` only for an intentional local ingestion test.

## Default Baseline Events

Template roots call `configureTracking()` once during app startup. That installs default browser pageview tracking for hosted apps:

- Event: `pageview`
- Fires on initial load, `history.pushState`, `history.replaceState`, and `popstate`
- De-dupes repeated events for the same URL
- Includes `url`, `path`, `hostname`, `referrer`, `title`, `navigation_type`, `app`, and inferred `template`
- Includes LLM connection context on browser events when known: `llm_connection` (`builder`, `anthropic`, `openai`, etc.), `llm_engine`, `llm_model`, `llm_connection_source`, and `llm_connection_configured`
- Does not send first-party events from localhost/local dev

### Visitor identity (`anonymousId` + `sessionId`)

Every browser-side `trackEvent()` POST to the Agent Native Analytics `/track` endpoint includes:

- `anonymousId` — persistent per-browser visitor ID stored in `localStorage` under `agent-native.anonymous_id`. Generated once and reused across sessions. Use this for unique-visitor and returning-visitor metrics.
- `sessionId` — rotating per-visit ID stored in `localStorage` under `agent-native.session_id`, with a 30-minute idle timeout (matches GA4 / Mixpanel defaults). Use this for sessions-per-visitor, pages-per-session, and session-duration metrics.
- `userId` — only set when the calling code passes `properties.userId`. Anonymous traffic leaves this NULL by design; `anonymousId` is the fallback.

These fields land in the `analytics_events.anonymous_id`, `analytics_events.session_id`, and `analytics_events.user_id` columns in the analytics template. Storage access is wrapped in try/catch — private-browsing / blocked-storage clients silently degrade to NULL rather than crashing the page.

### Referral / viral attribution (first-touch)

`configureTracking()` also captures an anonymous visitor's **first-touch** referral context once, on first page load, and persists it across the signup boundary so the server-side `signup` event records where the user came from. This powers virality metrics for every template (Clips share links, Plans public pages, etc.).

**Share-link params** (set by whatever generates the link; read client-side only):

- `ref` — referral source bucket, e.g. `clip_share`, `plan_share`
- `via` — the referrer's stable user id (the clip/plan owner)
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`

**Client persistence** (first-write-wins — an existing value is never overwritten):

- `localStorage` key `an_attribution` and first-party cookie `an_ft` (`path=/; max-age=2592000; SameSite=Lax`, not HttpOnly — non-sensitive, written by client JS).
- Both store the same URL-encoded compact JSON (empty fields omitted, each value capped at 120 chars): `{ ref, via, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, landing_referrer, landed_at }`. `landing_referrer` is the **host only** of `document.referrer` (scrubbed; same-origin referrers are dropped).
- `getFirstTouchAttribution()` (from `@agent-native/core/client`) returns the parsed object or `null`.

**Signup event enrichment** (server-side, from the `an_ft` cookie on the signup/OAuth-callback request, derived in `packages/core/src/server/attribution.ts`):

- `referral_source` — `ref` if present, else derived: `/share/…` → `clip_share`; a plan public path (`/p/`, `/plan/`, `/share-plan/`) → `plan_share`; a non-empty external referring host → `external`; otherwise `direct`.
- `referrer_user` (= `via`), `referral_medium` (= `utm_medium`), `referral_campaign` (= `utm_campaign`)
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` (raw passthrough)
- `first_touch_path` (= `landing_path`), `landing_referrer`

Attribution parsing is fully defensive and never blocks signup — a missing/malformed cookie falls back to `referral_source: "direct"`.

Other framework-level baseline events:

- `session status` from `useSession()`, with `signed_in`
- `signup` from Better Auth user creation, with `auth_provider`, `auth_user_id`, and first-touch referral attribution (`referral_source`, `referrer_user`, `referral_medium`, `referral_campaign`, `utm_*`, `first_touch_path`, `landing_referrer` — see "Referral / viral attribution" above)
- `builder connect clicked` and `builder connect popup blocked` from browser Connect Builder CTAs
- `builder connect started`, `builder connect succeeded`, `builder connect failed`, `builder disconnect succeeded`, and `builder disconnect failed` from the Builder connection routes, with LLM connection context when resolvable

For new lifecycle events, call `track()` server-side when the server is the source of truth, and `trackEvent()` client-side only for browser interactions.

## Provider Interface

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
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

| File                                      | Purpose                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tracking/registry.ts`  | `track()`, `identify()`, `registerTrackingProvider()`, `flushTracking()`                                            |
| `packages/core/src/tracking/providers.ts` | Built-in providers (PostHog, Mixpanel, Amplitude, Agent Native Analytics, Webhook) and `registerBuiltinProviders()` |
| `packages/core/src/tracking/types.ts`     | `TrackingEvent` and `TrackingProvider` interfaces                                                                   |

## Related Skills

- `secrets` -- API keys for tracking providers can be registered as secrets
- `server-plugins` -- `registerBuiltinProviders()` is called by the core-routes plugin at startup
- `actions` -- call `track()` from action handlers to record user/agent activity
