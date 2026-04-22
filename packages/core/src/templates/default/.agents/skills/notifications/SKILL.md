---
name: notifications
description: >-
  In-app notifications primitive with pluggable server-side channels. Use when
  the agent needs to surface progress, alerts, or completions to the user —
  both in-app (bell + toast) and out-of-band (webhook, Slack, custom).
---

# Notifications

## Overview

`notify()` is the framework's "tell the user something" primitive. Every call persists a row to the in-app inbox (drives the bell + toast UI) and fans out to any registered server-side channels (webhook, Slack, custom). Channels follow the same pluggable-provider pattern as the `tracking` module — register at startup, `notify()` fans out, errors are isolated.

Use this for: *agent progress milestones, automation triggers firing, background job completions, critical errors worth interrupting the user.* Don't use it for chat replies — those already show up in the conversation.

## Available Tools

| Tool | Purpose |
|---|---|
| `notify` | Send a notification (severity + title + optional body/metadata/channels) |
| `list-notifications` | Show recent notifications for the current user |

## Sending a Notification

```
notify --severity info --title "Booking confirmed" --body "Jane at 3pm"
```

Severities:

| Severity | When to use |
|---|---|
| `info` | FYI / progress / confirmation — doesn't need action |
| `warning` | Something the user should look at soon |
| `critical` | Needs immediate attention — channels should be noisier |

Optional args:
- `--metadataJson` — arbitrary JSON context (`{"threadId":"abc","link":"/inbox/abc"}`)
- `--channels` — comma-separated allowlist (`"inbox"`, `"inbox,webhook"`). Omit to run every registered channel.

## Delivery Model

```
  notify(input, { owner })
        │
        ▼
  ┌───────────────────────────┐
  │ inbox (always, unless     │  INSERT into `notifications` table →
  │ explicitly excluded)      │  UI polls → bell unread count + toast
  └───────────────────────────┘
        │
        ▼  (fan-out, best-effort)
  ┌───────────────────────────┐
  │ registered channels       │  webhook, Slack, custom…
  └───────────────────────────┘
        │
        ▼
  event-bus: `notification.sent`   ← automations can chain off this
```

Each channel is called once per `notify()`. A channel that throws logs the error but does not prevent other channels or the inbox row from running.

## Built-in Channels

| Channel | How it delivers | Requires |
|---|---|---|
| `inbox` | INSERT into `notifications` table — drives all in-app UI | (nothing — always present) |
| `webhook` | POSTs JSON to `NOTIFICATIONS_WEBHOOK_URL` with optional `NOTIFICATIONS_WEBHOOK_AUTH`; both support `${keys.NAME}` substitution and URL allowlists from the ad-hoc keys system | Env var set |

The webhook channel auto-registers at startup when `NOTIFICATIONS_WEBHOOK_URL` is set. Any user who has set up an ad-hoc key (e.g. `SLACK_WEBHOOK`) can use `${keys.SLACK_WEBHOOK}` in the env template — the raw value is resolved server-side at dispatch, never enters the model's context.

## Registering a Custom Channel

Import from `@agent-native/core/notifications` in a server plugin:

```ts
// server/plugins/notifications-slack.ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

export default () => {
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
};
```

Rules:
- `name` must be unique — re-registering the same name replaces the prior channel.
- `deliver()` should be best-effort; throwing logs the error but does not block other channels.
- Do NOT call `notify()` from inside a channel — it will recurse.

## Notifications API

Mounted at `/_agent-native/notifications/*` by `core-routes-plugin`:

| Method | Route | Body |
|---|---|---|
| `GET`    | `/_agent-native/notifications?unread=true&limit=50&before=<iso>` | — |
| `GET`    | `/_agent-native/notifications/count` | — |
| `POST`   | `/_agent-native/notifications/:id/read` | — |
| `POST`   | `/_agent-native/notifications/read-all` | — |
| `DELETE` | `/_agent-native/notifications/:id` | — |

All routes are scoped to the session owner.

## UI Surface

The framework ships a `<NotificationsBell />` component at `@agent-native/core/client/notifications`:

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

export function HeaderBar() {
  return (
    <div className="flex items-center gap-2">
      {/* … */}
      <NotificationsBell pollMs={10_000} />
    </div>
  );
}
```

Templates can drop it into the header bar. It polls `/count` every `pollMs` (default 10s) and lazy-loads the full list when the dropdown opens.

## Event Bus Integration

Every `notify()` also emits `notification.sent` on the event bus:

```json
{
  "notificationId": "n-123",
  "severity": "critical",
  "title": "DB offline",
  "body": "Primary dropped connections",
  "deliveredChannels": ["inbox", "webhook"]
}
```

This lets automations (PR #255) react to notifications — e.g. *"when a critical notification fires, also page on-call."*

## Related Skills

- `automations` — event-triggered automations can call `notify` in their agentic body.
- `secrets` — the webhook channel reuses `${keys.NAME}` substitution and URL allowlists.
- `tracking` — analytics events; separate concern — do not route tracking through notifications or vice versa.
