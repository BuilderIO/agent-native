import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import type { ActionAutomationContext, ActionCaller } from "../action.js";
import {
  CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "../agent/engine/credential-errors.js";
import {
  getStoredModelForEngine,
  isResolvedEngineUsableForRequest,
  normalizeModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import { resolveMainChatMaxOutputTokens } from "../agent/engine/output-tokens.js";
import type { AgentEngine, EngineMessage } from "../agent/engine/types.js";
import {
  actionsToEngineTools,
  filterInitialEngineTools,
  resolveOwnerEngineApiKey,
  runAgentLoop,
  appendAgentLoopContinuation,
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
import {
  claimBackgroundRun,
  insertRun,
  tryClaimRunSlot,
  releaseBackgroundRunBeforeStart,
} from "../agent/run-store.js";
import {
  buildCurrentTimeUserContext,
  buildRuntimeContextPrompt,
} from "../agent/runtime-context.js";
import {
  buildAssistantMessage,
  buildUserMessage,
  extractThreadMeta,
  foldAssistantTurn,
  upsertUserMessage,
  threadDataToEngineMessages,
  threadMessageTextForEngine,
} from "../agent/thread-data-builder.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
} from "../agent/tool-call-journal.js";
import { attachToolSearch } from "../agent/tool-search.js";
import type { AgentChatEvent } from "../agent/types.js";
import {
  lookupOwnerAccount,
  resolveAutomationExecutionIdentity,
  type AutomationExecutionIdentity,
} from "../automations/service.js";
import {
  createThread,
  getThread,
  updateThreadData,
  withThreadDataLock,
} from "../chat-threads/store.js";
import { withDbExec, type DbExec } from "../db/client.js";
import { automationOutcomeMessagesForUser } from "../localization/automation-outcome-messages.js";
import { automationRecoveryMessagesForLocale } from "../localization/automation-recovery-messages.js";
import { queryOrgMembers } from "../org/context.js";
import {
  organizationIdFromResourceOwner,
  type Resource,
} from "../resources/store.js";
import { captureError } from "../server/capture-error.js";
import {
  BuilderCredentialLookupError,
  CredentialStoreUnavailableError,
} from "../server/credential-provider.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "../server/request-context.js";
import { normalizeReasoningEffortForRequest } from "../shared/reasoning-effort.js";
import automationNoOpAction, {
  AUTOMATION_NO_OP_TOOL,
  automationNoOpSchema,
} from "./actions/automation-no-op.js";
import {
  applyAutomationFailure,
  automationOwnerKind,
  classifyAutomationFailure,
  CONFIG_INVALID_ERROR_CODE,
  CONNECTION_REQUIRED_ERROR_CODE,
  MISSING_TOOLS_ERROR_CODE,
  OWNER_MISSING_ERROR_CODE,
  pausedMessage,
  withDeliveryNote,
  type AutomationFailure,
} from "./automation-outcome.js";
import {
  AutomationRecoveryStorageError,
  deliveryNoteForEvents,
  readAutomationRecoveryEvents,
  readAutomationRunDeliveryNote,
  withAutomationRecoveryStorage,
  type AutomationResume,
} from "./automation-recovery.js";
import {
  automationRunTerminalError,
  type AutomationTerminalEvent,
} from "./automation-terminal-error.js";
import { inspectAutomationWork } from "./automation-work-evidence.js";
import { effectiveTimezone } from "./cron.js";
import {
  recoveredFactoryOwnerOrgId,
  type JobFrontmatter,
} from "./frontmatter.js";
import { automationRunOwnership } from "./run-history-ownership.js";
import {
  attachAutomationRunThread,
  AutomationRunHistoryClaimLostError,
  finishAutomationRun,
  startAutomationRun,
  type StartAutomationRunOptions,
} from "./run-history.js";
import { AutomationSchedulerLeaseLostError } from "./scheduler-health.js";

export const BACKGROUND_RUN_HARD_TIMEOUT_MS = 10 * 60_000;

export class BackgroundAutomationRunError extends Error {
  readonly errorCode: string;
  readonly deliveryNote?: string;
  constructor(message: string, errorCode: string, deliveryNote?: string) {
    super(message);
    this.name = "BackgroundAutomationRunError";
    this.errorCode = errorCode;
    this.deliveryNote = deliveryNote;
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

/** The run an automation started, filled in as soon as it has one. */
interface AutomationRunRef {
  current: string | null;
  threadId?: string;
}

export interface BackgroundAutomationRunOptions {
  resume?: AutomationResume;
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
  assertCanStart?: () => Promise<void>;
  hardTimeoutMs?: number;
  hardDeadlineAt?: number;
  noProgressTimeoutMs?: number;
  backgroundNoProgressTimeoutMs?: number;
  /** A run the owner asked for: it records its cause but never pauses the automation. */
  manual?: boolean;
  /** The event this run handles; retries of one event move the streak once. */
  eventId?: string;
}

interface BackgroundAutomationRunOutput {
  responseText: string;
  runId: string;
}

export type BackgroundAutomationRunResult = BackgroundAutomationRunOutput &
  ({ status: "success" } | { status: "skipped"; reason: string });

/**
 * `owner_missing` is permanent (the user or membership is gone);
 * `owner_unverifiable` means the lookup itself failed and must be retried, not
 * recorded as the owner being gone.
 */
export type AutomationIdentityFailureCode =
  | typeof OWNER_MISSING_ERROR_CODE
  | "owner_unverifiable"
  | typeof CONFIG_INVALID_ERROR_CODE;

export type AutomationIdentityValidation =
  | { ok: true }
  | { ok: false; reason: string; code: AutomationIdentityFailureCode };

export type BackgroundAutomationIdentityResult =
  | { ok: true; identity: AutomationExecutionIdentity }
  | { ok: false; reason: string; code?: AutomationIdentityFailureCode };

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
    const account = await lookupOwnerAccount(ownerEmail);
    if (account === "missing") {
      return {
        ok: false,
        reason: `user "${ownerEmail}" no longer exists`,
        code: OWNER_MISSING_ERROR_CODE,
      };
    }
    // No built-in accounts: like unconfigured auth tables, a personal owner
    // cannot be checked here; an org member's standing cannot be proven.
    if (account === "untracked" && orgId) {
      return {
        ok: false,
        reason: `could not verify user "${ownerEmail}": this deployment keeps no built-in user accounts`,
        code: "owner_unverifiable",
      };
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
      code: "owner_unverifiable",
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
        code: "owner_unverifiable",
      };
    }
    if (memberRows.length === 0) {
      return {
        ok: false,
        reason: `user "${ownerEmail}" is no longer a member of org "${orgId}"`,
        code: OWNER_MISSING_ERROR_CODE,
      };
    }
    return { ok: true };
  } catch {
    // coercion-ok: reported as `owner_unverifiable`, which the scheduler retries instead of treating the owner as gone.
    return {
      ok: false,
      reason: `could not verify membership in org "${orgId}"`,
      code: "owner_unverifiable",
    };
  }
}

export async function resolveBackgroundAutomationIdentity(
  automation: BackgroundAutomationContext,
): Promise<BackgroundAutomationIdentityResult> {
  if (automation.meta.triggerType) {
    let resolved: Awaited<
      ReturnType<typeof resolveAutomationExecutionIdentity>
    >;
    try {
      resolved = await resolveAutomationExecutionIdentity(
        automation.resource.owner,
        automation.meta,
      );
    } catch {
      // coercion-ok: reported as `owner_unverifiable`, which the scheduler retries instead of treating the owner as gone.
      return {
        ok: false,
        reason: "Could not verify the automation execution identity.",
        code: "owner_unverifiable",
      };
    }
    if (!resolved.ok) return resolved;
    // The service verifies an organization creator exists; a personal
    // automation's owner was never looked up, so a deleted user kept running.
    if (!organizationIdFromResourceOwner(automation.resource.owner)) {
      const exists = await validateAutomationRunIdentity(
        resolved.identity.userEmail,
      );
      if (!exists.ok) return exists;
    }
    return resolved;
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
  meta: Pick<JobFrontmatter, "lastRun" | "lastStatus" | "lastHistoryId">,
  now = new Date(),
): boolean {
  if (meta.lastStatus !== "running") return false;
  // Exact firing markers remain owned until the scheduler reconciles history.
  if (meta.lastHistoryId) return true;
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

function assertHardDeadline(deadlineAt?: number): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new BackgroundAutomationRunError(
      "Background automation time budget expired during setup.",
      "background_automation_hard_timeout",
    );
  }
}

function assertRequestedMcpToolsAvailable(
  automation: BackgroundAutomationContext,
  actions: Record<string, ActionEntry>,
): void {
  const requested = automation.meta.mcpTools ?? [];
  const missing = requested.filter((toolName) => !actions[toolName]);
  if (missing.length > 0) {
    throw new BackgroundAutomationRunError(
      `Configured MCP tools are unavailable in this run: ${missing.join(", ")}. Reconnect the MCP server or update the automation's capability list.`,
      MISSING_TOOLS_ERROR_CODE,
    );
  }
}

function missingCredentialsMessage(ownerEmail: string, orgId?: string): string {
  const kind = automationOwnerKind(ownerEmail);
  if (kind === "user") return LLM_MISSING_CREDENTIALS_MESSAGE;
  // A shared or organization automation never borrows its creator's personal
  // connection, so only someone who administers that scope can fix this.
  const scope =
    kind === "organization"
      ? `organization "${orgId ?? organizationIdFromResourceOwner(ownerEmail)}"`
      : "the shared workspace";
  return `${LLM_MISSING_CREDENTIALS_MESSAGE} This automation runs as ${scope}, so an admin of ${kind === "organization" ? "that organization" : "the workspace"} must connect the provider; the creator's personal connection is not used.`;
}

async function assertLlmCredentialsUsable(input: {
  engine: AgentEngine;
  apiKey: string | undefined;
  ownerEmail: string;
  orgId?: string;
}): Promise<void> {
  let usable: boolean;
  try {
    usable = await isResolvedEngineUsableForRequest(input.engine, {
      apiKey: input.apiKey,
      credentialIdentity: { userEmail: input.ownerEmail, orgId: input.orgId },
    });
  } catch (error) {
    if (
      error instanceof CredentialStoreUnavailableError ||
      error instanceof BuilderCredentialLookupError
    ) {
      // An unreadable credential store is not an absent credential: this is
      // retried, never recorded as missing_credentials.
      throw new BackgroundAutomationRunError(
        "The credential store could not be read, so the LLM credential could not be checked.",
        CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE,
      );
    }
    throw error;
  }
  if (!usable) {
    throw new BackgroundAutomationRunError(
      missingCredentialsMessage(input.ownerEmail, input.orgId),
      LLM_MISSING_CREDENTIALS_ERROR_CODE,
    );
  }
}

/**
 * The cause a failed run recorded for itself. Without this, a run that ended
 * on `missing_credentials` surfaced as the generic "ended with status:
 * errored" and the owner never learned why.
 *
 * A run that yielded to a connection request is a failed run even though it
 * ended on a clean `done`: nobody is there to answer the request.
 */
export function backgroundRunTerminalError(run: {
  events?: readonly {
    event: AutomationTerminalEvent;
  }[];
}): { message: string; errorCode?: string } | null {
  return automationRunTerminalError(
    (run.events ?? []).map(({ event }) => event),
  );
}

/**
 * Organization and shared jobs run as a scope, which has no inbox. Their
 * creator is told only while still a member of that scope (the alert carries
 * the automation's real error text); otherwise an org owner or admin is.
 */
async function notificationEmailFor(
  automationName: string,
  ownerEmail: string,
  createdBy: string | undefined,
  orgId: string | undefined,
): Promise<string | undefined> {
  const owner = ownerEmail.trim();
  if (owner.includes("@") && automationOwnerKind(owner) === "user") {
    return owner;
  }
  const creator = createdBy?.trim();
  if (
    creator?.includes("@") &&
    automationOwnerKind(creator) === "user" &&
    (await validateAutomationRunIdentity(creator, orgId)).ok
  ) {
    return creator;
  }
  const admin = orgId ? await orgAdminEmail(orgId) : undefined;
  if (!admin) {
    console.error(
      `[automations] automation_alert_no_recipient: "${automationName}" runs as ${owner} and has no member to alert (creator "${creator ?? "none"}" is not a current member${orgId ? `, org "${orgId}" has no owner or admin` : ""}).`,
    );
  }
  return admin;
}

async function orgAdminEmail(orgId: string): Promise<string | undefined> {
  const rows = await queryOrgMembers({
    sql: `SELECT email FROM org_members
          WHERE org_id = ? AND role IN ('owner', 'admin')
            AND federation_removal_pending_at IS NULL
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, email
          LIMIT 1`,
    args: [orgId],
  });
  if (rows === null) {
    console.error(
      `[automations] automation_alert_no_recipient: could not read the owners of org "${orgId}".`,
    );
    return undefined;
  }
  const email = rows[0]?.email;
  return typeof email === "string" && email ? email : undefined;
}

function createRunId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function startBackgroundAutomationHistory(
  automation: BackgroundAutomationContext,
  ownerEmail: string,
  orgId?: string,
  appId?: string,
  options?: StartAutomationRunOptions,
): Promise<string> {
  return startAutomationRun(
    {
      ...automationRunOwnership(automation.resource.owner, ownerEmail, orgId),
      automation: automation.name,
      path: automation.resource.path,
      appId,
      notificationEmail: await notificationEmailFor(
        automation.name,
        ownerEmail,
        automation.meta.createdBy,
        orgId,
      ),
    },
    options,
  );
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
      historyId = await startBackgroundAutomationHistory(
        automation,
        options.ownerEmail,
        options.orgId,
        deps.appId,
      );
    } catch (err) {
      console.error(
        `[automations] Could not open a history record for "${automation.name}"; running anyway:`,
        err,
      );
    }
  }

  let result: BackgroundAutomationRunResult;
  const runIdRef: AutomationRunRef = {
    current: options.resume?.previousRunId ?? null,
    threadId: options.resume?.threadId,
  };
  try {
    result = await executeBackgroundAutomation(
      options,
      deps,
      historyId,
      runIdRef,
    );
  } catch (err) {
    if (
      err instanceof AutomationSchedulerLeaseLostError ||
      err instanceof AutomationRecoveryStorageError ||
      (err instanceof BackgroundAutomationRunError &&
        (err.errorCode === "background_automation_claim_lost" ||
          err.errorCode === "background_automation_history_write_failed"))
    )
      throw err;
    const failure = classifyAutomationFailure(err);
    if (runIdRef.current) {
      failure.deliveryNote = await readAutomationRunDeliveryNote(
        runIdRef.current,
      );
    }
    // Same transition the scheduler persists, so the run that pauses the
    // automation is the one that tells its owner.
    const transition = applyAutomationFailure(
      automation.meta,
      failure,
      new Date(),
      { countTowardPause: !options.manual, eventId: options.eventId },
    );
    captureError(err, {
      tags: {
        area: "background-automation",
        automation: automation.name,
        scope: options.orgId ? "organization" : "personal",
        errorCode: failure.code,
        failureKind: failure.precondition ? "precondition" : "runtime",
        ownerKind: automationOwnerKind(options.ownerEmail),
      },
      extra: {
        automationPath: automation.resource.path,
        automationName: automation.name,
        appId: deps.appId,
        historyId,
        errorCode: failure.code,
        consecutiveFailures: transition.consecutiveFailures,
        paused: transition.pause,
      },
      ...(runIdRef.current ? { aiTraceId: runIdRef.current } : {}),
      failure: {
        automationName: automation.name,
        // Outside any request, so the boundary cannot read the scope itself.
        userScope: options.orgId ? "org" : "personal",
        ...(runIdRef.threadId ? { threadId: runIdRef.threadId } : {}),
      },
    });
    await recordRunOutcome(
      historyId,
      runIdRef.current,
      "error",
      transition.pause
        ? pausedMessage(
            failure.code,
            transition.consecutiveFailures,
            failure.message,
            failure.deliveryNote,
          )
        : withDeliveryNote(failure.message, failure.deliveryNote),
      failure.code,
      // A precondition failure repeats identically until fixed, so only the
      // run that pauses the automation emails its owner.
      !(failure.precondition && !transition.pause),
      Boolean(options.historyId),
    );
    throw new BackgroundAutomationRunError(
      failure.message,
      failure.code,
      failure.deliveryNote,
    );
  }
  await recordRunOutcome(
    historyId,
    runIdRef.current,
    result.status,
    result.status === "skipped" ? result.reason : undefined,
    undefined,
    true,
    Boolean(options.historyId),
  );
  return result;
}

async function recordRunThread(
  historyId: string | null,
  threadId: string,
  runId: string,
  strict: boolean,
  expectedRunId?: string,
): Promise<void> {
  if (!historyId) return;
  try {
    await attachAutomationRunThread(historyId, threadId, runId, {
      requirePersisted: strict,
      ...(expectedRunId !== undefined ? { expectedRunId } : {}),
    });
  } catch (err) {
    if (err instanceof AutomationRunHistoryClaimLostError)
      throw new BackgroundAutomationRunError(
        deliveryNoteForEvents(null),
        err.errorCode,
      );
    if (strict)
      throw new BackgroundAutomationRunError(
        deliveryNoteForEvents(null),
        "background_automation_history_write_failed",
      );
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
  if (cutOffReason) {
    return {
      message: `Background automation was cut off before finishing (${cutOffReason})`,
      errorCode: "background_automation_cut_off",
    };
  }
  // Decided here, ahead of work confirmation: the failed tool that preceded the
  // request would otherwise type the run `automation_no_confirmed_work`.
  const cause = backgroundRunTerminalError(input.run);
  if (cause?.errorCode === CONNECTION_REQUIRED_ERROR_CODE) {
    return { message: cause.message, errorCode: cause.errorCode };
  }
  return undefined;
}

async function persistBackgroundAutomationTurn(input: {
  threadId: string;
  threadTitle: string;
  prompt: string;
  run: Pick<ActiveRun, "runId" | "turnId" | "startedAt" | "events">;
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
      buildUserMessage({
        text: input.prompt,
        runId: input.run.turnId,
        turnId: input.run.turnId,
      }),
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
  expectedRunId: string | null,
  status: "success" | "error" | "skipped",
  error?: string,
  errorCode?: string,
  notify = true,
  strict = false,
): Promise<void> {
  if (!historyId) return;
  try {
    const writeOptions =
      notify && !strict
        ? undefined
        : {
            notify,
            ...(strict ? { requirePersisted: true, expectedRunId } : {}),
          };
    await finishAutomationRun(
      historyId,
      status,
      error,
      errorCode,
      writeOptions,
    );
  } catch (err) {
    console.error(
      `[automations] Could not record run ${historyId} as ${status}:`,
      err,
    );
    if (strict)
      throw new BackgroundAutomationRunError(
        deliveryNoteForEvents(null),
        "background_automation_history_write_failed",
      );
  }
}

async function confirmAutomationWork(
  automation: BackgroundAutomationContext,
  ownerEmail: string,
  run: ActiveRun,
  responseText: string,
  actions: Record<string, ActionEntry>,
  noOpReason: string | undefined,
  priorEvents: readonly AgentChatEvent[],
): Promise<{ status: "success" } | { status: "skipped"; reason: string }> {
  const evidence = inspectAutomationWork(
    [...priorEvents, ...(run.events ?? []).map(({ event }) => event)],
    {
      noOpReason,
      confirmsWork: (tool) => actions[tool]?.confirmsAutomationWork !== false,
    },
  );
  if (evidence.status === "skipped") return evidence;
  const { deliveryPlatform, deliveryDestination } = automation.meta;
  if (
    (evidence.status === "success" || !evidence.noOpDeclared) &&
    deliveryPlatform &&
    deliveryDestination &&
    responseText.trim()
  ) {
    const { getDefaultAdapter } =
      await import("../integrations/adapters/index.js");
    const adapter = getDefaultAdapter(deliveryPlatform);
    if (!adapter?.sendMessageToTarget) {
      throw new BackgroundAutomationRunError(
        `Automation delivery is not supported for ${deliveryPlatform}`,
        CONFIG_INVALID_ERROR_CODE,
      );
    }
    await adapter.sendMessageToTarget(
      adapter.formatAgentResponse(responseText),
      {
        destination: deliveryDestination,
        threadRef: automation.meta.deliveryThreadRef ?? null,
        tenantId: automation.meta.deliveryTenantId,
      },
    );
    return { status: "success" };
  }
  if (evidence.status === "success") return evidence;

  const messages = await automationOutcomeMessagesForUser(ownerEmail);
  const detail = evidence.failedTool?.result;
  throw new BackgroundAutomationRunError(
    `${deliveryPlatform && deliveryDestination ? messages.emptyDelivery : messages.noWork}${detail ? ` ${detail}` : ""}`,
    evidence.failedTool?.errorCode ?? "automation_no_confirmed_work",
  );
}

/**
 * Everything below runs before any thread or `agent_runs` row exists, so an
 * automation that cannot run fails here, once, instead of leaving a "Job:"
 * chat thread per scheduler tick.
 */
async function assertDeliveryTargetSupported(
  automation: BackgroundAutomationContext,
): Promise<void> {
  const { deliveryPlatform, deliveryDestination } = automation.meta;
  if (!deliveryPlatform || !deliveryDestination) return;
  const { getDefaultAdapter } =
    await import("../integrations/adapters/index.js");
  if (!getDefaultAdapter(deliveryPlatform)?.sendMessageToTarget) {
    throw new BackgroundAutomationRunError(
      `Automation delivery is not supported for ${deliveryPlatform}`,
      CONFIG_INVALID_ERROR_CODE,
    );
  }
}

async function resolveUsableBackgroundEngine(
  identity: { ownerEmail: string; orgId?: string },
  deps: BackgroundAutomationDeps,
  assertDeadline: () => void,
): Promise<AgentEngine> {
  const { ownerEmail, orgId } = identity;
  assertDeadline();
  const ownerApiKey = await resolveOwnerEngineApiKey({ ownerEmail });
  assertDeadline();
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
      apiKeyEnvVar: ownerApiKey.apiKey ? ownerApiKey.apiKeyEnvVar : undefined,
      apiKeyProvenance,
      appId: deps.appId,
      credentialIdentity: { userEmail: ownerEmail, orgId },
    }));
  await assertLlmCredentialsUsable({ engine, apiKey, ownerEmail, orgId });
  return engine;
}

async function resolveBackgroundAutomationModel(
  engine: AgentEngine,
  automationModel: string | undefined,
  deps: BackgroundAutomationDeps,
): Promise<string> {
  const modelCandidate =
    automationModel ??
    deps.model ??
    (await getStoredModelForEngine(engine, { appId: deps.appId })) ??
    engine.defaultModel;
  return normalizeModelForEngine(engine, modelCandidate);
}

/**
 * Whether the automation's run identity has a usable LLM credential right now,
 * without starting a run. The scheduler asks this to resume an automation it
 * paused for `missing_credentials` as soon as the credential exists.
 */
export async function checkBackgroundAutomationCredentials(
  identity: { ownerEmail: string; orgId?: string },
  deps: BackgroundAutomationDeps,
  automationModel?: string,
): Promise<
  | { ok: true; engine: AgentEngine; model: string }
  | { ok: false; failure: AutomationFailure }
> {
  try {
    const { engine, model } = await runWithRequestContext(
      { userEmail: identity.ownerEmail, orgId: identity.orgId },
      async () => {
        const engine = await resolveUsableBackgroundEngine(
          identity,
          deps,
          () => undefined,
        );
        const model = await resolveBackgroundAutomationModel(
          engine,
          automationModel,
          deps,
        );
        return { engine, model };
      },
    );
    return { ok: true, engine, model };
  } catch (error) {
    return { ok: false, failure: classifyAutomationFailure(error) };
  }
}

async function executeBackgroundAutomation(
  options: BackgroundAutomationRunOptions,
  deps: BackgroundAutomationDeps,
  historyId: string | null,
  runIdRef?: AutomationRunRef,
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
      assertHardDeadline(options.hardDeadlineAt);
      let noOpReason: string | undefined;
      const messages = await automationOutcomeMessagesForUser(ownerEmail);
      const baseActions: Record<string, ActionEntry> = {
        ...(await deps.getActions(automation)),
        [AUTOMATION_NO_OP_TOOL]: {
          ...automationNoOpAction,
          agentTool: true,
          confirmsAutomationWork: false,
          tool: {
            ...automationNoOpAction.tool,
            description: messages.noOpInstruction,
            parameters: {
              ...automationNoOpAction.tool.parameters,
              type: "object",
              properties: {
                ...automationNoOpAction.tool.parameters?.properties,
                reason: {
                  ...(automationNoOpAction.tool.parameters?.properties
                    ?.reason as Record<string, unknown>),
                  type: "string",
                  description: messages.noOpReason,
                },
              },
            },
          },
          run: async (args, ctx) => {
            const result = await automationNoOpAction.run(
              automationNoOpSchema.parse(args),
              ctx,
            );
            noOpReason = result.reason;
            return result;
          },
        },
      };
      assertHardDeadline(options.hardDeadlineAt);
      assertRequestedMcpToolsAvailable(automation, baseActions);

      const configuredInitialTools = deps.getInitialToolNames?.(automation);
      const initialToolNames = configuredInitialTools
        ? uniqueToolNames([
            ...configuredInitialTools,
            ...(automation.meta.mcpTools ?? []),
          ])
        : undefined;
      if (
        initialToolNames &&
        !initialToolNames.includes(AUTOMATION_NO_OP_TOOL)
      ) {
        initialToolNames.push(AUTOMATION_NO_OP_TOOL);
      }
      const actions = initialToolNames
        ? attachToolSearch({ ...baseActions })
        : baseActions;
      const availableTools = actionsToEngineTools(actions);
      const tools = filterInitialEngineTools(availableTools, initialToolNames);

      assertHardDeadline(options.hardDeadlineAt);
      await assertDeliveryTargetSupported(automation);
      const engine = await resolveUsableBackgroundEngine(
        { ownerEmail, orgId },
        deps,
        () => assertHardDeadline(options.hardDeadlineAt),
      );
      assertHardDeadline(options.hardDeadlineAt);
      const model = await resolveBackgroundAutomationModel(
        engine,
        automation.meta.model,
        deps,
      );
      assertHardDeadline(options.hardDeadlineAt);
      const systemPrompt = `${await deps.getSystemPrompt(ownerEmail)}\n\n${messages.noOpInstruction}`;
      assertHardDeadline(options.hardDeadlineAt);
      const resume = options.resume;
      const thread = resume
        ? await withAutomationRecoveryStorage(() => getThread(resume.threadId))
        : await createThread(ownerEmail, {
            title: threadTitle,
            orgId: orgId ?? null,
          });
      if (!thread)
        throw new Error(
          `Automation recovery thread ${options.resume?.threadId} was not found`,
        );
      assertHardDeadline(options.hardDeadlineAt);
      const runId = createRunId(options.runIdPrefix);
      const turnId = options.resume?.turnId ?? runId;
      const runtimeContext = {
        now: new Date(),
        timezone: effectiveTimezone(automation.meta.timezone),
      };
      let executionPrompt =
        prompt + buildCurrentTimeUserContext(runtimeContext);
      let engineMessages: EngineMessage[] = [
        { role: "user", content: [{ type: "text", text: executionPrompt }] },
      ];
      let priorEvents: AgentChatEvent[] = [];
      if (options.resume) {
        const saved = JSON.parse(
          "threadData" in thread ? thread.threadData || "{}" : "{}",
        );
        const original = Array.isArray(saved.messages)
          ? saved.messages
              .map((entry: any) => entry.message ?? entry)
              .find(
                (message: any) =>
                  message.role === "user" &&
                  (message.metadata?.custom?.submittedTurnId === turnId ||
                    message.metadata?.custom?.submittedRunId === turnId),
              )
          : undefined;
        const originalPrompt = original
          ? threadMessageTextForEngine(original)
          : "";
        if (!originalPrompt.trim())
          throw new BackgroundAutomationRunError(
            automationRecoveryMessagesForLocale().missingPrompt,
            "background_automation_resume_context_missing",
          );
        executionPrompt = originalPrompt;
        const events = await readAutomationRecoveryEvents(thread.id, turnId);
        priorEvents = events.map(({ event }) => event);
        const partial = buildAssistantMessage(
          events,
          options.resume.previousRunId,
          { turnId, suppressInternalContinuation: true },
        );
        const resumed = threadDataToEngineMessages(
          {
            messages: [
              buildUserMessage({
                text: originalPrompt,
                runId: turnId,
                turnId,
              }),
              ...(partial ? [partial] : []),
            ],
          },
          { includeToolCalls: true },
        );
        const journalNote = buildResumeJournalNote(
          classifyToolCallJournal(events.map(({ event }) => event)),
        );
        appendAgentLoopContinuation(
          resumed,
          "run_timeout",
          journalNote ? { journalNote } : {},
        );
        engineMessages = resumed;
      }
      assertHardDeadline(options.hardDeadlineAt);

      const maxHardTimeoutMs = Math.min(
        options.hardTimeoutMs ?? Number.POSITIVE_INFINITY,
        resolveBackgroundRunHardTimeoutMs(),
      );
      const softTimeoutMs = resolveBackgroundAutomationSoftTimeoutMs();

      const usageRef: {
        current: Awaited<ReturnType<typeof runAgentLoop>> | null;
      } = { current: null };
      let responseText = "";
      let outcome:
        | Awaited<ReturnType<typeof confirmAutomationWork>>
        | undefined;
      let hardAbortTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimedOut = false;

      assertHardDeadline(options.hardDeadlineAt);
      try {
        await persistBackgroundAutomationTurn({
          threadId: thread.id,
          threadTitle,
          prompt: executionPrompt,
          run: { runId, turnId, startedAt: Date.now(), events: [] },
        });
        const afterInsert = (tx: DbExec) =>
          withDbExec(tx, async () => {
            await recordRunThread(
              historyId,
              thread.id,
              runId,
              Boolean(options.historyId),
              options.resume?.previousRunId,
            );
            if (!(await claimBackgroundRun(runId)))
              throw new Error(
                `Background automation "${automation.name}" (run "${runId}") could not claim its own freshly-inserted run row`,
              );
          });
        if (options.resume) {
          const claim = await tryClaimRunSlot(thread.id, runId, undefined, {
            turnId,
            dispatchMode: "background",
            afterInsert,
          });
          if (!claim.claimed)
            throw new BackgroundAutomationRunError(
              `Automation recovery could not claim turn ${turnId}`,
              "background_automation_claim_lost",
            );
        } else {
          await insertRun(runId, thread.id, turnId, {
            dispatchMode: "background",
            afterInsert,
          });
        }
      } catch (error) {
        if (error instanceof BackgroundAutomationRunError) throw error;
        if (options.resume) throw new AutomationRecoveryStorageError(error);
        throw error;
      }
      if (runIdRef) {
        runIdRef.current = runId;
        runIdRef.threadId = thread.id;
      }
      try {
        await options.assertCanStart?.();
      } catch (error) {
        if (error instanceof AutomationSchedulerLeaseLostError) {
          try {
            await releaseBackgroundRunBeforeStart(
              runId,
              error.errorCode,
              error.message,
            );
          } catch (cleanupError) {
            console.error(
              "[automations] Could not release the unstarted worker; heartbeat recovery will retry:",
              cleanupError,
            );
          }
        }
        throw error;
      }
      const hardTimeoutMs = Math.min(
        maxHardTimeoutMs,
        options.hardDeadlineAt === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(1, options.hardDeadlineAt - Date.now()),
      );

      await new Promise<void>((resolve, reject) => {
        const activeRun = startRun(
          runId,
          thread.id,
          async (send, signal, control) => {
            const loopOpts = {
              engine,
              model,
              systemPrompt:
                systemPrompt + buildRuntimeContextPrompt(runtimeContext),
              tools,
              availableTools,
              messages: engineMessages,
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
              turnId,
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
                    automationId: automation.resource.id,
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
            let persistFailure = backgroundAutomationPersistFailure({
              run,
              hardTimedOut,
              hardTimeoutMs,
            });
            try {
              responseText = collectFinalResponseTextFromAgentEvents(
                (run.events ?? []).map((entry) => entry.event),
                { fallbackToPreToolText: false },
              );
              if (!persistFailure && run.status === "completed") {
                try {
                  outcome = await confirmAutomationWork(
                    automation,
                    ownerEmail,
                    run,
                    responseText,
                    actions,
                    noOpReason,
                    priorEvents,
                  );
                } catch (error) {
                  const failure = classifyAutomationFailure(error);
                  persistFailure = {
                    message: failure.message,
                    errorCode: failure.code,
                  };
                }
              }
              await persistBackgroundAutomationTurn({
                threadId: thread.id,
                threadTitle,
                prompt: executionPrompt,
                run,
                persistFailure,
              });
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
              throw err;
            }
            if (hardTimedOut) return;
            if (persistFailure) {
              run.continuationTerminalEvent = {
                type: "error",
                error: persistFailure.message,
                errorCode: persistFailure.errorCode,
              };
              reject(
                new BackgroundAutomationRunError(
                  persistFailure.message,
                  persistFailure.errorCode,
                ),
              );
              return;
            }
            if (run.status !== "completed") {
              const cause = backgroundRunTerminalError(run);
              reject(
                new BackgroundAutomationRunError(
                  cause?.message ??
                    `Background automation ended with status: ${run.status} and recorded no error detail`,
                  cause?.errorCode ?? `background_automation_${run.status}`,
                ),
              );
              return;
            }
            resolve();
          },
          {
            softTimeoutMs,
            backgroundFunction: true,
            recoverChunkBoundaries: true,
            dispatchMode: "background",
            turnId,
            runRowAlreadyInserted: true,
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

      if (!outcome) {
        throw new BackgroundAutomationRunError(
          messages.noWork,
          "automation_no_confirmed_work",
        );
      }
      return { ...outcome, responseText, runId };
    },
  );
}
