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
import {
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
import type { JobFrontmatter } from "./frontmatter.js";
import {
  attachAutomationRunThread,
  finishAutomationRun,
  startAutomationRun,
} from "./run-history.js";

/**
 * Default hard abort for one in-process automation run. Read through
 * `resolveBackgroundRunHardTimeoutMs()` at the use site — this is the host's
 * real function budget for scheduled work, and it differs by deployment.
 */
export const BACKGROUND_RUN_HARD_TIMEOUT_MS = 10 * 60_000;

/**
 * Terminal failure of a background automation, carrying the machine-readable
 * code the failure taxonomy already computes.
 *
 * The code used to be produced and then dropped, so "how often are runs cut
 * off?" was a `LIKE '%no_progress%'` over an English sentence.
 */
export class BackgroundAutomationRunError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "BackgroundAutomationRunError";
    this.errorCode = errorCode;
  }
}

/**
 * Terminal classification for an automation's LLM trace.
 *
 * A hard-aborted automation reached PostHog as "Agent run was aborted" — the
 * same string a user pressing Stop produces — because the abort is what the
 * loop actually sees. The taxonomy code this runner already computes never left
 * the process. The two failures call for different responses, so they need
 * different codes in the one view you go to to tell them apart.
 *
 * Returns `null` for anything else, which leaves `instrumentAgentLoop`'s own
 * classification untouched.
 */
export function classifyBackgroundAutomationTraceError(input: {
  error: unknown;
  hardTimedOut: boolean;
  hardTimeoutMs: number;
}): {
  status: "error";
  errorMessage: string;
  metadata: Record<string, unknown>;
} | null {
  if (!input.hardTimedOut) return null;
  return {
    status: "error",
    errorMessage:
      input.error instanceof Error ? input.error.message : String(input.error),
    metadata: {
      terminal_code: "background_automation_hard_timeout",
      hard_timeout_ms: input.hardTimeoutMs,
    },
  };
}

/** Terminal state of one background automation run, for `onRunOutcome`. */
export interface BackgroundAutomationOutcome {
  automation: string;
  path: string;
  ownerEmail: string;
  orgId?: string;
  historyId: string | null;
  runId: string | null;
  threadId: string | null;
  status: "success" | "error";
  /** Present on every failure: the taxonomy code, not the prose. */
  errorCode?: string;
  error?: string;
  durationMs: number;
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
  /**
   * Fired once per run with its terminal state — success, cut-off, hard
   * timeout, and dispatch failure alike.
   *
   * An application that dispatches an automation otherwise has no way to learn
   * how it ended short of polling `automation_runs`, which is how a queue row
   * sat `claimed` for fifteen minutes after its run had already been recorded
   * dead. Best-effort and awaited-with-catch: a subscriber cannot turn a
   * completed automation into a failed one.
   */
  onRunOutcome?: (outcome: BackgroundAutomationOutcome) => void | Promise<void>;
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
  /** Reuse a history row created by a durable run-now enqueue. */
  historyId?: string;
  /**
   * Per-run overrides for the run-manager no-progress backstop. `startRun` has
   * always accepted these; the automation path had no way to reach them, and
   * the one indirect route (zeroing `agent.runSoftTimeoutMs`) is global and
   * would strip foreground chat of its chunk boundary. Additive: unset means
   * the configured/default behaviour, unchanged.
   */
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
  // Tracks the hard abort: past it no run of this automation is still alive, so
  // a deployment that raises the abort must not have its live runs treated as
  // stuck and re-dispatched underneath themselves.
  return (
    Number.isFinite(startedAt) &&
    now.getTime() - startedAt < resolveBackgroundRunHardTimeoutMs()
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
  // Bookkeeping, so it must not gate the work it describes: a history table
  // that cannot be written should cost us the record, not the automation.
  // Everything downstream tolerates a null id by skipping its own write.
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
  // Populated as soon as the run id exists, so a failure that never returns a
  // result can still be joined to its LLM trace (`aiTraceId` -> $ai_trace_id).
  const runIdRef: { current: string | null } = { current: null };
  const threadIdRef: { current: string | null } = { current: null };
  const startedAt = Date.now();
  const reportOutcome = async (
    outcome: Omit<
      BackgroundAutomationOutcome,
      | "automation"
      | "path"
      | "ownerEmail"
      | "orgId"
      | "historyId"
      | "runId"
      | "threadId"
      | "durationMs"
    >,
  ): Promise<void> => {
    if (!deps.onRunOutcome) return;
    try {
      await deps.onRunOutcome({
        automation: automation.name,
        path: automation.resource.path,
        ownerEmail: options.ownerEmail,
        orgId: options.orgId,
        historyId,
        runId: runIdRef.current,
        threadId: threadIdRef.current,
        durationMs: Date.now() - startedAt,
        ...outcome,
      });
    } catch (err) {
      console.error(
        `[automations] onRunOutcome subscriber threw for "${automation.name}":`,
        err,
      );
    }
  };
  try {
    result = await executeBackgroundAutomation(
      options,
      deps,
      historyId,
      runIdRef,
      threadIdRef,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode =
      err instanceof BackgroundAutomationRunError
        ? err.errorCode
        : "background_automation_failed";
    // Both callers (recurring-jobs scheduler, trigger dispatcher) record this
    // onto the automation's own metadata and console.error it, and neither
    // reports it. A failure visible only in a resource field and stdout is not
    // a failure anyone sees: the run-level no-progress cutoff killed
    // automations across two releases without ever raising an issue.
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
    await reportOutcome({
      status: "error",
      errorCode,
      error: `${message}. No delivery was confirmed.`,
    });
    throw err;
  }
  // Outside the try: history is bookkeeping about the run, so a failure to
  // write it must not turn a completed automation into a reported failure.
  await recordRunOutcome(historyId, "success");
  await reportOutcome({ status: "success" });
  return result;
}

/**
 * Link the run to its agent thread. Bookkeeping again: the automation is
 * already executing by this point, so a failed write costs the cross-reference
 * in the history view, not the run.
 */
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

/**
 * Chat opens `/chat/:threadId` from `thread_data`, not `agent_run_events`.
 * Persist before the cut-off/status reject so a failed run still has a
 * visible trace. Keep the scheduler title — `extractThreadMeta` would
 * otherwise replace `Job: …` with the prompt excerpt.
 *
 * Cut-off and hard-abort turns have no terminal error event of their own.
 * `suppressInternalContinuation` also drops `auto_continue`, so persist
 * would otherwise store a completed assistant message. Append a
 * non-recoverable error and skip that suppress so Open thread shows the
 * incomplete state.
 */
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
  threadIdRef?: { current: string | null },
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

      const userApiKey = await getOwnerActiveApiKey(ownerEmail);
      // The run manager invokes its detached callback after the scheduler's
      // setup stack has yielded, so the engine's credentials must be captured
      // now, while the owner/org identity is explicit. Passing
      // `credentialIdentity` is what makes resolveEngine capture them, on the
      // same gateway lane the interactive path uses — a Builder-credits site has
      // no per-user connection to find, so resolving that lane by hand here once
      // left every scheduled automation dead while chat still worked.
      const engine =
        deps.engine ??
        (await resolveEngine({
          apiKey: userApiKey ?? deps.apiKey,
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
      if (threadIdRef) threadIdRef.current = thread.id;
      await recordRunThread(historyId, thread.id, runId);

      // Scheduled work is background work: it has no synchronous serverless
      // caller waiting on it, so it must not inherit the interactive clamp
      // (40s soft timeout, a 30s no-progress backstop at 0.75x that, and 6
      // continuations). A dashboard render or digest legitimately spends
      // minutes across many tool calls, and dies the first time any gap
      // between two of them exceeds 30s — recorded as `no_progress` after
      // several minutes of real work, because the backstop is suspended
      // while a tool is in flight but not between tools.
      //
      // Hardcoded rather than `isInBackgroundFunctionRuntime()` (what
      // webhook-handler.ts uses): a webhook can arrive on either runtime, but
      // a scheduler tick never serves a synchronous request, so the
      // interactive clamp never applies to it.
      //
      // Derived from this runner's OWN hard abort, not from the durable-chat
      // background ceiling: that ceiling is 13 minutes and this process is
      // killed at 10, so taking it left the recoverable soft-timeout boundary
      // as dead code and the terminal no-progress backstop as the only
      // boundary an automation could reach.
      const hardTimeoutMs = resolveBackgroundRunHardTimeoutMs();
      const softTimeoutMs = resolveBackgroundAutomationSoftTimeoutMs();

      const usageRef: {
        current: Awaited<ReturnType<typeof runAgentLoop>> | null;
      } = { current: null };
      let responseText = "";
      let hardAbortTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimedOut = false;

      // This runner executes in-process, synchronously — there is no HTTP
      // self-dispatch to a separate worker. Self-claim the row into
      // 'background-processing' right away, exactly like a genuine HTTP
      // background worker does immediately after its own insert (see
      // production-agent.ts's `claimBackgroundWorkerRunEarly`). Without this,
      // the row sits at dispatch_mode='background' for its whole life with no
      // worker ever claiming it, which is indistinguishable from a lost HTTP
      // handoff to the unclaimed-background-run sweep — it gets reaped as
      // "background_worker_never_started" out from under a still-executing
      // job the moment any single tool call runs past the 25s grace window.
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
            };
            // Same adapter A2A uses: bridge this runner's multi-argument shape
            // to the single-argument `runAgentLoop` `instrumentAgentLoop`
            // expects. `control` is what lets a chunk boundary be recovered
            // here instead of ending the turn.
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
                  // A scheduled run is NOT anonymous. Passing the owner is what
                  // makes it visible to per-user observability reads.
                  userId: ownerEmail,
                  config,
                  spanName: "background_automation_run",
                  metadata: {
                    automation: automation.name,
                    trigger: "background_automation",
                    scope: orgId ? "organization" : "personal",
                  },
                  classifyError: (error) =>
                    classifyBackgroundAutomationTraceError({
                      error,
                      hardTimedOut,
                      hardTimeoutMs,
                    }),
                });
                return;
              }
            } catch (error) {
              // Match A2A and interactive chat: a setup failure falls through
              // to an uninstrumented run, but a failure from INSIDE the
              // instrumented loop is the real run failure and must rethrow.
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
            // Hard timeout owns the runner reject so a serverless return
            // waits for this persist via `activeRun.finalized`.
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
            // This runner owns continuation in-process: there is no HTTP body
            // to re-POST and no `chainServerDrivenContinuation` behind it, so a
            // checkpoint must end the CHUNK and let the loop above recover it.
            recoverChunkBoundaries: true,
            // Matches the `dispatch_mode` this runner already writes onto the
            // run row at insert. Without it the terminal and boundary analytics
            // events reported every scheduled run as foreground.
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
          activeRun.abort.abort("background_automation_hard_timeout");
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
