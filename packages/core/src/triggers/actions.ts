/**
 * Framework-level agent actions for the automations system.
 *
 * These are registered as native tools (not template actions) so they're
 * available in every template. The agent uses them to create, list, and
 * manage automations from chat.
 */

import { randomUUID } from "node:crypto";
import type { ActionEntry } from "../agent/production-agent.js";
import { listEvents } from "../event-bus/index.js";
import {
  resourceListAllOwners,
  resourcePut,
  resourceGet,
  resourceDelete,
  resourceGetByPath,
} from "../resources/store.js";
import { parseTriggerFrontmatter, buildTriggerContent } from "./dispatcher.js";
import { refreshEventSubscriptions } from "./dispatcher.js";
import type { TriggerFrontmatter } from "./types.js";

export function createAutomationToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "list-automation-events": {
      tool: {
        description:
          "List all registered event types that automations can subscribe to. Returns event names, descriptions, and payload schemas. Call this BEFORE defining an automation to discover available events.",
        parameters: { type: "object" as const, properties: {} },
      },
      run: async () => {
        const events = listEvents();
        if (events.length === 0) {
          return "No events registered yet. Events are registered by integrations (mail, calendar, clips, etc.).";
        }
        const lines = events.map((e) => {
          let schemaStr = "";
          try {
            const s = e.payloadSchema as any;
            if (s?._zod?.def?.shape) {
              const fields = Object.keys(s._zod.def.shape);
              schemaStr = ` Fields: ${fields.join(", ")}`;
            }
          } catch {
            // ignore
          }
          const example = e.example
            ? `\n  Example: ${JSON.stringify(e.example)}`
            : "";
          return `- **${e.name}**: ${e.description}${schemaStr}${example}`;
        });
        return lines.join("\n");
      },
      readOnly: true,
    },

    "list-automations": {
      tool: {
        description:
          "List all automations (triggers). Shows name, event, condition, mode, status, and domain.",
        parameters: {
          type: "object" as const,
          properties: {
            domain: {
              type: "string",
              description:
                "Filter by domain (mail, calendar, clips, etc.). Omit for all.",
            },
            enabled_only: {
              type: "string",
              description: '"true" to show only enabled automations.',
            },
          },
        },
      },
      run: async (args: Record<string, string>) => {
        const resources = await resourceListAllOwners("jobs/");
        const triggers = resources
          .filter((r) => r.path.endsWith(".md"))
          .map((r) => {
            const { meta, body } = parseTriggerFrontmatter(r.content);
            const name = r.path.replace(/^jobs\//, "").replace(/\.md$/, "");
            return { name, meta, body, owner: r.owner, id: r.id };
          })
          .filter((t) => {
            if (args.domain && t.meta.domain !== args.domain) return false;
            if (args.enabled_only === "true" && !t.meta.enabled) return false;
            return true;
          });

        if (triggers.length === 0) return "No automations found.";

        const lines = triggers.map((t) => {
          const type =
            t.meta.triggerType === "event"
              ? `on ${t.meta.event || "?"}`
              : `cron: ${t.meta.schedule}`;
          const status = t.meta.enabled ? "enabled" : "disabled";
          const lastStatus = t.meta.lastStatus
            ? ` (last: ${t.meta.lastStatus})`
            : "";
          const condition = t.meta.condition
            ? `\n  Condition: "${t.meta.condition}"`
            : "";
          const domain = t.meta.domain ? ` [${t.meta.domain}]` : "";
          return `- **${t.name}**${domain}: ${type} → ${t.meta.mode} (${status}${lastStatus})${condition}\n  Body: ${t.body.slice(0, 100)}${t.body.length > 100 ? "..." : ""}`;
        });
        return lines.join("\n\n");
      },
      readOnly: true,
    },

    "define-automation": {
      tool: {
        description: `Create a new automation. The automation is stored as a markdown resource and fires when the specified event occurs and the condition (if any) matches. IMPORTANT: Always confirm with the user before calling this — show them a summary of what will be created.`,
        parameters: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description:
                "Slug name for the automation (lowercase, hyphens). Example: slack-on-builder-booking",
            },
            trigger_type: {
              type: "string",
              description: '"event" or "schedule".',
              enum: ["event", "schedule"],
            },
            event: {
              type: "string",
              description:
                "For event triggers: the event name to subscribe to. Call list-automation-events first to see available events.",
            },
            schedule: {
              type: "string",
              description:
                'For schedule triggers: cron expression. Example: "0 9 * * 1-5" (9am weekdays).',
            },
            condition: {
              type: "string",
              description:
                'Natural-language condition. Example: "attendee email ends with @builder.io". Leave empty for unconditional.',
            },
            mode: {
              type: "string",
              description:
                '"agentic" (full agent loop, can use tools) or "deterministic" (fixed actions only).',
              enum: ["agentic", "deterministic"],
            },
            domain: {
              type: "string",
              description:
                "Domain tag for grouping (mail, calendar, clips, etc.).",
            },
            body: {
              type: "string",
              description:
                "The natural-language instructions for what to do when the automation fires. This becomes the agent's prompt in agentic mode.",
            },
          },
          required: ["name", "trigger_type", "body"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        const name = (args.name || "").replace(/[^a-z0-9-]/g, "-");
        if (!name) return "Error: name is required (lowercase, hyphens).";

        const path = `jobs/${name}.md`;

        // Check if it already exists
        const existing = await resourceGetByPath(owner, path);
        if (existing) {
          return `Error: An automation named "${name}" already exists. Use a different name or delete the existing one first.`;
        }

        const triggerType =
          args.trigger_type === "schedule" ? "schedule" : "event";
        const meta: TriggerFrontmatter = {
          schedule: args.schedule || "",
          enabled: true,
          triggerType,
          event: args.event || undefined,
          condition: args.condition || undefined,
          mode: args.mode === "deterministic" ? "deterministic" : "agentic",
          domain: args.domain || undefined,
          createdBy: owner,
          runAs: "creator",
        };

        const content = buildTriggerContent(meta, args.body || "");
        await resourcePut(owner, path, content);

        // Refresh event subscriptions so the new trigger is active immediately
        await refreshEventSubscriptions();

        const summary =
          triggerType === "event"
            ? `on ${meta.event || "?"}${meta.condition ? ` when "${meta.condition}"` : ""}`
            : `on schedule "${meta.schedule}"`;

        return `Automation "${name}" created. Fires ${summary} in ${meta.mode} mode.`;
      },
    },

    "update-automation": {
      tool: {
        description:
          "Update an existing automation's settings (enabled, condition, body, etc.).",
        parameters: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description: "Name of the automation to update.",
            },
            enabled: {
              type: "string",
              description: '"true" or "false" to enable/disable.',
            },
            condition: {
              type: "string",
              description:
                "New natural-language condition (or empty to clear).",
            },
            body: {
              type: "string",
              description: "New automation body/instructions.",
            },
          },
          required: ["name"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        const name = args.name;
        const path = `jobs/${name}.md`;

        const resource = await resourceGetByPath(owner, path);
        if (!resource) {
          return `Automation "${name}" not found (or you don't own it).`;
        }

        const { meta, body } = parseTriggerFrontmatter(resource.content);

        if (args.enabled !== undefined) {
          meta.enabled = args.enabled !== "false";
        }
        if (args.condition !== undefined) {
          meta.condition = args.condition || undefined;
        }
        const newBody = args.body ?? body;

        await resourcePut(
          resource.owner,
          resource.path,
          buildTriggerContent(meta, newBody),
        );
        await refreshEventSubscriptions();

        return `Automation "${name}" updated.`;
      },
    },

    "delete-automation": {
      tool: {
        description:
          "Delete an automation. Always confirm with the user first.",
        parameters: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description: "Name of the automation to delete.",
            },
          },
          required: ["name"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        const path = `jobs/${args.name}.md`;

        const resource = await resourceGetByPath(owner, path);
        if (!resource) return `Automation "${args.name}" not found.`;

        await resourceDelete(resource.id);
        return `Automation "${args.name}" deleted.`;
      },
    },

    "fire-test-event": {
      tool: {
        description:
          "Fire a test event to validate automations. Emits a test.event.fired event with the provided data.",
        parameters: {
          type: "object" as const,
          properties: {
            data: {
              type: "string",
              description:
                'JSON data to include as the event payload. Example: \'{"email": "test@example.com"}\'.',
            },
          },
        },
      },
      run: async (args: Record<string, string>) => {
        // Dynamic import to avoid circular dependency at module load time
        const { emit } = await import("../event-bus/index.js");

        let data: Record<string, unknown> = {};
        if (args.data) {
          try {
            data = JSON.parse(args.data);
          } catch {
            return "Error: invalid JSON in data parameter.";
          }
        }

        emit("test.event.fired", { data });
        return `Test event fired with payload: ${JSON.stringify({ data })}. Any automations subscribed to "test.event.fired" will be evaluated.`;
      },
    },
  };
}
