/**
 * Framework-level agent actions for the notifications primitive.
 *
 * Registered as native tools (not template actions) so they're available in
 * every template. The agent uses `notify` to surface progress, completions,
 * and alerts to the user through the in-app inbox and any registered channels.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { notify, listNotifications, countUnread } from "./registry.js";
import type { NotificationSeverity } from "./types.js";

export function createNotificationToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    notify: {
      tool: {
        description:
          "Send a notification to the user. Always persisted to the in-app inbox so the bell + toast surface shows it. Registered channels (webhook, Slack, etc.) also run. Use `info` for FYI, `warning` for things the user should look at, `critical` for things that need immediate attention.",
        parameters: {
          type: "object" as const,
          properties: {
            severity: {
              type: "string",
              enum: ["info", "warning", "critical"],
              description:
                "Severity level — drives styling and per-severity channel routing.",
            },
            title: {
              type: "string",
              description: "Short, human-readable headline (≤100 chars).",
            },
            body: {
              type: "string",
              description: "Optional longer description.",
            },
            metadataJson: {
              type: "string",
              description:
                'Optional JSON metadata (URLs, entity ids, etc.). Example: \'{"threadId":"abc","link":"/inbox/abc"}\'.',
            },
            channels: {
              type: "string",
              description:
                'Optional comma-separated channel allowlist (e.g. "inbox,webhook"). Omit to run all registered channels.',
            },
          },
          required: ["severity", "title"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        if (!args.severity || !args.title) {
          return "Error: --severity and --title are required.";
        }
        const severity = args.severity as NotificationSeverity;
        if (!["info", "warning", "critical"].includes(severity)) {
          return `Error: severity must be info, warning, or critical (got "${severity}").`;
        }

        let metadata: Record<string, unknown> | undefined;
        if (args.metadataJson) {
          try {
            metadata = JSON.parse(args.metadataJson);
          } catch {
            return "Error: metadataJson must be valid JSON.";
          }
        }

        const channels = args.channels
          ? args.channels
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

        const stored = await notify(
          {
            severity,
            title: args.title,
            body: args.body || undefined,
            metadata,
            channels,
          },
          { owner },
        );
        return stored
          ? `Notification sent (id: ${stored.id})`
          : "Notification dispatched to channels (not persisted).";
      },
    },

    "list-notifications": {
      tool: {
        description:
          "List recent notifications for the current user. Useful when the user asks about prior alerts.",
        parameters: {
          type: "object" as const,
          properties: {
            unreadOnly: {
              type: "boolean",
              description: "When true, only include unread notifications.",
            },
            limit: {
              type: "number",
              description: "Max rows to return (default 20, max 200).",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const owner = getCurrentUser();
        const rows = await listNotifications(owner, {
          unreadOnly: args.unreadOnly === true || args.unreadOnly === "true",
          limit: Math.min(Number(args.limit ?? 20), 200),
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
      },
      readOnly: true,
    },
  };
}
