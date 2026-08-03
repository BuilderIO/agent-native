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
import {
  defineAutomation,
  deleteAutomation,
  listAutomationDefinitions,
  updateAutomation,
  type AutomationScope,
} from "../automations/service.js";
import { listEvents } from "../event-bus/index.js";
import { describeCron, effectiveTimezone } from "../jobs/cron.js";
import {
  getIntegrationRequestContext,
  getRequestOrgId,
} from "../server/request-context.js";
import { refreshEventSubscriptions } from "./dispatcher.js";

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

async function handleList(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  const scope = automationScope(args.scope);
  const definitions = await listAutomationDefinitions(
    { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
    scope,
  );
  const automations = definitions
    .filter(({ meta }) => !args.domain || meta.domain === args.domain)
    .filter(({ meta }) => args.enabled_only !== "true" || meta.enabled)
    .map(({ name, meta, body, canUpdate }) => ({
      name,
      scope,
      triggerType: meta.triggerType,
      event: meta.event ?? null,
      schedule: meta.schedule || null,
      timezone: meta.timezone ? effectiveTimezone(meta.timezone) : null,
      scheduleDescription: meta.schedule
        ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
        : null,
      condition: meta.condition ?? null,
      mode: meta.mode,
      domain: meta.domain ?? null,
      enabled: meta.enabled,
      lastRun: meta.lastRun ?? null,
      lastStatus: meta.lastStatus ?? null,
      lastError: meta.lastError ?? null,
      nextRun: meta.nextRun ?? null,
      createdBy: meta.createdBy ?? null,
      runAs: meta.runAs ?? null,
      model: meta.model ?? null,
      mcpTools: meta.mcpTools ?? [],
      originScopeId: meta.originScopeId ?? null,
      deliveryPlatform: meta.deliveryPlatform ?? null,
      deliveryDestination: meta.deliveryDestination ?? null,
      deliveryThreadRef: meta.deliveryThreadRef ?? null,
      deliveryTenantId: meta.deliveryTenantId ?? null,
      body,
      canUpdate,
    }));
  return JSON.stringify(automations, null, 2);
}

function automationScope(value: unknown): AutomationScope {
  if (value === undefined || value === null || value === "") return "personal";
  if (value === "personal" || value === "organization") return value;
  throw new Error('scope must be "personal" or "organization".');
}

function automationTriggerType(value: unknown): "schedule" | "event" {
  if (value === "schedule" || value === "event") return value;
  throw new Error('trigger_type must be "schedule" or "event".');
}

async function handleDefine(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  if (args.mode === "deterministic") {
    return (
      "Error: Deterministic mode was removed — it was never implemented and " +
      "automations that set it never fired. Create the automation without " +
      "mode (agentic), and describe the exact fixed steps in the automation body."
    );
  }
  const integration = getIntegrationRequestContext();
  try {
    const definition = await defineAutomation(
      { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
      {
        name: typeof args.name === "string" ? args.name : "",
        scope: automationScope(args.scope),
        triggerType: automationTriggerType(args.trigger_type),
        body: typeof args.body === "string" ? args.body : "",
        schedule: typeof args.schedule === "string" ? args.schedule : undefined,
        timezone: typeof args.timezone === "string" ? args.timezone : undefined,
        event: typeof args.event === "string" ? args.event : undefined,
        condition:
          typeof args.condition === "string" ? args.condition : undefined,
        domain: typeof args.domain === "string" ? args.domain : undefined,
        delegatedPolicyId:
          typeof args.delegated_policy_id === "string"
            ? args.delegated_policy_id
            : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
        mcpTools: args.mcpTools,
        delivery: integration
          ? {
              originScopeId: integration.scopeId,
              platform: integration.incoming.platform,
              destination:
                typeof integration.incoming.platformContext.channelId ===
                "string"
                  ? integration.incoming.platformContext.channelId
                  : undefined,
              threadRef:
                typeof integration.incoming.threadRef === "string"
                  ? integration.incoming.threadRef
                  : undefined,
              tenantId: integration.incoming.tenantId,
            }
          : undefined,
      },
    );

    await refreshEventSubscriptions();
    return JSON.stringify({
      created: true,
      name: definition.name,
      scope: definition.scope,
      triggerType: definition.meta.triggerType,
      event: definition.meta.event ?? null,
      schedule: definition.meta.schedule || null,
      timezone: definition.meta.timezone ?? null,
      nextRun: definition.meta.nextRun ?? null,
      createdBy: definition.meta.createdBy,
      runAs: definition.meta.runAs,
      model: definition.meta.model ?? null,
      mcpTools: definition.meta.mcpTools ?? [],
      originScopeId: definition.meta.originScopeId ?? null,
      deliveryPlatform: definition.meta.deliveryPlatform ?? null,
      deliveryDestination: definition.meta.deliveryDestination ?? null,
      deliveryThreadRef: definition.meta.deliveryThreadRef ?? null,
      deliveryTenantId: definition.meta.deliveryTenantId ?? null,
    });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

async function handleUpdate(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  try {
    const definition = await updateAutomation(
      { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
      {
        name: typeof args.name === "string" ? args.name : "",
        scope: automationScope(args.scope),
        enabled:
          args.enabled === undefined
            ? undefined
            : args.enabled === true || args.enabled === "true",
        condition:
          args.condition === undefined
            ? undefined
            : typeof args.condition === "string"
              ? args.condition
              : null,
        delegatedPolicyId:
          args.delegated_policy_id === undefined
            ? undefined
            : typeof args.delegated_policy_id === "string"
              ? args.delegated_policy_id
              : null,
        body: typeof args.body === "string" ? args.body : undefined,
        schedule: typeof args.schedule === "string" ? args.schedule : undefined,
        timezone: typeof args.timezone === "string" ? args.timezone : undefined,
        model:
          args.model === undefined
            ? undefined
            : typeof args.model === "string"
              ? args.model
              : null,
        mcpTools: args.mcpTools,
      },
    );
    await refreshEventSubscriptions();
    return JSON.stringify({
      updated: true,
      name: definition.name,
      scope: definition.scope,
      triggerType: definition.meta.triggerType,
      enabled: definition.meta.enabled,
      schedule: definition.meta.schedule || null,
      timezone: definition.meta.timezone ?? null,
      nextRun: definition.meta.nextRun ?? null,
      createdBy: definition.meta.createdBy,
      runAs: definition.meta.runAs,
      model: definition.meta.model ?? null,
      mcpTools: definition.meta.mcpTools ?? [],
      originScopeId: definition.meta.originScopeId ?? null,
      deliveryPlatform: definition.meta.deliveryPlatform ?? null,
      deliveryDestination: definition.meta.deliveryDestination ?? null,
      deliveryThreadRef: definition.meta.deliveryThreadRef ?? null,
      deliveryTenantId: definition.meta.deliveryTenantId ?? null,
    });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

async function handleDelete(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  const name = typeof args.name === "string" ? args.name : "";
  try {
    await deleteAutomation(
      { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
      automationScope(args.scope),
      name,
    );
    await refreshEventSubscriptions();
    return JSON.stringify({ deleted: true, name });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

async function handleFireTest(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  // Dynamic import to avoid circular dependency at module load time
  const { emit } = await import("../event-bus/index.js");

  let data: Record<string, unknown> = {};
  if (typeof args.data === "string" && args.data) {
    try {
      data = JSON.parse(args.data);
    } catch {
      return "Error: invalid JSON in data parameter.";
    }
  }

  // Scope the test event to the current user so only their automations fire,
  // not automations owned by other users in the same process.
  const owner = getCurrentUser();
  emit("test.event.fired", { data }, { owner });
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
- **list**: List all automations (triggers). Shows trigger, status, model, MCP allowlist, and delivery metadata. Optional params: scope, domain, enabled_only.
- **define**: Create a new automation. IMPORTANT: Always confirm with the user before calling — show them a summary of what will be created. Required params: name, trigger_type, body. Optional: scope, event, schedule, timezone, condition, mode, domain, delegated_policy_id, model, mcpTools.
- **update**: Update an existing automation's settings without changing its creator (enabled, schedule, timezone, condition, body, policy, model, MCP allowlist). Required param: name. Use the same scope it was created in.
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
            scope: {
              type: "string",
              description:
                "Personal or organization scope. Organization automations are visible to the active organization but always execute as their creator.",
              enum: ["personal", "organization"],
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
            timezone: {
              type: "string",
              description:
                "IANA timezone the cron clock time is read in, e.g. 'America/New_York'. Optional; defaults to the user's saved scheduling timezone, then the caller's browser zone. Always pass this when the user names a time of day.",
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
                '"agentic" (full agent loop, can use tools) — the only supported mode. Used by define.',
              enum: ["agentic"],
            },
            domain: {
              type: "string",
              description:
                "Domain tag for grouping (mail, calendar, clips, etc.). Used by define and list.",
            },
            model: {
              type: "string",
              description:
                "Optional model id for this automation. The default model is used when omitted.",
            },
            mcpTools: {
              type: "array",
              items: { type: "string" },
              description:
                'Optional explicit MCP capabilities. Use exact advertised tool names, for example ["mcp__meeting-notes__list_meetings"]. Credentials stay in the connector.',
            },
            delegated_policy_id: {
              type: "string",
              description:
                "Optional app-owned stored policy id. It is passed by the trusted trigger runtime, never as action input. Only use an id documented by the app.",
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
      planMode: {
        effect: (args) =>
          args.action === "list" || args.action === "list-events"
            ? "read"
            : "write",
        allowedValues: { action: ["list-events", "list"] },
        description: "Plan mode allows listing automations and event types.",
      },
      run: async (args: Record<string, unknown>) => {
        const action = args.action;

        switch (action) {
          case "list-events":
            return handleListEvents();
          case "list":
            return handleList(args, getCurrentUser);
          case "define":
            return handleDefine(args, getCurrentUser);
          case "update":
            return handleUpdate(args, getCurrentUser);
          case "delete":
            return handleDelete(args, getCurrentUser);
          case "fire-test":
            return handleFireTest(args, getCurrentUser);
          default:
            return `Error: unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}.`;
        }
      },
    },
  };
}
