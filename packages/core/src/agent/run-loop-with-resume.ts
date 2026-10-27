import {
  MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS,
  MAX_RUN_LOOP_CONTINUATIONS,
} from "../app-config/run-lifecycle-invariants.js";
import {
  SERVER_OWNED_ABORT_REASONS,
  clientAbortReason,
} from "./abort-reasons.js";
import { PROVIDER_RATE_LIMITED_ERROR_CODE } from "./engine/error-detail.js";
import { EngineError, type EngineMessage } from "./engine/types.js";
import {
  IncompleteAgentRunError,
  incompleteAgentRunFailure,
} from "./run-errors.js";
export {
  RUN_BUDGET_EXHAUSTED_ERROR_CODE,
  RUN_BUDGET_EXHAUSTED_MESSAGE,
} from "./run-errors.js";
import {
  runAgentLoop,
  mergeAgentLoopUsage,
  appendAgentLoopContinuation,
  appendContinuationCheckpoint,
  turnHasVisibleText,
  clearUnseenDraft,
  hasCompletedSideEffect,
  isCustomerKeyRateLimit,
  isResumableStreamFailure,
  isSignalAborted,
  isTransientProviderRateLimitError,
  continuationReasonForResumableError,
  lastUnfinishedPreparingActionToolFromEvents,
  resolveFinalResponseGuardRequestText,
  AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT,
  SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS,
  PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE,
  type AgentLoopContinuationReason,
  type AgentLoopOutcome,
} from "./production-agent.js";
import { resolveRunSoftTimeoutMs } from "./run-manager.js";
import type {
  ResolveRunSoftTimeoutOptions,
  RunChunkControl,
} from "./run-manager.js";
import {
  AgentRunJournalUnreadableError,
  getCurrentTurnEventsForThread,
} from "./run-store.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
} from "./tool-call-journal.js";
import type { AgentChatEvent } from "./types.js";

async function readCurrentTurnEventsForResume(
  threadId: string | undefined,
  turnId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
): Promise<{ events: AgentChatEvent[]; persisted: boolean }> {
  let persistedEvents: AgentChatEvent[] = [];
  let persisted = true;
  try {
    persistedEvents = threadId
      ? await getCurrentTurnEventsForThread(threadId, turnId)
      : [];
  } catch (err) {
    if (err instanceof AgentRunJournalUnreadableError) throw err;
    persisted = false;
    console.warn(
      "[run-loop] current-turn ledger read failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (localEvents.length === 0) return { events: persistedEvents, persisted };
  const seen = new Set(persistedEvents.map((event) => JSON.stringify(event)));
  return {
    events: [
      ...persistedEvents,
      ...localEvents.filter((event) => !seen.has(JSON.stringify(event))),
    ],
    persisted,
  };
}

function actionPreparationContinuationOptions(
  events: readonly AgentChatEvent[],
): { actionPreparationTool?: string } {
  const actionPreparationTool =
    lastUnfinishedPreparingActionToolFromEvents(events);
  return actionPreparationTool ? { actionPreparationTool } : {};
}

type ToolCallJournalNoteResult =
  | { status: "available"; note: string | null }
  | { status: "unavailable"; error: unknown };

function toolCallJournalNote(
  events: readonly AgentChatEvent[],
): ToolCallJournalNoteResult {
  try {
    if (events.length === 0) return { status: "available", note: null };
    const journal = classifyToolCallJournal(events);
    return { status: "available", note: buildResumeJournalNote(journal) };
  } catch (error) {
    // The journal is a hardening layer, never a gate. A failed ledger read or
    // parse must not break the resume that the continuation nudge already set
    // up — the model still continues, just without the structured journal.
    return { status: "unavailable", error };
  }
}

export { AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT };

async function appendContinuationAndJournal(
  messages: EngineMessage[],
  reason: AgentLoopContinuationReason,
  threadId: string | undefined,
  turnId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
  checkpointEvents: readonly AgentChatEvent[] = localEvents,
): Promise<void> {
  const { events } = await readCurrentTurnEventsForResume(
    threadId,
    turnId,
    localEvents,
  );
  const journalNote = toolCallJournalNote(events);
  if (journalNote.status === "unavailable") {
    console.warn("[run-loop] could not build the continuation journal note");
  }
  appendContinuationCheckpoint(messages, checkpointEvents);
  appendAgentLoopContinuation(messages, reason, {
    ...actionPreparationContinuationOptions(events),
    ...(journalNote.status === "available" && journalNote.note
      ? { journalNote: journalNote.note }
      : {}),
  });
}

export async function appendDurableContinuationContext(
  messages: EngineMessage[],
  reason: AgentLoopContinuationReason,
  threadId: string,
  turnId?: string,
): Promise<void> {
  await appendContinuationAndJournal(messages, reason, threadId, turnId);
}

async function completedSideEffectInCurrentTurn(
  threadId: string | undefined,
  turnId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
): Promise<"some" | "none" | "unknown"> {
  const { events, persisted } = await readCurrentTurnEventsForResume(
    threadId,
    turnId,
    localEvents,
  );
  if (hasCompletedSideEffect(events)) return "some";
  return persisted ? "none" : "unknown";
}

function internalContinuationReasonForAttempt(
  events: readonly AgentChatEvent[],
): AgentLoopContinuationReason | undefined {
  const last = events.at(-1);
  if (last?.type !== "auto_continue") return undefined;
  if (
    last.reason === "run_timeout" ||
    last.reason === "loop_limit" ||
    last.reason === "no_progress" ||
    last.reason === "stream_ended" ||
    last.reason === "gateway_timeout" ||
    last.reason === "network_interrupted" ||
    last.reason === "rate_limited"
  ) {
    return last.reason;
  }
  return undefined;
}

export const MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS = 3;
export const BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS = 2_000;

function rateLimitCooldownMs(err: unknown, retryCount: number): number {
  const retryAfterMs =
    err instanceof EngineError && typeof err.retryAfterMs === "number"
      ? err.retryAfterMs
      : 0;
  const backoffMs =
    BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS * 2 ** retryCount;
  return Math.max(backoffMs, retryAfterMs);
}

function waitForBackgroundRateLimitCooldown(
  turnSignal: AbortSignal,
  chunkSignal: AbortSignal,
  delayMs: number,
): Promise<"elapsed" | "turn_aborted" | "chunk_aborted"> {
  if (turnSignal.aborted) return Promise.resolve("turn_aborted");
  if (chunkSignal.aborted) return Promise.resolve("chunk_aborted");
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: "elapsed" | "turn_aborted" | "chunk_aborted") => {
      clearTimeout(timer);
      turnSignal.removeEventListener("abort", onTurnAbort);
      chunkSignal.removeEventListener("abort", onChunkAbort);
      resolve(result);
    };
    const onTurnAbort = () => finish("turn_aborted");
    const onChunkAbort = () => finish("chunk_aborted");
    timer = setTimeout(() => finish("elapsed"), delayMs);
    turnSignal.addEventListener("abort", onTurnAbort, { once: true });
    chunkSignal.addEventListener("abort", onChunkAbort, { once: true });
    if (turnSignal.aborted) onTurnAbort();
    else if (chunkSignal.aborted) onChunkAbort();
  });
}

export { SERVER_OWNED_ABORT_REASONS, clientAbortReason };

export class AgentLoopAbortedError extends Error {
  readonly usage: Awaited<ReturnType<typeof runAgentLoop>>;

  constructor(usage: Awaited<ReturnType<typeof runAgentLoop>>) {
    super("Agent run was aborted.");
    this.name = "AbortError";
    this.usage = usage;
  }
}

export async function runAgentLoopDirectWithSoftTimeout(
  opts: Parameters<typeof runAgentLoop>[0],
  softTimeoutMs?: number,
  timeoutOptions?: ResolveRunSoftTimeoutOptions,
  control?: RunChunkControl,
  onUsage?: (usage: Awaited<ReturnType<typeof runAgentLoop>>) => void,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const finalResponseGuardRequestText =
    opts.finalResponseGuardRequestText ??
    resolveFinalResponseGuardRequestText(opts.messages);
  const timeoutMs = resolveRunSoftTimeoutMs(softTimeoutMs, timeoutOptions);
  let dispatchedModelCalls = 0;
  const stableOpts = {
    ...opts,
    finalResponseGuardRequestText,
    onModelDispatchStarted: () => {
      dispatchedModelCalls++;
      try {
        opts.onModelDispatchStarted?.();
      } catch {
        // coercion-ok: telemetry observers cannot change model dispatch.
        // Telemetry observers cannot change whether a model request runs.
      }
    },
    ...(timeoutMs > 0 ? { runSoftTimeoutMs: timeoutMs } : {}),
  };
  let finalOutcomeReported = false;
  const reportFinalOutcome = (outcome: AgentLoopOutcome) => {
    if (finalOutcomeReported) return;
    finalOutcomeReported = true;
    try {
      opts.onOutcome?.(outcome);
    } catch {
      // coercion-ok: outcome observers cannot change run completion.
      // Outcome observers cannot alter recovery or completion.
    }
  };

  const turnSignal = control?.turnSignal ?? opts.signal;
  const turnAbortOutcome = (): AgentLoopOutcome => {
    const reason =
      typeof turnSignal.reason === "string" ? turnSignal.reason.trim() : "";
    if (!SERVER_OWNED_ABORT_REASONS.has(reason)) {
      return { state: "canceled", message: "Agent run was aborted." };
    }
    return {
      state: "failed",
      code: reason,
      retryable: false,
      message: `Agent run was aborted (${reason}).`,
    };
  };
  let chunkSignal = control?.chunkSignal ?? opts.signal;
  const recoverableChunkBoundary = (): AgentLoopContinuationReason | null => {
    if (!control || turnSignal.aborted) return null;
    const reason = control.chunkBoundaryReason();
    return reason === "no_progress" || reason === "run_timeout" ? reason : null;
  };
  const localTurnEvents: AgentChatEvent[] = [];
  // An unreadable ledger keeps the draft: its tool cards may be the only record of work done.
  const clearUnseenDraftIfSafe = async (): Promise<void> =>
    clearUnseenDraft(
      localTurnEvents,
      opts.send,
      (await completedSideEffectInCurrentTurn(
        opts.threadId,
        opts.turnId,
        localTurnEvents,
      )) === "none",
    );
  const continueFromChunkBoundary = async (
    reason: AgentLoopContinuationReason,
    attemptEvents: readonly AgentChatEvent[],
  ): Promise<void> => {
    await clearUnseenDraftIfSafe();
    await appendContinuationAndJournal(
      opts.messages,
      reason,
      opts.threadId,
      opts.turnId,
      localTurnEvents,
      [...attemptEvents],
    );
    chunkSignal = control?.beginChunk() ?? chunkSignal;
  };
  if (timeoutMs <= 0 && !control) {
    const directEvents: AgentChatEvent[] = [];
    let directOutcome: AgentLoopOutcome | undefined;
    try {
      const result = await runAgentLoop({
        ...stableOpts,
        send: (event) => {
          directEvents.push(event);
          stableOpts.send(event);
        },
        hasVisibleTurnText: () => turnHasVisibleText(directEvents),
        onOutcome: (outcome) => {
          directOutcome = outcome;
        },
      });
      const unfinishedReason =
        internalContinuationReasonForAttempt(directEvents);
      if (turnSignal.aborted) {
        reportFinalOutcome(turnAbortOutcome());
      } else if (unfinishedReason) {
        const failure = incompleteAgentRunFailure({
          dispatchedModelCalls,
          hasVisibleText: turnHasVisibleText(directEvents),
          hasSuccessfulToolOutput: directEvents.some(
            (event) => event.type === "tool_done" && event.isError !== true,
          ),
        });
        reportFinalOutcome({
          state: "failed",
          code: failure.code,
          retryable: false,
          message: failure.message,
        });
        onUsage?.({ ...result });
        throw new IncompleteAgentRunError(failure, result);
      } else {
        reportFinalOutcome(directOutcome ?? { state: "completed" });
      }
      return result;
    } catch (err) {
      const candidate = err as { errorCode?: unknown; message?: unknown };
      reportFinalOutcome(
        turnSignal.aborted
          ? turnAbortOutcome()
          : {
              state: "failed",
              code:
                typeof candidate?.errorCode === "string" && candidate.errorCode
                  ? candidate.errorCode
                  : "internal_error",
              retryable: isResumableStreamFailure(err, directEvents),
              message:
                typeof candidate?.message === "string"
                  ? candidate.message
                  : String(err),
            },
      );
      throw err;
    }
  }

  const usage: Awaited<ReturnType<typeof runAgentLoop>> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    engineName: opts.engine.name,
    model: opts.model,
  };

  const addUsage = (next: Awaited<ReturnType<typeof runAgentLoop>>) => {
    mergeAgentLoopUsage(usage, next);
    onUsage?.({ ...usage });
  };

  let attempts = 0;
  const loopEntryAt = Date.now();
  const maxRunLoopContinuations =
    timeoutOptions?.backgroundFunction === true
      ? MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS
      : MAX_RUN_LOOP_CONTINUATIONS;
  let backgroundRateLimitContinuations = 0;
  let lastAttemptWasUnfinishedContinuation = false;
  while (!turnSignal.aborted && attempts < maxRunLoopContinuations) {
    const roundTimeoutMs =
      timeoutMs <= 0
        ? 0
        : attempts === 0
          ? timeoutMs
          : timeoutMs - (Date.now() - loopEntryAt);
    if (
      timeoutMs > 0 &&
      attempts > 0 &&
      roundTimeoutMs < SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS
    ) {
      break;
    }
    attempts++;
    lastAttemptWasUnfinishedContinuation = false;
    const controller = new AbortController();
    const abortFromUpstream = () => controller.abort();
    const roundChunkSignal = chunkSignal;
    if (roundChunkSignal.aborted) {
      controller.abort();
    } else {
      roundChunkSignal.addEventListener("abort", abortFromUpstream, {
        once: true,
      });
    }

    let softTimedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (controller.signal.aborted) return;
            softTimedOut = true;
            controller.abort();
          }, roundTimeoutMs)
        : undefined;

    const attemptStartIndex = localTurnEvents.length;
    const send = (event: AgentChatEvent) => {
      localTurnEvents.push(event);
      opts.send(event);
    };

    try {
      let attemptOutcome: AgentLoopOutcome | undefined;
      const nextUsage = await runAgentLoop({
        ...stableOpts,
        ...(timeoutMs > 0 ? { runSoftTimeoutMs: roundTimeoutMs } : {}),
        send,
        signal: controller.signal,
        hasVisibleTurnText: () => turnHasVisibleText(localTurnEvents),
        onOutcome: (outcome) => {
          attemptOutcome = outcome;
        },
      });
      addUsage(nextUsage);
      const attemptEvents = localTurnEvents.slice(attemptStartIndex);
      const chunkBoundaryReason = recoverableChunkBoundary();
      if (chunkBoundaryReason) {
        lastAttemptWasUnfinishedContinuation = true;
        await continueFromChunkBoundary(chunkBoundaryReason, attemptEvents);
        continue;
      }
      if (timeoutMs <= 0) {
        const unfinishedReason =
          internalContinuationReasonForAttempt(attemptEvents);
        if (turnSignal.aborted) {
          reportFinalOutcome(turnAbortOutcome());
        } else if (unfinishedReason) {
          reportFinalOutcome({
            state: "failed",
            code: unfinishedReason,
            retryable: false,
            message: `Agent stopped before finishing (${unfinishedReason}).`,
          });
        } else {
          reportFinalOutcome(attemptOutcome ?? { state: "completed" });
        }
        return usage;
      }
      const internalContinuationReason =
        internalContinuationReasonForAttempt(attemptEvents);
      if (internalContinuationReason && !turnSignal.aborted) {
        lastAttemptWasUnfinishedContinuation = true;
        await clearUnseenDraftIfSafe();
        await appendContinuationAndJournal(
          opts.messages,
          internalContinuationReason,
          opts.threadId,
          opts.turnId,
          [...localTurnEvents],
          attemptEvents,
        );
        continue;
      }
      if (softTimedOut && !turnSignal.aborted) {
        lastAttemptWasUnfinishedContinuation = true;
        await clearUnseenDraftIfSafe();
        await appendContinuationAndJournal(
          opts.messages,
          "run_timeout",
          opts.threadId,
          opts.turnId,
          localTurnEvents,
          attemptEvents,
        );
        continue;
      }
      reportFinalOutcome(
        turnSignal.aborted
          ? turnAbortOutcome()
          : (attemptOutcome ?? { state: "completed" }),
      );
      return usage;
    } catch (err) {
      const chunkBoundaryReason = recoverableChunkBoundary();
      if (chunkBoundaryReason) {
        lastAttemptWasUnfinishedContinuation = true;
        await continueFromChunkBoundary(
          chunkBoundaryReason,
          localTurnEvents.slice(attemptStartIndex),
        );
        continue;
      }
      if (timeoutMs <= 0) {
        const candidate = err as { errorCode?: unknown; message?: unknown };
        reportFinalOutcome(
          turnSignal.aborted
            ? turnAbortOutcome()
            : {
                state: "failed",
                code:
                  typeof candidate?.errorCode === "string" &&
                  candidate.errorCode
                    ? candidate.errorCode
                    : "internal_error",
                retryable: isResumableStreamFailure(
                  err,
                  localTurnEvents.slice(attemptStartIndex),
                ),
                message:
                  typeof candidate?.message === "string"
                    ? candidate.message
                    : String(err),
              },
        );
        throw err;
      }
      if (softTimedOut && !turnSignal.aborted) {
        lastAttemptWasUnfinishedContinuation = true;
        await clearUnseenDraftIfSafe();
        await appendContinuationAndJournal(
          opts.messages,
          "run_timeout",
          opts.threadId,
          opts.turnId,
          localTurnEvents,
          localTurnEvents.slice(attemptStartIndex),
        );
        continue;
      }
      const transientRateLimit = isTransientProviderRateLimitError(err);
      const rateLimitCooldown = rateLimitCooldownMs(
        err,
        backgroundRateLimitContinuations,
      );
      const rateLimitRetryFitsBudget =
        // The in-turn loop already spent the one Retry-After wait a customer
        // key gets; rerunning the turn would reset that budget.
        !isCustomerKeyRateLimit(err, opts.engine) &&
        attempts < maxRunLoopContinuations &&
        backgroundRateLimitContinuations <
          MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS &&
        timeoutMs - (Date.now() - loopEntryAt) - rateLimitCooldown >=
          SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS;
      if (
        !turnSignal.aborted &&
        transientRateLimit &&
        rateLimitRetryFitsBudget
      ) {
        lastAttemptWasUnfinishedContinuation = true;
        backgroundRateLimitContinuations++;
        await clearUnseenDraftIfSafe();
        await appendContinuationAndJournal(
          opts.messages,
          "rate_limited",
          opts.threadId,
          opts.turnId,
          localTurnEvents,
          localTurnEvents.slice(attemptStartIndex),
        );
        const cooldownResult = await waitForBackgroundRateLimitCooldown(
          turnSignal,
          roundChunkSignal,
          rateLimitCooldown,
        );
        if (cooldownResult === "turn_aborted" || turnSignal.aborted) {
          reportFinalOutcome(turnAbortOutcome());
          throw new AgentLoopAbortedError(usage);
        }
        if (cooldownResult === "chunk_aborted") {
          const chunkBoundaryReason = recoverableChunkBoundary();
          if (chunkBoundaryReason) {
            appendAgentLoopContinuation(
              opts.messages,
              chunkBoundaryReason,
              actionPreparationContinuationOptions(localTurnEvents),
            );
            chunkSignal = control?.beginChunk() ?? chunkSignal;
            continue;
          }
        }
        continue;
      }
      if (!turnSignal.aborted && transientRateLimit) {
        await clearUnseenDraftIfSafe();
        reportFinalOutcome({
          state: "failed",
          code: PROVIDER_RATE_LIMITED_ERROR_CODE,
          retryable: true,
          message: PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE,
        });
        throw new EngineError(PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE, {
          errorCode: PROVIDER_RATE_LIMITED_ERROR_CODE,
        });
      }
      if (
        !isSignalAborted(turnSignal) &&
        isResumableStreamFailure(err, localTurnEvents.slice(attemptStartIndex))
      ) {
        lastAttemptWasUnfinishedContinuation = true;
        await clearUnseenDraftIfSafe();
        await appendContinuationAndJournal(
          opts.messages,
          continuationReasonForResumableError(err),
          opts.threadId,
          opts.turnId,
          localTurnEvents,
          localTurnEvents.slice(attemptStartIndex),
        );
        continue;
      }
      if (turnSignal.aborted) {
        reportFinalOutcome(turnAbortOutcome());
        throw err;
      }
      const candidate = err as { errorCode?: unknown; message?: unknown };
      reportFinalOutcome({
        state: "failed",
        code:
          typeof candidate?.errorCode === "string" && candidate.errorCode
            ? candidate.errorCode
            : "internal_error",
        retryable: false,
        message:
          typeof candidate?.message === "string"
            ? candidate.message
            : String(err),
      });
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      roundChunkSignal.removeEventListener("abort", abortFromUpstream);
    }
  }

  if (!turnSignal.aborted && lastAttemptWasUnfinishedContinuation) {
    await clearUnseenDraftIfSafe();
    const failure = incompleteAgentRunFailure({
      dispatchedModelCalls,
      hasVisibleText: turnHasVisibleText(localTurnEvents),
      hasSuccessfulToolOutput: localTurnEvents.some(
        (event) => event.type === "tool_done" && event.isError !== true,
      ),
    });
    reportFinalOutcome({
      state: "failed",
      code: failure.code,
      retryable: false,
      message: failure.message,
    });
    throw new IncompleteAgentRunError(failure, usage);
  } else if (turnSignal.aborted) {
    reportFinalOutcome(turnAbortOutcome());
  }

  return usage;
}
