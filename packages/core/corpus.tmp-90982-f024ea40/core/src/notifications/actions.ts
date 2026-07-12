/**
 * Framework-level agent actions for the notifications primitive.
 *
 * Registered as native tools (not template actions) so they're available in
 * every template. Consolidated into a single `manage-notifications` tool with
 * an `action` parameter that dispatches to the correct implementation.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { notify, listNotifications, countUnread } from "./registry.js";
import type { NotificationSeverity } from "./types.js";

function parseLimit(value: unknown, fallback = 20): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 200);
}

export function createNotificationToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "manage-notifications": {
      tool: {
        description: [
          "Manage user notifications. Available actions:",
          "",
          '• action="send" — Send a notification to the user. Persisted to the in-app inbox so the bell + toast surface shows it. Registered channels (webhook, Slack, etc.) also run.',
          "  Required: severity, title. Optional: body, metadataJson, channels.",
          "",
          '• action="list" — List recent notifications for the current user. Useful when the user asks about prior alerts.',
          "  Optional: unreadOnly (boolean), limit (number, default 20, max 200).",
        ].join("\n"),
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["send", "list"],
              description: "The notification action to perform.",
            },
            severity: {
              type: "string",
              enum: ["info", "warning", "critical"],
              description:
                '(send) Severity level — drives styling and per-severity channel routing. Use "info" for FYI, "warning" for things the user should look at, "critical" for things that need immediate attention.',
            },
            title: {
              type: "string",
              description:
                "(send) Short, human-readable headline (≤100 chars).",
            },
            body: {
              type: "string",
              description: "(send) Optional longer description.",
            },
            metadataJson: {
              type: "string",
              description:
                '(send) Optional JSON metadata (URLs, entity ids, etc.). Example: \'{"threadId":"abc","link":"/inbox/abc"}\'.',
            },
            channels: {
              type: "string",
              description:
                '(send) Optional comma-separated channel allowlist (e.g. "inbox,webhook"). Omit to run all registered channels.',
            },
            unreadOnly: {
              type: "boolean",
              description:
                "(list) When true, only include unread notifications.",
            },
            limit: {
              type: "number",
              description: "(list) Max rows to return (default 20, max 200).",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const owner = getCurrentUser();
        const action = args.action as string;

        switch (action) {
          case "send": {
            if (!args.severity || !args.title) {
              return "Error: severity and title are required for action=send.";
            }
            const severity = args.severity as NotificationSeverity;
            if (!["info", "warning", "critical"].includes(severity)) {
              return `Error: severity must be info, warning, or critical (got "${severity}").`;
            }

            let metadata: Record<string, unknown> | undefined;
            if (args.metadataJson) {
              try {
                metadata = JSON.parse(args.metadataJson as string);
              } catch {
                return "Error: metadataJson must be valid JSON.";
              }
            }

            const channels =
              typeof args.channels === "string"
                ? args.channels
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : undefined;

            const stored = await notify(
              {
                severity,
                title: args.title as string,
                body: (args.body as string) || undefined,
                metadata,
                channels,
              },
              { owner },
            );
            return stored
              ? `Notification sent (id: ${stored.id})`
              : "Notification dispatched to channels (not persisted).";
          }

          case "list": {
            const rows = await listNotifications(owner, {
              unreadOnly:
                args.unreadOnly === true || args.unreadOnly === "true",
              limit: parseLimit(args.limit),
            });
            if (rows.length === 0) {
              return args.unreadOnly
                ? "No unread notifications."
                : "No notifications.";
            }
            const unreadCount = await countUnread(owner);
            const lines = rows.map(
              (n) =>
                `[${n.readAt ? " " : "•"}] (${n.severity}) ${n.title}${n.body ? ` — ${n.body}` : ""} · ${n.createdAt}`,
            );
            return `${unreadCount} unread\n\n${lines.join("\n")}`;
          }

          default:
            return `Error: unknown action "${action}". Must be one of: send, list.`;
        }
      },
    },
  };
}
