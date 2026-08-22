/**
 * Framework-level agent actions for the automations system.
 *
 * These are registered as native tools (not template actions) so they're
 * available in every template. The agent uses them to create, list, and
 * manage automations from chat.
 *
 * All seven operations are consolidated into a single `manage-automations` tool
 * with an `action` discriminator to keep the tool registry compact.
 */

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  defineAutomation,
  deleteAutomation,
  listAutomationDefinitions,
  updateAutomation,
  type AutomationScope,
} from "../automations/service.js";
import { listEvents } from "../event-bus/index.js";
import {
  getRemoteExecutionCapabilities,
  listRemoteDevicesForOwner,
} from "../integrations/remote-devices-store.js";
import { describeCron, effectiveTimezone } from "../jobs/cron.js";
import { queueAutomationRunNow } from "../jobs/run-now.js";
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

async function handleListHosts(getCurrentUser: () => string): Promise<string> {
  const devices = await listRemoteDevicesForOwner({
    ownerEmail: getCurrentUser(),
    orgId: getRequestOrgId(),
    status: "active",
    limit: 50,
  });
  const now = Date.now();
  return JSON.stringify(
    devices.map((device) => ({
      id: device.id,
      name: device.label,
      platform: device.platform,
      hostName: device.hostName,
      status: device.status,
      online: device.lastSeenAt !== null && now - device.lastSeenAt <= 90_000,
      lastSeenAt: device.lastSeenAt
        ? new Date(device.lastSeenAt).toISOString()
        : null,
      executionCapabilities: getRemoteExecutionCapabilities(device),
    })),
    null,
    2,
  );
}

async function handleList(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
  appId?: string,
): Promise<string> {
  const scope = automationScope(args.scope);
  const definitions = await listAutomationDefinitions(
    { userEmail: getCurrentUser(), orgId: getRequestOrgId(), appId },
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
      appId: meta.appId ?? null,
      enabled: meta.enabled,
      lastRun: meta.lastRun ?? null,
      lastStatus: meta.lastStatus ?? null,
      lastError: meta.lastError ?? null,
      nextRun: meta.nextRun ?? null,
      createdBy: meta.createdBy ?? null,
      runAs: meta.runAs ?? null,
      model: meta.model ?? null,
      executionHostId: meta.executionHostId ?? null,
      executionEngine: meta.executionEngine ?? null,
      executionCwd: meta.executionCwd ?? null,
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
  appId?: string,
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
      {
        userEmail: getCurrentUser(),
        orgId: getRequestOrgId(),
        appId,
      },
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
        executionHostId:
          typeof args.execution_host_id === "string"
            ? args.execution_host_id
            : undefined,
        executionEngine:
          typeof args.execution_engine === "string"
            ? args.execution_engine
            : undefined,
        executionCwd:
          typeof args.execution_cwd === "string"
            ? args.execution_cwd
            : undefined,
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
      executionHostId: definition.meta.executionHostId ?? null,
      executionEngine: definition.meta.executionEngine ?? null,
      executionCwd: definition.meta.executionCwd ?? null,
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
  appId?: string,
): Promise<string> {
  try {
    const definition = await updateAutomation(
      { userEmail: getCurrentUser(), orgId: getRequestOrgId(), appId },
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
        executionHostId:
          args.execution_host_id === undefined
            ? undefined
            : typeof args.execution_host_id === "string"
              ? args.execution_host_id
              : null,
        executionEngine:
          args.execution_engine === undefined
            ? undefined
            : typeof args.execution_engine === "string"
              ? args.execution_engine
              : null,
        executionCwd:
          args.execution_cwd === undefined
            ? undefined
            : typeof args.execution_cwd === "string"
              ? args.execution_cwd
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
      executionHostId: definition.meta.executionHostId ?? null,
      executionEngine: definition.meta.executionEngine ?? null,
      executionCwd: definition.meta.executionCwd ?? null,
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
  appId?: string,
): Promise<string> {
  const name = typeof args.name === "string" ? args.name : "";
  try {
    await deleteAutomation(
      { userEmail: getCurrentUser(), orgId: getRequestOrgId(), appId },
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

async function handleRunNow(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
  appId?: string,
  context?: ActionRunContext,
): Promise<string> {
  if (context?.caller === "automation") {
    return "Error: an automation cannot run another automation.";
  }
  try {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    const name = typeof args.name === "string" ? args.name : "";
    const result = await queueAutomationRunNow({
      userEmail: getCurrentUser(),
      orgId: getRequestOrgId(),
      appId,
      scope: automationScope(args.scope),
      ...(path ? { path } : { name }),
      requestHeaders: context?.requestHeaders,
    });
    return JSON.stringify(result);
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Consolidated tool entry                                           */
/* ------------------------------------------------------------------ */

const VALID_ACTIONS = [
  "list-events",
  "list-hosts",
  "list",
  "define",
  "update",
  "delete",
  "fire-test",
  "run-now",
] as const;

export function createAutomationToolEntries(
  getCurrentUser: () => string,
  appId?: string,
): Record<string, ActionEntry> {
  return {
    "manage-automations": {
      tool: {
        description: `Manage automations (event-triggered and scheduled tasks). Use the "action" parameter to choose an operation:

- **list-events**: List all registered event types that automations can subscribe to. Returns event names, descriptions, and payload schemas. Call this BEFORE defining an automation to discover available events.
- **list-hosts**: List paired execution hosts and their non-secret capabilities. Call this before assigning execution_host_id.
- **list**: List all automations (triggers). Shows trigger, status, model, execution host, MCP allowlist, and delivery metadata. Optional params: scope, domain, enabled_only.
- **define**: Create a new automation. IMPORTANT: Always confirm with the user before calling — show them a summary of what will be created. Required params: name, trigger_type, body. Optional: scope, event, schedule, timezone, condition, mode, domain, delegated_policy_id, model, execution_host_id, execution_engine, execution_cwd, mcpTools. A scheduled automation with no schedule defaults to once per hour; use an event trigger when it should run only when something changes. Host-targeted automations queue code-agent work on that host and do not silently fall back to this server.
- **update**: Update an existing automation's settings without changing its creator (enabled, schedule, timezone, condition, body, policy, model, execution host, MCP allowlist). Required param: name. Use the same scope it was created in.
- **delete**: Delete an automation. Always confirm with the user first. Required param: name.
- **fire-test**: Fire a test event to validate automations. Emits a test.event.fired event. Optional param: data (JSON string).
- **run-now**: Run one automation immediately using its real actions and side effects. This is an explicit user-authorized run and returns a durable run id; it does not change the automation's next scheduled run. Required params: name or path (not both); optional scope. Use path for automations nested under jobs/ (for example jobs/factories/<id>/factory-slack-feedback.md); those names contain a slash and cannot round-trip through name.`,
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              description:
                "The operation to perform: list-events, list-hosts, list, define, update, delete, fire-test, or run-now.",
              enum: [...VALID_ACTIONS],
            },
            name: {
              type: "string",
              description:
                "Slug name for the automation (lowercase, hyphens). Used by define, update, delete, and run-now for flat automations. For nested automations, pass path to run-now instead.",
            },
            path: {
              type: "string",
              description:
                "Full jobs resource path (jobs/...md) for a nested automation. Use with run-now instead of name when the automation name contains a slash.",
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
                'For schedule triggers: cron expression. If omitted, defaults to "0 * * * *" (once per hour). Example: "0 9 * * 1-5" (9am weekdays).',
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
            execution_host_id: {
              type: "string",
              description:
                "Optional exact paired host id for scheduled code-agent execution. Call list-hosts first; a selected host is never silently replaced by another host.",
            },
            execution_engine: {
              type: "string",
              description:
                "Optional host engine id, such as codex-cli or claude-cli. It must be advertised by the selected host when host capabilities include an engine list.",
            },
            execution_cwd: {
              type: "string",
              description:
                "Optional workspace path on the execution host. Use the host connector's configured workspace when omitted.",
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
          args.action === "list" ||
          args.action === "list-events" ||
          args.action === "list-hosts"
            ? "read"
            : "write",
        allowedValues: {
          action: ["list-events", "list-hosts", "list"],
        },
        description:
          "Plan mode allows listing automations, execution hosts, and event types.",
      },
      run: async (
        args: Record<string, unknown>,
        context?: ActionRunContext,
      ) => {
        const action = args.action;

        switch (action) {
          case "list-events":
            return handleListEvents();
          case "list-hosts":
            return handleListHosts(getCurrentUser);
          case "list":
            return handleList(args, getCurrentUser, appId);
          case "define":
            return handleDefine(args, getCurrentUser, appId);
          case "update":
            return handleUpdate(args, getCurrentUser, appId);
          case "delete":
            return handleDelete(args, getCurrentUser, appId);
          case "fire-test":
            return handleFireTest(args, getCurrentUser);
          case "run-now":
            return handleRunNow(args, getCurrentUser, appId, context);
          default:
            return `Error: unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}.`;
        }
      },
    },
  };
}
