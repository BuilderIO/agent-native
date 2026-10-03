---
name: notifications
description: >-
  In-app notifications primitive with pluggable server-side channels. Use when
  the agent needs to surface progress, alerts, or completions to the user —
  both in-app (bell + toast) and out-of-band (webhook, Slack, custom).
---

# Notifications

`notify()` is the framework's "tell the user something" primitive. Every call persists a row to the inbox (drives the bell UI) and fans out to any registered server-side channels. Channels follow the same pluggable-provider pattern as `tracking` — register at startup, `notify()` fans out, errors are isolated.

Use for: *agent progress milestones, automation triggers firing, background job completions, critical errors*. Don't use for chat replies — those go through the conversation.

## Tools

| Tool | Purpose |
|---|---|
| `notify` | Send a notification (severity + title + optional body/metadata/channels) |
| `list-notifications` | Show recent notifications for the current user |

## Sending

```
notify --severity info --title "Booking confirmed" --body "Jane at 3pm"
```

| Severity | When |
|---|---|
| `info` | FYI / progress / confirmation |
| `warning` | Something to look at soon |
| `critical` | Needs immediate attention |

Optional: `--metadataJson '{"threadId":"abc"}'`, `--channels inbox,webhook` (omit to run all registered).

## Delivery

`notify()` always inserts into the `notifications` table (unless `channels` explicitly excludes `inbox`), then fans out to every registered channel in parallel (best-effort; a failing channel doesn't block others). Finally it emits `notification.sent` on the event bus so automations can chain — e.g. *"when a critical notification fires, also page on-call."*

## Built-in Channels

| Channel | How | Requires |
|---|---|---|
| `inbox` | INSERT → drives bell UI | (always on) |
| `webhook` | POST JSON to `NOTIFICATIONS_WEBHOOK_URL` (+ optional `NOTIFICATIONS_WEBHOOK_AUTH`); both support `${keys.NAME}` + URL allowlists from the ad-hoc-keys system | env var set |

The webhook channel resolves `${keys.NAME}` server-side — the raw value never enters the agent context.

## Registering a Custom Channel

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
        body: JSON.stringify({ text: `*${input.severity}* — ${input.title}`, owner: meta.owner }),
      });
    },
  });
};
```

Names are unique — re-registering replaces. `deliver()` must be best-effort; a thrown error is logged and ignored. Do NOT call `notify()` from inside a channel (recursion).

## HTTP API

Mounted at `/_agent-native/notifications/*` by `core-routes-plugin`, all session-scoped:

- `GET    /notifications?unread=true&limit=50&before=<iso>`
- `GET    /notifications/count`
- `POST   /notifications/:id/read`
- `POST   /notifications/read-all`
- `DELETE /notifications/:id`

## UI

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

<NotificationsBell browserNotifications />
```

Bell icon + unread badge + lazy-loaded dropdown. Pass `browserNotifications` to also fire system `new Notification(...)` popups for items that arrive after mount (dedups by id, renders an "Enable" prompt until permission is granted, silently no-ops on denied / unsupported). Styled with shadcn tokens — adapts to the host theme.

## Related

- `automations` — event-triggered bodies can call `notify`.
- `secrets` — `${keys.NAME}` substitution + URL allowlists powering the webhook channel.
- `tracking` — analytics; separate concern, don't route through notifications.
