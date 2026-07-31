/**
 * Trigger dispatcher — bridges the event bus to the automation system.
 *
 * On startup, loads all event-triggered jobs from the resources store,
 * subscribes to their events, and dispatches them (condition eval → agent
 * loop) when matching events fire.
 */

import { getOwnerActiveApiKey } from "../agent/production-agent.js";
import {
  automationMatchesEventOwner,
  resolveAutomationExecutionIdentity,
  type AutomationExecutionIdentity,
} from "../automations/service.js";
import { subscribe, unsubscribe } from "../event-bus/index.js";
import type { EventMeta } from "../event-bus/types.js";
import {
  isBackgroundAutomationRunActive,
  runBackgroundAutomation,
  type BackgroundAutomationContext,
  type BackgroundAutomationDeps,
} from "../jobs/background-automation-runner.js";
import {
  buildJobResourceContent,
  parseJobResource,
} from "../jobs/frontmatter.js";
import {
  resourceListAllOwners,
  resourcePut,
  type Resource,
} from "../resources/store.js";
import { evaluateCondition } from "./condition-evaluator.js";
import type { TriggerFrontmatter } from "./types.js";

export function parseTriggerFrontmatter(content: string): {
  meta: TriggerFrontmatter;
  body: string;
} {
  const { meta, body } = parseJobResource(content);
  return {
    meta: {
      ...meta,
      triggerType: meta.triggerType ?? "schedule",
      mode: meta.mode ?? "agentic",
    },
    body,
  };
}

export function buildTriggerContent(
  meta: TriggerFrontmatter,
  body: string,
): string {
  return buildJobResourceContent(meta, body);
}

// ─── Dispatcher deps (same pattern as SchedulerDeps) ────────────────────────

export interface TriggerDispatcherDeps extends BackgroundAutomationDeps {
  /**
   * Tool names to expose on the FIRST engine request for a trigger run. See
   * `SchedulerDeps.getInitialToolNames` (`jobs/scheduler.ts`) — same
   * semantics. Omit to keep the full `getActions()` set visible up front
   * (current behavior).
   */
  getInitialToolNames?: (
    automation?: BackgroundAutomationContext,
  ) => string[] | undefined;
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

/**
 * Record that a tick evaluated this trigger and declined to dispatch it.
 * `lastRun` stays untouched — nothing ran — and an unchanged outcome is not
 * re-persisted, so a permanently blocked trigger neither reports phantom runs
 * nor rewrites its resource on every matching event.
 */
async function recordTriggerSkip(
  resource: Resource,
  meta: TriggerFrontmatter,
  body: string,
  status: "skipped" | "error",
  reason: string | undefined,
): Promise<void> {
  const unchanged = meta.lastStatus === status && meta.lastError === reason;
  meta.lastCheck = new Date().toISOString();
  meta.lastStatus = status;
  meta.lastError = reason;
  if (unchanged) return;
  await resourcePut(
    resource.owner,
    resource.path,
    buildTriggerContent(meta, body),
  );
}

/**
 * Initialize the trigger dispatcher. Call once at server startup.
 * Loads all event-triggered jobs and subscribes to their events.
 */
export async function initTriggerDispatcher(
  deps: TriggerDispatcherDeps,
): Promise<void> {
  _deps = deps;
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

    for (const resource of jobResources) {
      if (!resource.path.endsWith(".md")) continue;
      const { meta } = parseTriggerFrontmatter(resource.content);
      if (meta.triggerType === "event" && meta.event && meta.enabled) {
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

async function handleEvent(
  eventName: string,
  payload: unknown,
  eventMeta: EventMeta,
): Promise<void> {
  if (!_deps) return;

  try {
    const jobResources = await resourceListAllOwners("jobs/");
    const matchingTriggers = jobResources.filter((r) => {
      if (!r.path.endsWith(".md")) return false;
      const { meta } = parseTriggerFrontmatter(r.content);
      return (
        meta.triggerType === "event" &&
        meta.event === eventName &&
        meta.enabled &&
        !isBackgroundAutomationRunActive(meta)
      );
    });

    for (const resource of matchingTriggers) {
      const { meta, body } = parseTriggerFrontmatter(resource.content);
      if (!body.trim()) continue;

      let identity: AutomationExecutionIdentity;
      if (resource.owner === "__shared__") {
        // Compatibility for old workspace-wide event resources. New personal
        // and organization automations always require an event owner.
        const userEmail = meta.createdBy || resource.owner;
        identity = {
          userEmail,
          orgId: meta.orgId,
          eventOwner: userEmail.toLowerCase(),
        };
      } else {
        let resolved;
        try {
          resolved = await resolveAutomationExecutionIdentity(
            resource.owner,
            meta,
          );
        } catch {
          await recordTriggerSkip(
            resource,
            meta,
            body,
            "skipped",
            "Could not verify the automation execution identity.",
          );
          continue;
        }
        if (!resolved.ok) {
          await recordTriggerSkip(
            resource,
            meta,
            body,
            "skipped",
            resolved.reason,
          );
          continue;
        }
        if (!automationMatchesEventOwner(resolved.identity, eventMeta.owner)) {
          continue;
        }
        identity = resolved.identity;
      }

      // Resolve API key for condition evaluation
      const owner = identity.userEmail;
      const userApiKey = await getOwnerActiveApiKey(owner);
      const apiKey = userApiKey || _deps.apiKey;
      if (!apiKey) {
        await recordTriggerSkip(
          resource,
          meta,
          body,
          "error",
          "No API key is available for this automation",
        );
        console.warn(`[triggers] ${meta.lastError}: "${resource.path}"`);
        continue;
      }

      // Evaluate condition
      const matches = await evaluateCondition(meta.condition, payload, apiKey);
      if (!matches) {
        await recordTriggerSkip(resource, meta, body, "skipped", undefined);
        continue;
      }

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
            identity,
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

async function dispatchAgentic(
  resource: Resource,
  meta: TriggerFrontmatter,
  body: string,
  payload: unknown,
  eventMeta: EventMeta,
  identity: AutomationExecutionIdentity,
): Promise<void> {
  if (!_deps) return;

  const triggerName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
  const now = new Date();

  const jobUserEmail = identity.userEmail;
  const jobOrgId = identity.orgId;

  // Mark as running
  meta.lastRun = now.toISOString();
  meta.lastStatus = "running";
  meta.lastError = undefined;
  await resourcePut(
    resource.owner,
    resource.path,
    buildTriggerContent(meta, body),
  );

  let payloadStr: string;
  try {
    payloadStr = JSON.stringify(payload, null, 2);
  } catch {
    payloadStr = String(payload);
  }

  const automation: BackgroundAutomationContext = {
    name: triggerName,
    meta,
    body,
    resource,
  };
  const requestContext =
    meta.originScopeId && meta.deliveryPlatform && meta.deliveryDestination
      ? {
          isIntegrationCaller: true as const,
          integration: {
            taskId: `automation:${triggerName}:${eventMeta.eventId}`,
            scopeId: meta.originScopeId,
            principalType: "service" as const,
            incoming: {
              platform: meta.deliveryPlatform,
              externalThreadId: `${meta.deliveryTenantId || "unknown"}:${meta.deliveryDestination}:${meta.deliveryThreadRef || "root"}`,
              text: "",
              tenantId: meta.deliveryTenantId,
              integrationScopeId: meta.originScopeId,
              platformContext: {
                channelId: meta.deliveryDestination,
                threadTs: meta.deliveryThreadRef,
                teamId: meta.deliveryTenantId,
              },
              threadRef: meta.deliveryThreadRef,
              timestamp: now.getTime(),
            },
          },
        }
      : undefined;

  try {
    await runBackgroundAutomation(
      {
        automation,
        ownerEmail: jobUserEmail,
        orgId: jobOrgId,
        prompt: `[Automation Trigger: ${triggerName}]
Event: ${meta.event}
Event ID: ${eventMeta.eventId}
Fired at: ${eventMeta.emittedAt}

Event payload:
${payloadStr}

Execute the following automation instructions:

${body}`,
        threadTitle: `Trigger: ${triggerName} — ${now.toLocaleDateString()}`,
        runIdPrefix: `automation-${triggerName}`,
        usageLabel: `automation:${triggerName}`,
        usageRefId: eventMeta.eventId,
        requestContext,
        actionCaller: "automation",
        actionAutomation: {
          triggerId: resource.id,
          triggerName,
          policyId: meta.delegatedPolicyId,
        },
      },
      _deps,
    );

    meta.lastStatus = "success";
    await resourcePut(
      resource.owner,
      resource.path,
      buildTriggerContent(meta, body),
    );
    console.log(`[triggers] "${triggerName}" completed successfully`);
  } catch (err) {
    meta.lastStatus = "error";
    meta.lastError =
      err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
    await resourcePut(
      resource.owner,
      resource.path,
      buildTriggerContent(meta, body),
    );
    console.error(`[triggers] "${triggerName}" failed:`, meta.lastError);
  }
}
