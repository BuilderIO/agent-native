import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import type { ActionAutomationContext, ActionCaller } from "../action.js";
import {
  getStoredModelForEngine,
  normalizeModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import type { AgentEngine } from "../agent/engine/types.js";
import {
  actionsToEngineTools,
  filterInitialEngineTools,
  getOwnerActiveApiKey,
  runAgentLoop,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../agent/run-loop-with-resume.js";
import { resolveRunSoftTimeoutMs, startRun } from "../agent/run-manager.js";
import { attachToolSearch } from "../agent/tool-search.js";
import {
  resolveAutomationExecutionIdentity,
  type AutomationExecutionIdentity,
} from "../automations/service.js";
import { createThread } from "../chat-threads/store.js";
import { queryOrgMembers } from "../org/context.js";
import {
  organizationIdFromResourceOwner,
  type Resource,
} from "../resources/store.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "../server/request-context.js";
import type { JobFrontmatter } from "./frontmatter.js";
import {
  attachAutomationRunThread,
  finishAutomationRun,
  startAutomationRun,
} from "./run-history.js";

const BACKGROUND_RUN_STUCK_MS = 10 * 60_000;
const BACKGROUND_RUN_HARD_TIMEOUT_MS = 5 * 60_000;

export interface BackgroundAutomationContext {
  name: string;
  meta: JobFrontmatter;
  body: string;
  resource: Resource;
}

export interface BackgroundAutomationDeps {
  getActions: (
    automation?: BackgroundAutomationContext,
  ) => Record<string, ActionEntry>;
  getSystemPrompt: (owner: string) => Promise<string>;
  getInitialToolNames?: (
    automation?: BackgroundAutomationContext,
  ) => string[] | undefined;
  engine?: AgentEngine;
  apiKey?: string;
  model?: string;
  appId?: string;
}

export interface BackgroundAutomationRunOptions {
  automation: BackgroundAutomationContext;
  ownerEmail: string;
  orgId?: string;
  prompt: string;
  threadTitle: string;
  runIdPrefix: string;
  usageLabel: string;
  usageRefId?: string;
  requestContext?: Omit<RequestContext, "userEmail" | "orgId">;
  actionCaller?: ActionCaller;
  actionAutomation?: ActionAutomationContext;
}

export interface BackgroundAutomationRunResult {
  responseText: string;
  runId: string;
}

export type AutomationIdentityValidation =
  | { ok: true }
  | { ok: false; reason: string };

export type BackgroundAutomationIdentityResult =
  | { ok: true; identity: AutomationExecutionIdentity }
  | { ok: false; reason: string };

/**
 * A persisted background run must not outlive its execution identity.
 * Organization runs fail closed when membership state cannot be read. A
 * brand-new personal install without auth tables remains a distinct
 * not-applicable case so local/CLI jobs keep working before auth is configured.
 */
export async function validateAutomationRunIdentity(
  ownerEmail: string,
  orgId?: string,
): Promise<AutomationIdentityValidation> {
  if (
    ownerEmail === "__shared__" ||
    organizationIdFromResourceOwner(ownerEmail)
  ) {
    return { ok: true };
  }

  try {
    const { getDbExec } = await import("../db/client.js");
    const userResult = await getDbExec().execute({
      sql: `SELECT 1 FROM "user" WHERE email = ? LIMIT 1`,
      args: [ownerEmail],
    });
    if (!userResult.rows || userResult.rows.length === 0) {
      return { ok: false, reason: `user "${ownerEmail}" no longer exists` };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    const authTablesAreUnconfigured =
      !orgId &&
      (message.includes("does not exist") ||
        message.includes("no such table") ||
        message.includes("undefined table"));
    if (authTablesAreUnconfigured) return { ok: true };
    return {
      ok: false,
      reason: `could not verify user "${ownerEmail}" for this run`,
    };
  }

  if (!orgId) return { ok: true };

  try {
    const memberRows = await queryOrgMembers({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = LOWER(?) LIMIT 1`,
      args: [orgId, ownerEmail],
    });
    if (memberRows === null) {
      return {
        ok: false,
        reason: `could not verify membership in org "${orgId}"`,
      };
    }
    if (memberRows.length === 0) {
      return {
        ok: false,
        reason: `user "${ownerEmail}" is no longer a member of org "${orgId}"`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `could not verify membership in org "${orgId}"`,
    };
  }
}

export async function resolveBackgroundAutomationIdentity(
  automation: BackgroundAutomationContext,
): Promise<BackgroundAutomationIdentityResult> {
  if (automation.meta.triggerType) {
    try {
      return await resolveAutomationExecutionIdentity(
        automation.resource.owner,
        automation.meta,
      );
    } catch {
      return {
        ok: false,
        reason: "Could not verify the automation execution identity.",
      };
    }
  }

  const effectiveRunAs = automation.meta.runAs ?? "creator";
  const userEmail =
    effectiveRunAs === "creator"
      ? automation.meta.createdBy || automation.resource.owner
      : automation.resource.owner;
  const orgId = automation.meta.orgId ?? undefined;
  const validity = await validateAutomationRunIdentity(userEmail, orgId);
  return validity.ok
    ? {
        ok: true,
        identity: {
          userEmail,
          orgId,
          eventOwner: userEmail.toLowerCase(),
        },
      }
    : validity;
}

export function isBackgroundAutomationRunActive(
  meta: Pick<JobFrontmatter, "lastRun" | "lastStatus">,
  now = new Date(),
): boolean {
  if (meta.lastStatus !== "running") return false;
  if (!meta.lastRun) return false;
  const startedAt = new Date(meta.lastRun).getTime();
  return (
    Number.isFinite(startedAt) &&
    now.getTime() - startedAt < BACKGROUND_RUN_STUCK_MS
  );
}

/**
 * A soft-timeout/no-progress checkpoint is a continuation boundary, not a
 * successful finish. Only the last terminal event decides whether an
 * in-invocation resume recovered from the boundary.
 */
export function backgroundRunCutOffReason(run: {
  events?: readonly { event: { type: string; reason?: string } }[];
}): string | null {
  const events = run.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i].event;
    if (event.type === "auto_continue") {
      return event.reason === "run_timeout" || event.reason === "no_progress"
        ? event.reason
        : null;
    }
    if (event.type === "done" || event.type === "error") return null;
  }
  return null;
}

function uniqueToolNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}

function assertRequestedMcpToolsAvailable(
  automation: BackgroundAutomationContext,
  actions: Record<string, ActionEntry>,
): void {
  const requested = automation.meta.mcpTools ?? [];
  const missing = requested.filter((toolName) => !actions[toolName]);
  if (missing.length > 0) {
    throw new Error(
      `Configured MCP tools are unavailable in this run: ${missing.join(", ")}. Reconnect the MCP server or update the automation's capability list.`,
    );
  }
}

function createRunId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function runBackgroundAutomation(
  options: BackgroundAutomationRunOptions,
  deps: BackgroundAutomationDeps,
): Promise<BackgroundAutomationRunResult> {
  const { automation } = options;
  const historyId = await startAutomationRun({
    owner: automation.resource.owner,
    automation: automation.name,
    path: automation.resource.path,
    scope: organizationIdFromResourceOwner(automation.resource.owner)
      ? "organization"
      : "personal",
    orgId: options.orgId ?? null,
  });

  try {
    const result = await executeBackgroundAutomation(options, deps, historyId);
    await finishAutomationRun(historyId, "success");
    return result;
  } catch (err) {
    await finishAutomationRun(
      historyId,
      "error",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

async function executeBackgroundAutomation(
  options: BackgroundAutomationRunOptions,
  deps: BackgroundAutomationDeps,
  historyId: string,
): Promise<BackgroundAutomationRunResult> {
  const { automation, ownerEmail, orgId, prompt, threadTitle, usageLabel } =
    options;

  return runWithRequestContext(
    {
      ...options.requestContext,
      userEmail: ownerEmail,
      orgId,
    },
    async () => {
      const baseActions = deps.getActions(automation);
      assertRequestedMcpToolsAvailable(automation, baseActions);

      const configuredInitialTools = deps.getInitialToolNames?.(automation);
      const initialToolNames = configuredInitialTools
        ? uniqueToolNames([
            ...configuredInitialTools,
            ...(automation.meta.mcpTools ?? []),
          ])
        : undefined;
      const actions = initialToolNames
        ? attachToolSearch({ ...baseActions })
        : baseActions;
      const availableTools = actionsToEngineTools(actions);
      const tools = filterInitialEngineTools(availableTools, initialToolNames);

      const userApiKey = await getOwnerActiveApiKey(ownerEmail);
      const engine =
        deps.engine ??
        (await resolveEngine({
          apiKey: userApiKey ?? deps.apiKey,
          appId: deps.appId,
        }));
      const modelCandidate =
        automation.meta.model ??
        deps.model ??
        (await getStoredModelForEngine(engine, { appId: deps.appId })) ??
        engine.defaultModel;
      const model = normalizeModelForEngine(engine, modelCandidate);
      const systemPrompt = await deps.getSystemPrompt(ownerEmail);
      const thread = await createThread(ownerEmail, { title: threadTitle });
      const runId = createRunId(options.runIdPrefix);
      await attachAutomationRunThread(historyId, thread.id, runId);
      const softTimeoutMs = resolveRunSoftTimeoutMs(undefined, {
        useHostedDefault: true,
      });

      const usageRef: {
        current: Awaited<ReturnType<typeof runAgentLoop>> | null;
      } = { current: null };
      let responseText = "";
      let hardAbortTimer: ReturnType<typeof setTimeout> | null = null;

      await new Promise<void>((resolve, reject) => {
        const activeRun = startRun(
          runId,
          thread.id,
          async (send, signal) => {
            usageRef.current = await runAgentLoopDirectWithSoftTimeout(
              {
                engine,
                model,
                systemPrompt,
                tools,
                availableTools,
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: prompt }],
                  },
                ],
                actions,
                send,
                signal,
                threadId: thread.id,
                ownerEmail,
                orgId,
                actionCaller: options.actionCaller,
                automation: options.actionAutomation,
                runId,
              },
              softTimeoutMs,
            );
          },
          async (run) => {
            if (hardAbortTimer) {
              clearTimeout(hardAbortTimer);
              hardAbortTimer = null;
            }
            const cutOffReason = backgroundRunCutOffReason(run);
            if (cutOffReason) {
              reject(
                new Error(
                  `Background automation was cut off before finishing (${cutOffReason})`,
                ),
              );
              return;
            }
            if (run.status !== "completed") {
              reject(
                new Error(
                  `Background automation ended with status: ${run.status}`,
                ),
              );
              return;
            }
            responseText = collectFinalResponseTextFromAgentEvents(
              (run.events ?? []).map((entry) => entry.event),
            );
            resolve();
          },
          {
            softTimeoutMs,
            dispatchMode: "background",
            model,
            engineName: engine.name,
          },
        );

        hardAbortTimer = setTimeout(() => {
          hardAbortTimer = null;
          if (activeRun.status === "running") {
            activeRun.abort.abort("background_automation_hard_timeout");
            reject(
              new Error("Background automation timed out after 5 minutes"),
            );
          }
        }, BACKGROUND_RUN_HARD_TIMEOUT_MS);
      }).finally(() => {
        if (hardAbortTimer) {
          clearTimeout(hardAbortTimer);
          hardAbortTimer = null;
        }
      });

      const usage = usageRef.current;
      if (
        usage &&
        (usage.inputTokens > 0 ||
          usage.outputTokens > 0 ||
          usage.cacheReadTokens > 0 ||
          usage.cacheWriteTokens > 0)
      ) {
        try {
          const { recordUsage } = await import("../usage/store.js");
          await recordUsage({
            ownerEmail,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            model: usage.model,
            label: usageLabel,
            app: deps.appId,
            refId: options.usageRefId ?? runId,
          });
        } catch {
          // Usage attribution must not break an otherwise successful run.
        }
      }

      if (
        responseText.trim() &&
        automation.meta.deliveryPlatform &&
        automation.meta.deliveryDestination
      ) {
        const { getDefaultAdapter } =
          await import("../integrations/adapters/index.js");
        const adapter = getDefaultAdapter(automation.meta.deliveryPlatform);
        if (!adapter?.sendMessageToTarget) {
          throw new Error(
            `Automation delivery is not supported for ${automation.meta.deliveryPlatform}`,
          );
        }
        await adapter.sendMessageToTarget(
          adapter.formatAgentResponse(responseText),
          {
            destination: automation.meta.deliveryDestination,
            threadRef: automation.meta.deliveryThreadRef ?? null,
            tenantId: automation.meta.deliveryTenantId,
          },
        );
      }

      return { responseText, runId };
    },
  );
}
