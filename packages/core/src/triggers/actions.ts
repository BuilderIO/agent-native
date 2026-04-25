/**
 * Framework-level agent actions for the automations system.
 *
 * These are registered as native tools (not template actions) so they're
 * available in every template. The agent uses them to create, list, and
 * manage automations from chat.
 *
 * All six operations are consolidated into a single `manage-automations` tool
 * with an `action` discriminator to keep the tool registry compact.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { listEvents } from "../event-bus/index.js";
import {
  resourceListAllOwners,
  resourcePut,
  resourceDelete,
  resourceGetByPath,
} from "../resources/store.js";
import { parseTriggerFrontmatter, buildTriggerContent } from "./dispatcher.js";
import { refreshEventSubscriptions } from "./dispatcher.js";
import type { TriggerFrontmatter } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Individual action handlers                                        */
/* ------------------------------------------------------------------ */

async function handleListEvents(): Promise<string> {
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
}

async function handleList(args: Record<string, string>): Promise<string> {
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
    const lastStatus = t.meta.lastStatus ? ` (last: ${t.meta.lastStatus})` : "";
    const condition = t.meta.condition
      ? `\n  Condition: "${t.meta.condition}"`
      : "";
    const domain = t.meta.domain ? ` [${t.meta.domain}]` : "";
    return `- **${t.name}**${domain}: ${type} → ${t.meta.mode} (${status}${lastStatus})${condition}\n  Body: ${t.body.slice(0, 100)}${t.body.length > 100 ? "..." : ""}`;
  });
  return lines.join("\n\n");
}

async function handleDefine(
  args: Record<string, string>,
  getCurrentUser: () => string,
): Promise<string> {
  const owner = getCurrentUser();
  const name = (args.name || "").replace(/[^a-z0-9-]/g, "-");
  if (!name) return "Error: name is required (lowercase, hyphens).";

  const path = `jobs/${name}.md`;

  // Check if it already exists
  const existing = await resourceGetByPath(owner, path);
  if (existing) {
    return `Error: An automation named "${name}" already exists. Use a different name or delete the existing one first.`;
  }

  const triggerType = args.trigger_type === "schedule" ? "schedule" : "event";
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
}

async function handleUpdate(
  args: Record<string, string>,
  getCurrentUser: () => string,
): Promise<string> {
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
}

async function handleDelete(
  args: Record<string, string>,
  getCurrentUser: () => string,
): Promise<string> {
  const owner = getCurrentUser();
  const path = `jobs/${args.name}.md`;

  const resource = await resourceGetByPath(owner, path);
  if (!resource) return `Automation "${args.name}" not found.`;

  await resourceDelete(resource.id);
  return `Automation "${args.name}" deleted.`;
}

async function handleFireTest(args: Record<string, string>): Promise<string> {
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
}

/* ------------------------------------------------------------------ */
/*  Consolidated tool entry                                           */
/* ------------------------------------------------------------------ */

const VALID_ACTIONS = [
  "list-events",
  "list",
  "define",
  "update",
  "delete",
  "fire-test",
] as const;

export function createAutomationToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "manage-automations": {
      tool: {
        description: `Manage automations (event-triggered and scheduled tasks). Use the "action" parameter to choose an operation:

- **list-events**: List all registered event types that automations can subscribe to. Returns event names, descriptions, and payload schemas. Call this BEFORE defining an automation to discover available events.
- **list**: List all automations (triggers). Shows name, event, condition, mode, status, and domain. Optional params: domain, enabled_only.
- **define**: Create a new automation. IMPORTANT: Always confirm with the user before calling — show them a summary of what will be created. Required params: name, trigger_type, body. Optional: event, schedule, condition, mode, domain.
- **update**: Update an existing automation's settings (enabled, condition, body, etc.). Required param: name. Optional: enabled, condition, body.
- **delete**: Delete an automation. Always confirm with the user first. Required param: name.
- **fire-test**: Fire a test event to validate automations. Emits a test.event.fired event. Optional param: data (JSON string).`,
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              description:
                "The operation to perform: list-events, list, define, update, delete, or fire-test.",
              enum: [...VALID_ACTIONS],
            },
            name: {
              type: "string",
              description:
                "Slug name for the automation (lowercase, hyphens). Used by define, update, and delete.",
            },
            trigger_type: {
              type: "string",
              description: '"event" or "schedule". Required for define.',
              enum: ["event", "schedule"],
            },
            event: {
              type: "string",
              description:
                "For event triggers: the event name to subscribe to. Call with action=list-events first to see available events.",
            },
            schedule: {
              type: "string",
              description:
                'For schedule triggers: cron expression. Example: "0 9 * * 1-5" (9am weekdays).',
            },
            condition: {
              type: "string",
              description:
                'Natural-language condition. Example: "attendee email ends with @builder.io". Leave empty for unconditional. Used by define and update.',
            },
            mode: {
              type: "string",
              description:
                '"agentic" (full agent loop, can use tools) or "deterministic" (fixed actions only). Used by define.',
              enum: ["agentic", "deterministic"],
            },
            domain: {
              type: "string",
              description:
                "Domain tag for grouping (mail, calendar, clips, etc.). Used by define and list.",
            },
            body: {
              type: "string",
              description:
                "The natural-language instructions for what to do when the automation fires. This becomes the agent's prompt in agentic mode. Used by define and update.",
            },
            enabled: {
              type: "string",
              description:
                '"true" or "false" to enable/disable. Used by update.',
            },
            enabled_only: {
              type: "string",
              description:
                '"true" to show only enabled automations. Used by list.',
            },
            data: {
              type: "string",
              description:
                'JSON data to include as the test event payload. Used by fire-test. Example: \'{"email": "test@example.com"}\'.',
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, string>) => {
        const action = args.action;

        switch (action) {
          case "list-events":
            return handleListEvents();
          case "list":
            return handleList(args);
          case "define":
            return handleDefine(args, getCurrentUser);
          case "update":
            return handleUpdate(args, getCurrentUser);
          case "delete":
            return handleDelete(args, getCurrentUser);
          case "fire-test":
            return handleFireTest(args);
          default:
            return `Error: unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}.`;
        }
      },
    },
  };
}
