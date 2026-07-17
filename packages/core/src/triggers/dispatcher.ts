/**
 * Trigger dispatcher — registers event Automations with their dispatch path.
 *
 * Certified durable topics become agentic subscriptions in the shared
 * workflow engine. Explicitly ephemeral topics retain the process-local bus.
 */

import {
  getStoredModelForEngine,
  normalizeModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  filterInitialEngineTools,
  getOwnerActiveApiKey,
  type ActionEntry,
} from "../agent/production-agent.js";
import { attachToolSearch } from "../agent/tool-search.js";
import type { AgentChatEvent } from "../agent/types.js";
import { createThread } from "../chat-threads/store.js";
import { assertEphemeralEventTopic } from "../event-bus/authority.js";
import {
  isCertifiedDurableEventTopic,
  subscribe,
  unsubscribe,
} from "../event-bus/index.js";
import type { EventMeta } from "../event-bus/types.js";
import {
  resourceGetByPath,
  resourceListAllOwners,
  resourcePut,
  type Resource,
} from "../resources/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  finalizeWorkflowEffect,
  listWorkflowExecutions,
  listWorkflowSubscriptions,
  recordWorkflowEffect,
  registerWorkflowExecutionHandler,
  upsertWorkflowSubscription,
  type ClaimedWorkflowExecution,
  type WorkflowExecutionHandler,
  type WorkflowExecutionResult,
} from "../workflow/index.js";
import { evaluateCondition } from "./condition-evaluator.js";
import type { TriggerFrontmatter } from "./types.js";

// Re-use the job frontmatter parser — triggers extend the same format.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseTriggerFrontmatter(content: string): {
  meta: TriggerFrontmatter;
  body: string;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      meta: {
        schedule: "",
        enabled: false,
        triggerType: "schedule",
        mode: "agentic",
      },
      body: content,
    };
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const meta: TriggerFrontmatter = {
    schedule: "",
    enabled: true,
    triggerType: "schedule",
    mode: "agentic",
  };

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case "schedule":
        meta.schedule = value;
        break;
      case "enabled":
        meta.enabled = value !== "false";
        break;
      case "triggerType":
        meta.triggerType =
          value === "event" || value === "schedule" ? value : "schedule";
        break;
      case "event":
        meta.event = value;
        break;
      case "condition":
        meta.condition = value;
        break;
      case "mode":
        meta.mode =
          value === "deterministic" || value === "agentic" ? value : "agentic";
        break;
      case "domain":
        meta.domain = value;
        break;
      case "createdBy":
        meta.createdBy = value;
        break;
      case "orgId":
        meta.orgId = value;
        break;
      case "runAs":
        meta.runAs =
          value === "shared" || value === "creator" ? value : undefined;
        break;
      case "lastRun":
        meta.lastRun = value;
        break;
      case "lastStatus":
        meta.lastStatus = value as TriggerFrontmatter["lastStatus"];
        break;
      case "lastError":
        meta.lastError = value;
        break;
      case "nextRun":
        meta.nextRun = value;
        break;
    }
  }

  return { meta, body };
}

export function buildTriggerContent(
  meta: TriggerFrontmatter,
  body: string,
): string {
  const lines = ["---"];
  lines.push(`schedule: "${meta.schedule}"`);
  lines.push(`enabled: ${meta.enabled}`);
  lines.push(`triggerType: ${meta.triggerType}`);
  if (meta.event) lines.push(`event: ${meta.event}`);
  if (meta.condition)
    lines.push(`condition: "${meta.condition.replace(/"/g, '\\"')}"`);
  lines.push(`mode: ${meta.mode}`);
  if (meta.domain) lines.push(`domain: ${meta.domain}`);
  if (meta.createdBy) lines.push(`createdBy: ${meta.createdBy}`);
  if (meta.orgId) lines.push(`orgId: ${meta.orgId}`);
  if (meta.runAs) lines.push(`runAs: ${meta.runAs}`);
  if (meta.lastRun) lines.push(`lastRun: ${meta.lastRun}`);
  if (meta.lastStatus) lines.push(`lastStatus: ${meta.lastStatus}`);
  if (meta.lastError)
    lines.push(`lastError: "${meta.lastError.replace(/"/g, '\\"')}"`);
  if (meta.nextRun) lines.push(`nextRun: ${meta.nextRun}`);
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

// ─── Dispatcher deps (same pattern as SchedulerDeps) ────────────────────────

export interface TriggerDispatcherDeps {
  getActions: () => Record<string, ActionEntry>;
  getSystemPrompt: (owner: string) => Promise<string>;
  /**
   * Tool names to expose on the FIRST engine request for a trigger run. See
   * `SchedulerDeps.getInitialToolNames` (`jobs/scheduler.ts`) — same
   * semantics. Omit to keep the full `getActions()` set visible up front
   * (current behavior).
   */
  getInitialToolNames?: () => string[] | undefined;
  apiKey?: string;
  model?: string;
  /** App/template id used for org-scoped per-app model defaults. */
  appId?: string;
}

// Track active subscriptions (eventName -> subscription id) to avoid
// double-subscribing AND so subscriptions for events that no longer have any
// enabled trigger can be torn down — otherwise deleted/disabled triggers leave
// phantom bus listeners that fire handleEvent forever.
const _eventSubscriptions = new Map<string, string>();
// In-flight agentic dispatches keyed by `${owner}:${path}`. Guards against the
// check-then-write TOCTOU window in handleEvent: two near-simultaneous fires of
// the same event both pass the `lastStatus !== "running"` check (which has
// several awaits before the DB is marked running) and would otherwise launch
// two concurrent agent runs for one trigger. Sufficient for single-process
// deployments; multi-instance would need a conditional DB update.
const _dispatchingTriggers = new Set<string>();
let _deps: TriggerDispatcherDeps | null = null;
let _workflowHandlerUnsubscribe: (() => void) | undefined;

const AUTOMATION_SUBSCRIPTION_DOMAIN = "automation";

export function workflowSubscriptionIdForAutomation(
  resource: Pick<Resource, "id">,
): string {
  return `automation:${resource.id}`;
}

export async function getDurableAutomationStatus(
  resource: Pick<Resource, "id">,
  meta: TriggerFrontmatter,
): Promise<{
  lastStatus?: TriggerFrontmatter["lastStatus"];
  lastRun?: string;
  lastError?: string;
} | null> {
  if (
    meta.triggerType !== "event" ||
    !meta.event ||
    !isCertifiedDurableEventTopic(meta.event)
  ) {
    return null;
  }
  const [execution] = await listWorkflowExecutions({
    subscriptionId: workflowSubscriptionIdForAutomation(resource),
    limit: 1,
  });
  if (!execution) return {};
  const lastStatus: TriggerFrontmatter["lastStatus"] =
    execution.status === "succeeded"
      ? "success"
      : execution.status === "failed" || execution.status === "unknown"
        ? "error"
        : "running";
  return {
    lastStatus,
    lastRun: new Date(execution.createdAt).toISOString(),
    lastError: execution.errorMessage ?? undefined,
  };
}

/**
 * Initialize the trigger dispatcher. Call once at server startup.
 * Loads all event-triggered jobs and subscribes to their events.
 */
export async function initTriggerDispatcher(
  deps: TriggerDispatcherDeps,
): Promise<void> {
  _deps = deps;
  _workflowHandlerUnsubscribe?.();
  _workflowHandlerUnsubscribe = registerWorkflowExecutionHandler(
    agenticAutomationHandler,
  );
  await refreshEventSubscriptions();
}

/**
 * Refresh event subscriptions from the resource store.
 * Call after creating/updating triggers.
 */
export async function refreshEventSubscriptions(): Promise<void> {
  try {
    const jobResources = await resourceListAllOwners("jobs/");
    const eventNames = new Set<string>();

    await syncDurableAutomationSubscriptions(jobResources);

    for (const resource of jobResources) {
      if (!resource.path.endsWith(".md")) continue;
      const { meta } = parseTriggerFrontmatter(resource.content);
      if (
        meta.triggerType === "event" &&
        meta.event &&
        meta.enabled &&
        !isCertifiedDurableEventTopic(meta.event)
      ) {
        eventNames.add(meta.event);
      }
    }

    // Tear down subscriptions whose event no longer has any enabled trigger.
    for (const [eventName, subId] of [..._eventSubscriptions]) {
      if (!eventNames.has(eventName)) {
        unsubscribe(subId);
        _eventSubscriptions.delete(eventName);
      }
    }

    for (const eventName of eventNames) {
      if (!_eventSubscriptions.has(eventName)) {
        const subId = subscribe(eventName, (payload, eventMeta) =>
          handleEvent(eventName, payload, eventMeta),
        );
        _eventSubscriptions.set(eventName, subId);
      }
    }
  } catch (err) {
    console.error("[triggers] Failed to refresh event subscriptions:", err);
  }
}

interface DurableAutomationConfig extends Record<string, unknown> {
  domain: typeof AUTOMATION_SUBSCRIPTION_DOMAIN;
  resourceOwner: string;
  resourcePath: string;
  triggerName: string;
}

function durableAutomationConfig(resource: Resource): DurableAutomationConfig {
  return {
    domain: AUTOMATION_SUBSCRIPTION_DOMAIN,
    resourceOwner: resource.owner,
    resourcePath: resource.path,
    triggerName: resource.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
  };
}

function isAutomationSubscriptionConfig(
  config: Record<string, unknown>,
): config is DurableAutomationConfig & Record<string, unknown> {
  return (
    config.domain === AUTOMATION_SUBSCRIPTION_DOMAIN &&
    typeof config.resourceOwner === "string" &&
    typeof config.resourcePath === "string"
  );
}

async function syncDurableAutomationSubscriptions(
  resources: Resource[],
): Promise<void> {
  const desiredIds = new Set<string>();
  for (const resource of resources) {
    if (!resource.path.endsWith(".md")) continue;
    const { meta } = parseTriggerFrontmatter(resource.content);
    if (
      meta.triggerType !== "event" ||
      !meta.event ||
      !isCertifiedDurableEventTopic(meta.event)
    ) {
      continue;
    }
    const id = workflowSubscriptionIdForAutomation(resource);
    desiredIds.add(id);
    await upsertWorkflowSubscription({
      id,
      kind: "agentic",
      eventPattern: meta.event,
      ownerEmail:
        resource.owner === "__shared__"
          ? (meta.createdBy ?? resource.owner)
          : resource.owner,
      orgId: meta.orgId ?? null,
      config: durableAutomationConfig(resource),
      enabled: meta.enabled && meta.mode === "agentic",
    });
  }

  const existing = await listWorkflowSubscriptions({ kind: "agentic" });
  for (const subscription of existing) {
    if (
      desiredIds.has(subscription.id) ||
      !isAutomationSubscriptionConfig(subscription.config) ||
      !subscription.enabled
    ) {
      continue;
    }
    await upsertWorkflowSubscription({
      ...subscription,
      enabled: false,
    });
  }
}

const agenticAutomationHandler: WorkflowExecutionHandler = {
  kind: "agentic",
  domain: AUTOMATION_SUBSCRIPTION_DOMAIN,
  async execute(
    claim: ClaimedWorkflowExecution,
  ): Promise<WorkflowExecutionResult> {
    if (!_deps) {
      return {
        status: "retrying",
        errorMessage: "Automation runtime is not initialized",
      };
    }
    const config = claim.subscription.config;
    if (!isAutomationSubscriptionConfig(config)) {
      return {
        status: "failed",
        errorMessage: "Automation subscription config is invalid",
      };
    }
    const resource = await resourceGetByPath(
      config.resourceOwner,
      config.resourcePath,
    );
    if (!resource) {
      return {
        status: "failed",
        errorMessage: "Automation resource no longer exists",
      };
    }
    const { meta, body } = parseTriggerFrontmatter(resource.content);
    if (
      !meta.enabled ||
      meta.mode !== "agentic" ||
      meta.triggerType !== "event" ||
      !meta.event ||
      !isCertifiedDurableEventTopic(meta.event)
    ) {
      return { status: "succeeded" };
    }

    const owner = meta.createdBy || resource.owner;
    const userApiKey = await getOwnerActiveApiKey(owner);
    const apiKey = userApiKey || _deps.apiKey;
    if (!apiKey) {
      return {
        status: "failed",
        errorMessage: `No API key for automation "${config.triggerName}"`,
      };
    }
    if (
      !(await evaluateCondition(meta.condition, claim.event.payload, apiKey))
    ) {
      return { status: "succeeded" };
    }

    const idempotencyKey = `${claim.eventId}:${claim.subscriptionId}`;
    const reservation = await recordWorkflowEffect({
      executionId: claim.id,
      kind: "agent-run",
      idempotencyKey,
    });
    if (!reservation.created) {
      if (reservation.effect.status === "delivered") {
        return { status: "succeeded" };
      }
      if (reservation.effect.status === "failed") {
        return {
          status: "failed",
          errorMessage:
            reservation.effect.errorMessage ?? "Automation agent run failed",
        };
      }
      return {
        status: "unknown",
        errorMessage:
          "Automation effect was reserved previously; refusing to duplicate the agent run",
      };
    }

    const outcome = await dispatchAgentic(
      resource,
      meta,
      body,
      claim.event.payload,
      {
        eventId: claim.event.id,
        emittedAt: new Date(claim.event.occurredAt).toISOString(),
        owner: claim.event.ownerEmail,
      },
      apiKey,
      false,
    );
    const delivered = outcome.status === "succeeded";
    await finalizeWorkflowEffect({
      effectId: reservation.effect.id,
      status: delivered ? "delivered" : "failed",
      errorMessage: outcome.errorMessage,
      result: delivered ? { threadStarted: true } : undefined,
    });
    return outcome;
  },
};

async function handleEvent(
  eventName: string,
  payload: unknown,
  eventMeta: EventMeta,
): Promise<void> {
  assertEphemeralEventTopic("subscribe", eventName);
  if (!_deps) return;

  try {
    const jobResources = await resourceListAllOwners("jobs/");
    const matchingTriggers = jobResources.filter((r) => {
      if (!r.path.endsWith(".md")) return false;
      const { meta } = parseTriggerFrontmatter(r.content);
      // Scope: only dispatch triggers owned by the event's owner,
      // or shared triggers. Prevents cross-tenant trigger execution.
      if (
        eventMeta.owner &&
        r.owner !== eventMeta.owner &&
        r.owner !== "__shared__"
      ) {
        return false;
      }
      return (
        meta.triggerType === "event" &&
        meta.event === eventName &&
        meta.enabled &&
        meta.lastStatus !== "running"
      );
    });

    for (const resource of matchingTriggers) {
      const { meta, body } = parseTriggerFrontmatter(resource.content);
      if (!body.trim()) continue;

      // Resolve API key for condition evaluation
      const owner = meta.createdBy || resource.owner;
      const userApiKey = await getOwnerActiveApiKey(owner);
      const apiKey = userApiKey || _deps.apiKey;
      if (!apiKey) {
        console.warn(
          `[triggers] No API key for trigger "${resource.path}" — skipping`,
        );
        continue;
      }

      // Evaluate condition
      const matches = await evaluateCondition(meta.condition, payload, apiKey);
      if (!matches) continue;

      // Dispatch. Guard against concurrent duplicate dispatch of the same
      // trigger (TOCTOU on lastStatus) with an in-process lock keyed on the
      // trigger's identity.
      const dispatchKey = `${resource.owner}:${resource.path}`;
      if (_dispatchingTriggers.has(dispatchKey)) continue;
      if (meta.mode === "agentic") {
        _dispatchingTriggers.add(dispatchKey);
        try {
          await dispatchAgentic(
            resource,
            meta,
            body,
            payload,
            eventMeta,
            apiKey,
          );
        } finally {
          _dispatchingTriggers.delete(dispatchKey);
        }
      } else {
        console.warn(
          `[triggers] Deterministic mode not yet implemented for "${resource.path}" — skipping`,
        );
      }
    }
  } catch (err) {
    console.error(`[triggers] Error handling event "${eventName}":`, err);
  }
}

/**
 * Validate that the run-as user still exists and (if scoped to an org) is
 * still a member of that org. Mirrors the recurring-jobs scheduler check
 * (audit 12 #10): event-triggered automations must stop firing when the
 * creator is removed/demoted.
 */
async function isTriggerRunAsStillValid(
  jobUserEmail: string,
  jobOrgId: string | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  if (jobUserEmail === "__shared__") return { ok: true };
  try {
    const { getDbExec } = await import("../db/client.js");
    const db = getDbExec();
    const userResult = await db.execute({
      sql: `SELECT 1 FROM "user" WHERE email = ? LIMIT 1`,
      args: [jobUserEmail],
    });
    if (!userResult.rows || userResult.rows.length === 0) {
      return { ok: false, reason: `user "${jobUserEmail}" no longer exists` };
    }
    if (jobOrgId) {
      const memberResult = await db.execute({
        sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) LIMIT 1`,
        args: [jobOrgId, jobUserEmail],
      });
      if (!memberResult.rows || memberResult.rows.length === 0) {
        return {
          ok: false,
          reason: `user "${jobUserEmail}" is no longer a member of org "${jobOrgId}"`,
        };
      }
    }
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message?.toLowerCase() ?? "";
    if (
      msg.includes("does not exist") ||
      msg.includes("no such table") ||
      msg.includes("undefined table")
    ) {
      return { ok: true };
    }
    console.warn(
      `[triggers] User/membership validation failed for "${jobUserEmail}":`,
      err?.message,
    );
    return { ok: true };
  }
}

async function dispatchAgentic(
  resource: { path: string; owner: string; content: string },
  meta: TriggerFrontmatter,
  body: string,
  payload: unknown,
  eventMeta: EventMeta,
  apiKey: string,
  persistResourceStatus = true,
): Promise<WorkflowExecutionResult> {
  if (!_deps) {
    return {
      status: "retrying",
      errorMessage: "Automation runtime is not initialized",
    };
  }

  const triggerName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
  const now = new Date();

  const jobUserEmail = meta.createdBy || resource.owner;
  const jobOrgId = meta.orgId ?? undefined;

  // SECURITY (audit 12 #10): re-validate the run-as user/membership on
  // every dispatch. Sharing revocation, user deletion, and org-member
  // removal must take effect for already-scheduled triggers. Skip the
  // dispatch on failure; leave the trigger entry alone for admin review.
  const validity = await isTriggerRunAsStillValid(jobUserEmail, jobOrgId);
  if (!validity.ok) {
    console.warn(
      `[triggers] Skipping trigger "${triggerName}": ${validity.reason}. ` +
        `User/membership no longer valid — leaving entry for admin review.`,
    );
    if (persistResourceStatus) {
      meta.lastRun = now.toISOString();
      meta.lastStatus = "skipped";
      meta.lastError = validity.reason;
      await resourcePut(
        resource.owner,
        resource.path,
        buildTriggerContent(meta, body),
      );
    }
    return { status: "succeeded" };
  }

  if (persistResourceStatus) {
    meta.lastRun = now.toISOString();
    meta.lastStatus = "running";
    meta.lastError = undefined;
    await resourcePut(
      resource.owner,
      resource.path,
      buildTriggerContent(meta, body),
    );
  }

  return await runWithRequestContext(
    { userEmail: jobUserEmail, orgId: jobOrgId },
    async (): Promise<WorkflowExecutionResult> => {
      try {
        const baseActions = _deps!.getActions();
        const systemPrompt = await _deps!.getSystemPrompt(jobUserEmail);
        const initialToolNames = _deps!.getInitialToolNames?.();
        // Only attach tool-search (and pay its schema cost) when the caller
        // actually supplied an initial subset to filter down to — otherwise
        // this is byte-for-byte the prior unfiltered behavior.
        const actions = initialToolNames
          ? attachToolSearch({ ...baseActions })
          : baseActions;
        const availableTools = actionsToEngineTools(actions);
        const tools = filterInitialEngineTools(
          availableTools,
          initialToolNames,
        );

        const engine = await resolveEngine({
          apiKey,
          appId: _deps!.appId,
        });
        const modelCandidate =
          _deps!.model ??
          (await getStoredModelForEngine(engine, { appId: _deps!.appId })) ??
          engine.defaultModel;
        const model = normalizeModelForEngine(engine, modelCandidate);
        const thread = await createThread(jobUserEmail, {
          title: `Trigger: ${triggerName} — ${now.toLocaleDateString()}`,
        });

        let payloadStr: string;
        try {
          payloadStr = JSON.stringify(payload, null, 2);
        } catch {
          payloadStr = String(payload);
        }

        const triggerText = `[Automation Trigger: ${triggerName}]
Event: ${meta.event}
Event ID: ${eventMeta.eventId}
Fired at: ${eventMeta.emittedAt}

Event payload:
${payloadStr}

Execute the following automation instructions:

${body}`;

        const messages = [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: triggerText }],
          },
        ];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

        const events: AgentChatEvent[] = [];
        let triggerUsage: Awaited<ReturnType<typeof runAgentLoop>> | null =
          null;

        try {
          triggerUsage = await runAgentLoop({
            engine,
            model,
            systemPrompt,
            tools,
            availableTools,
            messages,
            actions,
            send: (event) => events.push(event),
            signal: controller.signal,
            threadId: thread.id,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (
          triggerUsage &&
          (triggerUsage.inputTokens > 0 ||
            triggerUsage.outputTokens > 0 ||
            triggerUsage.cacheReadTokens > 0 ||
            triggerUsage.cacheWriteTokens > 0)
        ) {
          try {
            const { recordUsage } = await import("../usage/store.js");
            await recordUsage({
              ownerEmail: jobUserEmail,
              inputTokens: triggerUsage.inputTokens,
              outputTokens: triggerUsage.outputTokens,
              cacheReadTokens: triggerUsage.cacheReadTokens,
              cacheWriteTokens: triggerUsage.cacheWriteTokens,
              model: triggerUsage.model,
              label: `automation:${triggerName}`,
              app: _deps!.appId,
              refId: eventMeta.eventId,
            });
          } catch {
            // Usage attribution must not break automation dispatch.
          }
        }

        if (persistResourceStatus) {
          meta.lastStatus = "success";
          await resourcePut(
            resource.owner,
            resource.path,
            buildTriggerContent(meta, body),
          );
        }

        console.log(`[triggers] "${triggerName}" completed successfully`);
        return { status: "succeeded" };
      } catch (err: any) {
        const errorMessage = err?.message?.slice(0, 200) || "Unknown error";
        if (persistResourceStatus) {
          meta.lastStatus = "error";
          meta.lastError = errorMessage;
          await resourcePut(
            resource.owner,
            resource.path,
            buildTriggerContent(meta, body),
          );
        }
        console.error(`[triggers] "${triggerName}" failed:`, err?.message);
        return { status: "failed", errorMessage };
      }
    },
  );
}
