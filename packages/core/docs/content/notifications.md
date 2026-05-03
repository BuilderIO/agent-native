---
title: "Notifications"
description: "In-app notifications with pluggable channels — inbox, webhook, or custom"
---

# Notifications

One function, many destinations. Call `notify()` from any server-side code — an action, an automation, a plugin — and the event lands in the user's in-app inbox and fans out to every registered channel. Ships with a bell-and-dropdown UI component that the host template drops into its header.

```ts
import { notify } from "@agent-native/core/notifications";

await notify(
  { severity: "info", title: "Booking confirmed", body: "Jane at 3pm" },
  { owner: "steve@builder.io" },
);
```

## Severities {#severities}

| Severity   | Use for                                 |
| ---------- | --------------------------------------- |
| `info`     | Confirmations, progress milestones, FYI |
| `warning`  | Something the user should look at soon  |
| `critical` | Needs immediate attention               |

Severity drives the badge styling in the dropdown and is passed through to channels so they can branch on urgency.

## Built-in channels {#channels}

| Channel   | Delivery                                                  | Requires                                            |
| --------- | --------------------------------------------------------- | --------------------------------------------------- |
| `inbox`   | Persists to the `notifications` table; drives the bell UI | Always on — part of the primitive.                  |
| `webhook` | POST JSON to a configured URL                             | `NOTIFICATIONS_WEBHOOK_URL` env var set at startup. |

The webhook channel resolves `${keys.NAME}` references in both the URL and `NOTIFICATIONS_WEBHOOK_AUTH` against the owner's ad-hoc [secrets](/docs/security), so the raw value never enters the agent's context. Per-key URL allowlists are enforced — same rule the automations `web-request` tool uses.

## API {#api}

### `notify(input, meta)` {#notify}

Deliver a notification. Always persists to the inbox unless explicitly excluded; additional registered channels run in parallel, best-effort.

```ts
await notify(
  {
    severity: "critical",
    title: "Database offline",
    body: "Primary dropped connections",
    metadata: { runbookUrl: "https://runbooks/db-offline" },
    channels: ["inbox", "webhook"], // optional allowlist; omit to run all
  },
  { owner: "ops@company.com" },
);
```

`meta.owner` is required — scopes the notification so only that user sees it in the bell.

### `registerNotificationChannel(channel)` {#register}

Register a custom channel from any server plugin.

```ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

registerNotificationChannel({
  name: "slack-ops",
  async deliver(input, meta) {
    await fetch(process.env.OPS_SLACK_WEBHOOK!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*${input.severity.toUpperCase()}* — ${input.title}\n${input.body ?? ""}`,
        owner: meta.owner,
      }),
    });
  },
});
```

Channel names are unique — re-registering replaces the prior channel. `deliver()` is best-effort; throwing logs the error but does not block other channels or the inbox row.

### Listing and reading {#read}

```ts
import {
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@agent-native/core/notifications";

const rows = await listNotifications("steve@builder.io", {
  unreadOnly: true,
  limit: 50,
});
const unread = await countUnread("steve@builder.io");
await markNotificationRead(rows[0].id, "steve@builder.io");
await markAllNotificationsRead("steve@builder.io");
await deleteNotification(rows[0].id, "steve@builder.io");
```

Each function is owner-scoped — no cross-user reads, no cross-user writes.

## The NotificationChannel interface {#channel-interface}

```ts
interface NotificationChannel {
  name: string;
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ): void | Promise<void>;
}

interface NotificationInput {
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

interface NotificationMeta {
  owner: string;
}
```

## HTTP API {#http}

Mounted at `/_agent-native/notifications/*` by the core-routes plugin. All routes are scoped to the authenticated session's email.

| Method   | Path                                                |
| -------- | --------------------------------------------------- |
| `GET`    | `/_agent-native/notifications?unread=true&limit=50` |
| `GET`    | `/_agent-native/notifications/count`                |
| `POST`   | `/_agent-native/notifications/:id/read`             |
| `POST`   | `/_agent-native/notifications/read-all`             |
| `DELETE` | `/_agent-native/notifications/:id`                  |

## UI component {#ui}

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <NotificationsBell browserNotifications />
    </header>
  );
}
```

Bell icon with unread badge. Clicking opens a dropdown of recent notifications. Uses shadcn semantic tokens, adapts to the host template's light/dark theme.

Pass `browserNotifications` to also fire system `new Notification(...)` popups for every new unread item — useful when the user's tab is in the background. The dropdown renders an "Enable" prompt until the user grants permission; duplicates are prevented per-id via the Notification `tag` field.

## Agent tools {#agent-tools}

Two native tools are registered in every template:

| Tool                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `notify`             | Send a notification from an agent turn or automation |
| `list-notifications` | Show recent notifications to the agent for context   |

Automations (see [Automations](/docs/automations)) can call `notify` in their body — this is the canonical pattern for turning an external event into a user-visible alert.

## Event bus {#event-bus}

Every successful delivery emits `notification.sent` on the [event bus](/docs/automations#event-bus):

```json
{
  "notificationId": "n-123",
  "severity": "critical",
  "title": "DB offline",
  "body": "Primary dropped connections",
  "deliveredChannels": ["inbox", "webhook"]
}
```

Automations can chain off this — e.g. _"if a critical notification fires, also page on-call."_

## How it works {#internals}

- **Owner scoping** — every row has an `owner` column; every query filters on it; every route uses the authenticated session's email. Users never see each other's notifications.
- **Poll integration** — every mutation calls `recordChange()` so templates using [`useDbSync`](/docs/client) auto-invalidate without any extra wiring.
- **Best-effort fan-out** — channel errors are caught and logged; one failing channel does not block others or the inbox write.
- **Fire-and-forget** — `notify()` returns after the inbox write completes; custom channels run in the background.

## What's next

- [**Automations**](/docs/automations) — the most common caller of `notify()`
- [**Security**](/docs/security) — the `${keys.NAME}` substitution that powers the webhook channel
- [**Server plugins**](/docs/server) — where custom channels are registered at startup
