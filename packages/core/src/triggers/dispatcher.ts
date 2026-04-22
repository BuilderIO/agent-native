/**
 * Trigger dispatcher — bridges the event bus to the automation system.
 *
 * On startup, loads all event-triggered jobs from the resources store,
 * subscribes to their events, and dispatches them (condition eval → agent
 * loop) when matching events fire.
 */

import { randomUUID } from "node:crypto";
import { subscribe } from "../event-bus/index.js";
import type { EventMeta } from "../event-bus/types.js";
import { resourceListAllOwners, resourcePut } from "../resources/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  getOwnerActiveApiKey,
  type ActionEntry,
} from "../agent/production-agent.js";
import { createAnthropicEngine } from "../agent/engine/index.js";
import { createThread } from "../chat-threads/store.js";
import type { AgentChatEvent } from "../agent/types.js";
import { evaluateCondition } from "./condition-evaluator.js";
import type { TriggerFrontmatter } from "./types.js";

// Re-use the job frontmatter parser — triggers extend the same format.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseTriggerFrontmatter(content: string): {
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

function buildTriggerContent(meta: TriggerFrontmatter, body: string): string {
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
  apiKey?: string;
  model: string;
}

// Track active subscriptions to avoid double-subscribing
const _subscribedEvents = new Set<string>();
let _deps: TriggerDispatcherDeps | null = null;

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

    for (const eventName of eventNames) {
      if (!_subscribedEvents.has(eventName)) {
        subscribe(eventName, (payload, eventMeta) =>
          handleEvent(eventName, payload, eventMeta),
        );
        _subscribedEvents.add(eventName);
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
      const apiKey =
        userApiKey || _deps.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn(
          `[triggers] No API key for trigger "${resource.path}" — skipping`,
        );
        continue;
      }

      // Evaluate condition
      const matches = await evaluateCondition(meta.condition, payload, apiKey);
      if (!matches) continue;

      // Dispatch
      if (meta.mode === "agentic") {
        await dispatchAgentic(resource, meta, body, payload, eventMeta, apiKey);
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
  resource: { path: string; owner: string; content: string },
  meta: TriggerFrontmatter,
  body: string,
  payload: unknown,
  eventMeta: EventMeta,
  apiKey: string,
): Promise<void> {
  if (!_deps) return;

  const triggerName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
  const now = new Date();

  // Mark as running
  meta.lastRun = now.toISOString();
  meta.lastStatus = "running";
  meta.lastError = undefined;
  await resourcePut(
    resource.owner,
    resource.path,
    buildTriggerContent(meta, body),
  );

  const jobUserEmail = meta.createdBy || resource.owner;
  const jobOrgId = meta.orgId ?? undefined;

  await runWithRequestContext(
    { userEmail: jobUserEmail, orgId: jobOrgId },
    async () => {
      try {
        const actions = _deps!.getActions();
        const systemPrompt = await _deps!.getSystemPrompt(resource.owner);
        const tools = actionsToEngineTools(actions);

        const engine = createAnthropicEngine({ apiKey });
        const thread = await createThread(
          `Trigger: ${triggerName} — ${now.toLocaleDateString()}`,
        );

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

        try {
          await runAgentLoop({
            engine,
            model: _deps!.model,
            systemPrompt,
            tools,
            messages,
            actions,
            send: (event) => events.push(event),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        meta.lastStatus = "success";
        await resourcePut(
          resource.owner,
          resource.path,
          buildTriggerContent(meta, body),
        );

        console.log(`[triggers] "${triggerName}" completed successfully`);
      } catch (err: any) {
        meta.lastStatus = "error";
        meta.lastError = err?.message?.slice(0, 200) || "Unknown error";
        await resourcePut(
          resource.owner,
          resource.path,
          buildTriggerContent(meta, body),
        );
        console.error(`[triggers] "${triggerName}" failed:`, err?.message);
      }
    },
  );
}

export { parseTriggerFrontmatter, buildTriggerContent };
