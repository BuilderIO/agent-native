import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import type { ActionAutomationContext, ActionCaller } from "../action.js";
import {
  getStoredModelForEngine,
  normalizeModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import { resolveMainChatMaxOutputTokens } from "../agent/engine/output-tokens.js";
import type { AgentEngine } from "../agent/engine/types.js";
import {
  actionsToEngineTools,
  filterInitialEngineTools,
  resolveOwnerEngineApiKey,
  runAgentLoop,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../agent/run-loop-with-resume.js";
import {
  abortRun,
  resolveBackgroundAutomationSoftTimeoutMs,
  resolveBackgroundRunHardTimeoutMs,
  startRun,
  type ActiveRun,
} from "../agent/run-manager.js";
import { claimBackgroundRun, insertRun } from "../agent/run-store.js";
import {
  buildAssistantMessage,
  buildUserMessage,
  extractThreadMeta,
  foldAssistantTurn,
  upsertUserMessage,
} from "../agent/thread-data-builder.js";
import { attachToolSearch } from "../agent/tool-search.js";
import {
  resolveAutomationExecutionIdentity,
  type AutomationExecutionIdentity,
} from "../automations/service.js";
import {
  createThread,
  getThread,
  updateThreadData,
  withThreadDataLock,
} from "../chat-threads/store.js";
import { queryOrgMembers } from "../org/context.js";
import {
  organizationIdFromResourceOwner,
  organizationResourceOwner,
  type Resource,
} from "../resources/store.js";
import { captureError } from "../server/capture-error.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "../server/request-context.js";
import { normalizeReasoningEffortForRequest } from "../shared/reasoning-effort.js";
import {
  recoveredFactoryOwnerOrgId,
  type JobFrontmatter,
} from "./frontmatter.js";
import {
  attachAutomationRunThread,
  finishAutomationRun,
  startAutomationRun,
} from "./run-history.js";

export const BACKGROUND_RUN_HARD_TIMEOUT_MS = 10 * 60_000;

export class BackgroundAutomationRunError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "BackgroundAutomationRunError";
    this.errorCode = errorCode;
  }
}

export interface BackgroundAutomationContext {
  name: string;
  meta: JobFrontmatter;
  body: string;
  resource: Resource;
}

export interface BackgroundAutomationDeps {
  getActions: (
    automation?: BackgroundAutomationContext,
  ) => Record<string, ActionEntry> | Promise<Record<string, ActionEntry>>;
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
  historyId?: string;
  noProgressTimeoutMs?: number;
  backgroundNoProgressTimeoutMs?: number;
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
      sql: `SELECT 1 FROM org_members
            WHERE org_id = ? AND LOWER(email) = LOWER(?)
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
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
  const orgId =
    recoveredFactoryOwnerOrgId(
      automation.meta,
      automation.resource.path,
      automation.resource.owner,
    ) ??
    automation.meta.orgId ??
    undefined;
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
    now.getTime() - startedAt < resolveBackgroundRunHardTimeoutMs()
  );
}

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
  let historyId: string | null = null;
  if (options.historyId) {
    historyId = options.historyId;
  } else {
    try {
      const historyOwner = options.orgId
        ? organizationResourceOwner(options.orgId)
        : automation.resource.owner === "__shared__"
          ? options.ownerEmail
          : automation.resource.owner;
      historyId = await startAutomationRun({
        owner: historyOwner,
        automation: automation.name,
        path: automation.resource.path,
        scope: options.orgId ? "organization" : "personal",
        orgId: options.orgId ?? null,
        appId: deps.appId,
      });
    } catch (err) {
      console.error(
        `[automations] Could not open a history record for "${automation.name}"; running anyway:`,
        err,
      );
    }
  }

  let result: BackgroundAutomationRunResult;
  const runIdRef: { current: string | null } = { current: null };
  try {
    result = await executeBackgroundAutomation(
      options,
      deps,
      historyId,
      runIdRef,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode =
      err instanceof BackgroundAutomationRunError
        ? err.errorCode
        : "background_automation_failed";
    captureError(err, {
      tags: {
        area: "background-automation",
        automation: automation.name,
        scope: options.orgId ? "organization" : "personal",
      },
      extra: {
        automationPath: automation.resource.path,
        appId: deps.appId,
        historyId,
      },
      ...(runIdRef.current ? { aiTraceId: runIdRef.current } : {}),
    });
    await recordRunOutcome(
      historyId,
      "error",
      `${message}. No delivery was confirmed.`,
      errorCode,
    );
    throw err;
  }
  await recordRunOutcome(historyId, "success");
  return result;
}

async function recordRunThread(
  historyId: string | null,
  threadId: string,
  runId: string,
): Promise<void> {
  if (!historyId) return;
  try {
    await attachAutomationRunThread(historyId, threadId, runId);
  } catch (err) {
    console.error(
      `[automations] Could not attach thread ${threadId} to run ${historyId}:`,
      err,
    );
  }
}

function backgroundAutomationPersistFailure(input: {
  run: ActiveRun;
  hardTimedOut: boolean;
  hardTimeoutMs?: number;
}): { message: string; errorCode: string } | undefined {
  if (input.hardTimedOut) {
    const minutes = Math.round(
      (input.hardTimeoutMs ?? BACKGROUND_RUN_HARD_TIMEOUT_MS) / 60_000,
    );
    return {
      message: `Background automation timed out after ${minutes} minutes`,
      errorCode: "background_automation_hard_timeout",
    };
  }
  const cutOffReason = backgroundRunCutOffReason(input.run);
  if (!cutOffReason) return undefined;
  return {
    message: `Background automation was cut off before finishing (${cutOffReason})`,
    errorCode: "background_automation_cut_off",
  };
}

async function persistBackgroundAutomationTurn(input: {
  threadId: string;
  threadTitle: string;
  prompt: string;
  run: ActiveRun;
  persistFailure?: { message: string; errorCode: string };
}): Promise<void> {
  await withThreadDataLock(input.threadId, async () => {
    const row = await getThread(input.threadId);
    if (!row) {
      throw new Error(
        `Background automation thread ${input.threadId} was not found while saving run ${input.run.runId}.`,
      );
    }

    let repo: unknown;
    try {
      repo = JSON.parse(row.threadData || "{}");
    } catch {
      throw new Error(
        `Background automation thread ${input.threadId} has unreadable thread data.`,
      );
    }
    if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
      throw new Error(
        `Background automation thread ${input.threadId} has unreadable thread data.`,
      );
    }

    repo = upsertUserMessage(
      repo,
      buildUserMessage({ text: input.prompt, runId: input.run.runId }),
    );
    const events = [...(input.run.events ?? [])];
    if (input.persistFailure) {
      events.push({
        seq: events.length,
        event: {
          type: "error",
          error: input.persistFailure.message,
          errorCode: input.persistFailure.errorCode,
          recoverable: false,
        },
      });
    }
    const assistantMsg = buildAssistantMessage(events, input.run.runId, {
      suppressInternalContinuation: !input.persistFailure,
      turnId: input.run.turnId,
      runDurationMs: Number.isFinite(input.run.startedAt)
        ? Math.max(0, Date.now() - input.run.startedAt)
        : undefined,
    });
    if (assistantMsg) {
      repo = foldAssistantTurn(repo, assistantMsg, {
        runId: input.run.runId,
        turnId: input.run.turnId,
      });
    }

    const meta = extractThreadMeta(repo);
    const messages = (repo as { messages?: unknown[] }).messages;
    await updateThreadData(
      input.threadId,
      JSON.stringify(repo),
      input.threadTitle || row.title,
      meta.preview || row.preview,
      Array.isArray(messages) ? messages.length : 0,
    );
  });
}

async function recordRunOutcome(
  historyId: string | null,
  status: "success" | "error",
  error?: string,
  errorCode?: string,
): Promise<void> {
  if (!historyId) return;
  try {
    await finishAutomationRun(historyId, status, error, errorCode);
  } catch (err) {
    console.error(
      `[automations] Could not record run ${historyId} as ${status}:`,
      err,
    );
  }
}

async function executeBackgroundAutomation(
  options: BackgroundAutomationRunOptions,
  deps: BackgroundAutomationDeps,
  historyId: string | null,
  runIdRef?: { current: string | null },
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
      const baseActions = await deps.getActions(automation);
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

      const ownerApiKey = await resolveOwnerEngineApiKey({ ownerEmail });
      const apiKey = ownerApiKey.apiKey ?? deps.apiKey;
      const apiKeyProvenance = ownerApiKey.apiKey
        ? ownerApiKey.credentialProvenance
        : deps.apiKey
          ? { scope: "deployment" as const }
          : undefined;
      const engine =
        deps.engine ??
        (await resolveEngine({
          apiKey,
          apiKeyEnvVar: ownerApiKey.apiKey
            ? ownerApiKey.apiKeyEnvVar
            : undefined,
          apiKeyProvenance,
          appId: deps.appId,
          credentialIdentity: { userEmail: ownerEmail, orgId },
        }));
      const modelCandidate =
        automation.meta.model ??
        deps.model ??
        (await getStoredModelForEngine(engine, { appId: deps.appId })) ??
        engine.defaultModel;
      const model = normalizeModelForEngine(engine, modelCandidate);
      const systemPrompt = await deps.getSystemPrompt(ownerEmail);
      const thread = await createThread(ownerEmail, {
        title: threadTitle,
        orgId: orgId ?? null,
      });
      const runId = createRunId(options.runIdPrefix);
      if (runIdRef) runIdRef.current = runId;
      await recordRunThread(historyId, thread.id, runId);

      const hardTimeoutMs = resolveBackgroundRunHardTimeoutMs();
      const softTimeoutMs = resolveBackgroundAutomationSoftTimeoutMs();

      const usageRef: {
        current: Awaited<ReturnType<typeof runAgentLoop>> | null;
      } = { current: null };
      let responseText = "";
      let hardAbortTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimedOut = false;

      await insertRun(runId, thread.id, undefined, {
        dispatchMode: "background",
      });
      const claimedOwnRun = await claimBackgroundRun(runId);
      if (!claimedOwnRun) {
        throw new Error(
          `Background automation "${automation.name}" (run "${runId}") could not claim its own freshly-inserted run row`,
        );
      }

      await new Promise<void>((resolve, reject) => {
        const activeRun = startRun(
          runId,
          thread.id,
          async (send, signal, control) => {
            const loopOpts = {
              engine,
              model,
              systemPrompt,
              tools,
              availableTools,
              messages: [
                {
                  role: "user" as const,
                  content: [{ type: "text" as const, text: prompt }],
                },
              ],
              actions,
              send,
              signal,
              threadId: thread.id,
              ownerEmail,
              orgId,
              appId: deps.appId,
              actionCaller: options.actionCaller,
              automation: options.actionAutomation,
              runId,
              maxIterations: automation.meta.maxIterations,
              maxRunInputTokens: automation.meta.maxRunInputTokens,
              reasoningEffort: normalizeReasoningEffortForRequest(
                model,
                automation.meta.reasoningEffort,
              ),
              maxOutputTokens: resolveMainChatMaxOutputTokens(model),
            };
            const execute = (o: typeof loopOpts = loopOpts) =>
              runAgentLoopDirectWithSoftTimeout(
                o,
                softTimeoutMs,
                { backgroundFunction: true },
                control,
              );

            let instrumented = false;
            try {
              const { getObservabilityConfig, instrumentAgentLoop } =
                await import("../observability/traces.js");
              const config = await getObservabilityConfig();
              if (config.enabled) {
                instrumented = true;
                usageRef.current = await instrumentAgentLoop({
                  runAgentLoop: (o) => execute(o as typeof loopOpts),
                  loopOpts,
                  runId,
                  threadId: thread.id,
                  userId: ownerEmail,
                  config,
                  spanName: `background_automation_run:${automation.name}`,
                  metadata: {
                    automation: automation.name,
                    trigger: "background_automation",
                    label: usageLabel,
                    scope: orgId ? "organization" : "personal",
                  },
                });
                return;
              }
            } catch (error) {
              if (instrumented) throw error;
            }
            usageRef.current = await execute();
          },
          async (run) => {
            if (hardAbortTimer) {
              clearTimeout(hardAbortTimer);
              hardAbortTimer = null;
            }
            const persistFailure = backgroundAutomationPersistFailure({
              run,
              hardTimedOut,
              hardTimeoutMs,
            });
            try {
              await persistBackgroundAutomationTurn({
                threadId: thread.id,
                threadTitle,
                prompt,
                run,
                persistFailure,
              });
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
              throw err;
            }
            if (hardTimedOut) return;
            if (persistFailure) {
              reject(
                new BackgroundAutomationRunError(
                  persistFailure.message,
                  persistFailure.errorCode,
                ),
              );
              return;
            }
            if (run.status !== "completed") {
              reject(
                new BackgroundAutomationRunError(
                  `Background automation ended with status: ${run.status}`,
                  `background_automation_${run.status}`,
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
            backgroundFunction: true,
            recoverChunkBoundaries: true,
            dispatchMode: "background",
            noProgressTimeoutMs: options.noProgressTimeoutMs,
            backgroundNoProgressTimeoutMs:
              options.backgroundNoProgressTimeoutMs,
            model,
            engineName: engine.name,
            userId: ownerEmail,
          },
        );

        hardAbortTimer = setTimeout(() => {
          hardAbortTimer = null;
          if (activeRun.status !== "running") return;
          hardTimedOut = true;
          abortRun(runId, "background_automation_hard_timeout");
          const timeoutError = new BackgroundAutomationRunError(
            `Background automation timed out after ${Math.round(hardTimeoutMs / 60_000)} minutes`,
            "background_automation_hard_timeout",
          );
          void activeRun.finalized
            .catch(() => {})
            .then(() => {
              reject(timeoutError);
            });
        }, hardTimeoutMs);
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
          usage.cacheWriteTokens > 0 ||
          usage.builderCreditsUsed != null)
      ) {
        try {
          const { recordUsage } = await import("../usage/store.js");
          await recordUsage({
            ownerEmail,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            ...(usage.builderCreditsUsed == null
              ? {}
              : { builderCreditsUsed: usage.builderCreditsUsed }),
            engineName: usage.engineName ?? engine.name,
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
