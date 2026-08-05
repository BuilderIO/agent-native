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
  listAccessibleAutomationDefinitions,
  updateAutomation,
  type AutomationScope,
} from "../automations/service.js";
import type { CompleteAutomationSharingState } from "../automations/sharing-store.js";
import { listEvents } from "../event-bus/index.js";
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

async function handleList(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  const scope = optionalAutomationScope(args.scope);
  const definitions = await listAccessibleAutomationDefinitions({
    userEmail: getCurrentUser(),
    orgId: getRequestOrgId(),
  });
  const automations = definitions
    .filter((definition) => !scope || definition.scope === scope)
    .filter(({ meta }) => !args.domain || meta.domain === args.domain)
    .filter(({ meta }) => args.enabled_only !== "true" || meta.enabled)
    .map(
      ({
        resource,
        name,
        classification,
        scope: definitionScope,
        meta,
        body,
        canUpdate,
        effectiveRole,
        capabilities,
        sharing,
        creator,
      }) => ({
        resourceId: resource.id,
        name,
        scope: definitionScope,
        classification:
          classification.kind === "automation" ? "automation" : "recurring-job",
        triggerType:
          classification.kind === "automation"
            ? classification.triggerType
            : "schedule",
        event: meta.triggerType === "event" ? (meta.event ?? null) : null,
        schedule:
          meta.triggerType === "schedule" ? meta.schedule || null : null,
        timezone:
          meta.triggerType === "schedule" && meta.timezone
            ? effectiveTimezone(meta.timezone)
            : null,
        scheduleDescription:
          meta.triggerType === "schedule" && meta.schedule
            ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
            : null,
        condition:
          meta.triggerType === "manual" ? null : (meta.condition ?? null),
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
        effectiveRole,
        capabilities,
        sharing,
        creator,
      }),
    );
  return JSON.stringify(automations, null, 2);
}

function optionalAutomationScope(value: unknown): AutomationScope | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "personal" || value === "organization") return value;
  throw new Error('scope must be "personal" or "organization".');
}

function automationScope(value: unknown): AutomationScope {
  return optionalAutomationScope(value) ?? "personal";
}

function automationSharing(
  value: unknown,
): CompleteAutomationSharingState | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("sharing must be a complete sharing object.");
  }
  const sharing = value as Record<string, unknown>;
  if (sharing.kind === "personal") return { kind: "personal" as const };
  if (sharing.kind === "organization") {
    if (typeof sharing.organizationId !== "string") {
      throw new Error("organization sharing requires organizationId.");
    }
    return {
      kind: "organization" as const,
      organizationId: sharing.organizationId,
    };
  }
  if (sharing.kind === "specific") {
    if (!Array.isArray(sharing.grants)) {
      throw new Error("specific sharing requires grants.");
    }
    return {
      kind: "specific" as const,
      organizationId:
        typeof sharing.organizationId === "string"
          ? sharing.organizationId
          : null,
      grants: sharing.grants.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("sharing grants must be objects.");
        }
        const grant = entry as Record<string, unknown>;
        if (
          typeof grant.email !== "string" ||
          (grant.role !== "view" && grant.role !== "collaborate")
        ) {
          throw new Error(
            "sharing grants require email and a view or collaborate role.",
          );
        }
        return { email: grant.email, role: grant.role };
      }),
    };
  }
  throw new Error("sharing kind must be personal, organization, or specific.");
}

function automationTriggerType(
  value: unknown,
): "schedule" | "event" | "manual" {
  if (value === "schedule" || value === "event" || value === "manual") {
    return value;
  }
  throw new Error('trigger_type must be "schedule", "event", or "manual".');
}

async function handleDefine(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  if (args.mode === "deterministic") {
    throw new Error(
      "Deterministic mode was removed because it was never implemented. Use agentic mode and describe the exact fixed steps in the body.",
    );
  }
  const integration = getIntegrationRequestContext();
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
      sharing: automationSharing(args.sharing),
      acknowledgeExternalCollaborators:
        args.acknowledge_external_collaborators === true ||
        args.acknowledge_external_collaborators === "true",
      delivery: integration
        ? {
            originScopeId: integration.scopeId,
            platform: integration.incoming.platform,
            destination:
              typeof integration.incoming.platformContext.channelId === "string"
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
    resourceId: definition.resourceId,
    name: definition.name,
    scope: definition.scope,
    triggerType: definition.meta.triggerType,
    event:
      definition.meta.triggerType === "event"
        ? (definition.meta.event ?? null)
        : null,
    schedule:
      definition.meta.triggerType === "schedule"
        ? definition.meta.schedule || null
        : null,
    timezone:
      definition.meta.triggerType === "schedule"
        ? (definition.meta.timezone ?? null)
        : null,
    nextRun:
      definition.meta.triggerType === "schedule"
        ? (definition.meta.nextRun ?? null)
        : null,
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
}

async function handleUpdate(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  const definition = await updateAutomation(
    { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
    {
      resourceId:
        typeof args.resource_id === "string" ? args.resource_id : undefined,
      name: typeof args.name === "string" ? args.name : undefined,
      scope: optionalAutomationScope(args.scope),
      triggerType:
        args.trigger_type === undefined
          ? undefined
          : automationTriggerType(args.trigger_type),
      enabled:
        args.enabled === undefined
          ? undefined
          : args.enabled === true || args.enabled === "true",
      event: typeof args.event === "string" ? args.event : undefined,
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
      sharing: automationSharing(args.sharing),
      acknowledgeExternalCollaborators:
        args.acknowledge_external_collaborators === true ||
        args.acknowledge_external_collaborators === "true",
    },
  );
  await refreshEventSubscriptions();
  return JSON.stringify({
    updated: true,
    resourceId: definition.resource.id,
    name: definition.name,
    scope: definition.scope,
    triggerType: definition.meta.triggerType,
    enabled: definition.meta.enabled,
    schedule:
      definition.meta.triggerType === "schedule"
        ? definition.meta.schedule || null
        : null,
    timezone:
      definition.meta.triggerType === "schedule"
        ? (definition.meta.timezone ?? null)
        : null,
    nextRun:
      definition.meta.triggerType === "schedule"
        ? (definition.meta.nextRun ?? null)
        : null,
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
}

async function handleDelete(
  args: Record<string, unknown>,
  getCurrentUser: () => string,
): Promise<string> {
  const resourceId =
    typeof args.resource_id === "string" ? args.resource_id : undefined;
  const name = typeof args.name === "string" ? args.name : undefined;
  const scope = optionalAutomationScope(args.scope);
  if (!resourceId && (!name || !scope)) {
    throw new Error("resource_id or name and scope is required.");
  }
  await deleteAutomation(
    { userEmail: getCurrentUser(), orgId: getRequestOrgId() },
    resourceId ? { resourceId } : { scope: scope!, name: name! },
  );
  await refreshEventSubscriptions();
  return JSON.stringify({
    deleted: true,
    resourceId: resourceId ?? null,
    name,
  });
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
      throw new Error("Invalid JSON in data parameter.");
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
  context?: ActionRunContext,
): Promise<string> {
  if (context?.caller === "automation") {
    throw new Error("An automation cannot run another automation.");
  }
  const result = await queueAutomationRunNow({
    userEmail: getCurrentUser(),
    orgId: getRequestOrgId(),
    resourceId:
      typeof args.resource_id === "string" ? args.resource_id : undefined,
    scope: optionalAutomationScope(args.scope),
    name: typeof args.name === "string" ? args.name : undefined,
  });
  return JSON.stringify(result);
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
  "run-now",
] as const;

export function createAutomationToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "manage-automations": {
      tool: {
        description: `Manage automations (manual, event-triggered, and scheduled tasks). Use the "action" parameter to choose an operation:

- **list-events**: List all registered event types that automations can subscribe to. Returns event names, descriptions, and payload schemas. Call this BEFORE defining an automation to discover available events.
- **list**: List every accessible automation and legacy recurring job in one result. Returns stable resourceId, classification, effective role, capabilities, sharing summary, and owner-visible grants. Optional params: scope compatibility filter, domain, enabled_only.
- **define**: Create a new automation. IMPORTANT: Always confirm with the user before calling — show them a summary of what will be created. Required params: name, trigger_type, body. Optional: scope, event, schedule, timezone, condition, mode, domain, delegated_policy_id, model, mcpTools, complete sharing state, external-collaborator acknowledgement.
- **update**: Update an existing automation by resource_id without changing its creator (trigger type, event, enabled, schedule, timezone, condition, body, policy, model, MCP allowlist, complete sharing state). Name and scope remain compatibility inputs.
- **delete**: Delete an automation by resource_id. Always confirm with the user first. Name and scope remain compatibility inputs.
- **fire-test**: Fire a test event to validate automations. Emits a test.event.fired event. Optional param: data (JSON string).
- **run-now**: Run one automation by resource_id immediately using its real actions and side effects. Collaborators may request a run, but it always executes as the immutable creator. This is an explicit user-authorized run and returns a durable run id; it does not change the automation's next scheduled run. Name and scope remain compatibility inputs.`,
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              description:
                "The operation to perform: list-events, list, define, update, delete, fire-test, or run-now.",
              enum: [...VALID_ACTIONS],
            },
            resource_id: {
              type: "string",
              description:
                "Stable resource id returned by list. Preferred for update, delete, and run-now.",
            },
            name: {
              type: "string",
              description:
                "Slug name for define. For update, delete, and run-now, use only with the compatibility scope input when resource_id is unavailable.",
            },
            scope: {
              type: "string",
              description:
                "Personal or organization scope. Organization automations are visible to the active organization but always execute as their creator.",
              enum: ["personal", "organization"],
            },
            trigger_type: {
              type: "string",
              description:
                '"manual", "event", or "schedule". Manual automations run only through run-now. Used by define and update.',
              enum: ["manual", "event", "schedule"],
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
            sharing: {
              type: "object",
              description:
                "Complete replacement sharing state for define/update. kind is personal, organization, or specific. Public sharing is unsupported.",
              properties: {
                kind: {
                  type: "string",
                  enum: ["personal", "organization", "specific"],
                },
                organizationId: { type: "string" },
                grants: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      email: { type: "string" },
                      role: {
                        type: "string",
                        enum: ["view", "collaborate"],
                      },
                    },
                    required: ["email", "role"],
                  },
                },
              },
              required: ["kind"],
            },
            acknowledge_external_collaborators: {
              type: "string",
              description:
                'Set to "true" only after the user acknowledges Collaborate grants outside the current organization.',
              enum: ["true", "false"],
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
      run: async (
        args: Record<string, unknown>,
        context?: ActionRunContext,
      ) => {
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
          case "run-now":
            return handleRunNow(args, getCurrentUser, context);
          default:
            throw new Error(
              `Unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}.`,
            );
        }
      },
    },
  };
}
