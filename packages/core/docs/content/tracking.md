---
title: "Analytics Tracking"
description: "Server-side analytics with pluggable providers — PostHog, Mixpanel, Amplitude, or custom webhook"
---

# Analytics Tracking

One function, multiple destinations. Call `track()` from any server-side code — actions, plugins, server routes — and the event fans out to every registered analytics provider. No SDK dependencies, no client-side scripts, no blocking.

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

## Built-in providers {#built-in}

Set an env var and the provider auto-registers at server startup. No code changes required.

| Provider  | Env vars                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------- |
| PostHog   | `POSTHOG_API_KEY` (required), `POSTHOG_HOST` (optional, defaults to `https://us.i.posthog.com`) |
| Mixpanel  | `MIXPANEL_TOKEN`                                                                                |
| Amplitude | `AMPLITUDE_API_KEY`                                                                             |
| Webhook   | `TRACKING_WEBHOOK_URL` (required), `TRACKING_WEBHOOK_AUTH` (optional `Authorization` header)    |

Multiple providers can be active simultaneously. Every event goes to all of them.

## API {#api}

### `track(name, properties?, meta?)` {#track}

Fire an analytics event. Fans out to all registered providers.

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

Identify a user with traits. Forwarded to providers that support it (PostHog, Mixpanel, Amplitude, webhook).

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

### `registerTrackingProvider(provider)` {#register}

Register a custom provider for any analytics backend.

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
    fetch("https://analytics.example.com/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  },
  identify(userId, traits) {
    // Optional — link user identity to future events
  },
  flush() {
    // Optional — called on graceful shutdown
  },
});
```

### `flushTracking()` {#flush}

Flush all providers. Call before process exit to ensure pending events are sent.

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

Remove a provider by name. Returns `true` if the provider was found and removed.

### `listTrackingProviders()` {#list}

Returns the names of all registered providers.

## The TrackingProvider interface {#provider-interface}

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

Only `name` and `track` are required. `identify` and `flush` are optional — implement them if your backend supports user identity and batched delivery.

## How it works {#internals}

- **Batched HTTP** — built-in providers enqueue events and flush every 10 seconds or when 50 events accumulate, whichever comes first. This minimizes outbound requests without losing data.
- **No SDK dependencies** — all built-in providers use raw `fetch()`. No PostHog SDK, no Mixpanel SDK, no Amplitude SDK. Keeps the framework lightweight.
- **Best-effort delivery** — provider errors are caught and logged. A failing analytics integration never crashes the caller or blocks request handling.
- **Global singleton** — the registry uses a `Symbol.for` key on `globalThis` so multiple ESM graph instances (dev-mode Vite + Nitro, symlinks) share one provider set.

## Using track() in templates {#templates}

Call `track()` from action handlers to record user or agent activity:

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

export default defineAction({
  description: "Create a new project.",
  schema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  run: async ({ name, template }, ctx) => {
    const project = await db
      .insert(projects)
      .values({ name, template })
      .returning();

    track("project.created", { name, template }, { userId: ctx.userEmail });

    return { ok: true, projectId: project[0].id };
  },
});
```

Track calls are fire-and-forget — they return immediately and never block the action response.

## What's next

- [**Actions**](/docs/actions) — where most tracking calls originate
- [**Server Plugins**](/docs/server) — `registerBuiltinProviders()` runs in the core-routes plugin at startup
- [**Secrets**](/docs/security) — manage API keys for tracking providers
