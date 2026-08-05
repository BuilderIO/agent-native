/**
 * Wraps `runAgentLoop` with two layered recovery mechanisms so a single hosted
 * invocation can survive interruptions without showing the user a dead chat:
 *
 * 1. **Soft timeout** — an inner timer that aborts the LLM call before the
 *    hosting function's hard limit (Lambda 75s, Vercel 60s, etc.) so we have a
 *    chance to gracefully wind down and append a continuation nudge. Without
 *    this the function gets killed mid-stream and the user sees a frozen
 *    spinner.
 *
 * 2. **Resumable-error continuation** — when the LLM call errors with a
 *    transport- or gateway-level interruption (Builder gateway 45s timeout,
 *    socket hang up, ECONNRESET, upstream 5xx that survived engine retries),
 *    we save the conversation prefix, append a "continue from where you left
 *    off" message, and run another LLM call. Anthropic's prompt cache makes
 *    the resume call dramatically faster than the cold first attempt, and the
 *    agent gets explicit context that it was cut off so it doesn't re-do
 *    completed work.
 *
 * Both paths route through `appendAgentLoopContinuation` so the agent sees a
 * uniform "continue" instruction regardless of which recovery fired.
 */

import type { EngineMessage } from "./engine/types.js";
import {
  runAgentLoop,
  appendAgentLoopContinuation,
  isResumableEngineError,
  isTransientProviderRateLimitError,
  continuationReasonForResumableError,
  lastUnfinishedPreparingActionToolFromEvents,
  resolveFinalResponseGuardRequestText,
  SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS,
  type AgentLoopContinuationReason,
  type AgentLoopOutcome,
} from "./production-agent.js";
import { resolveRunSoftTimeoutMs } from "./run-manager.js";
import type { ResolveRunSoftTimeoutOptions } from "./run-manager.js";
import { getCurrentTurnEventsForThread } from "./run-store.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
} from "./tool-call-journal.js";
import type { AgentChatEvent } from "./types.js";

async function readCurrentTurnEventsForResume(
  threadId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
): Promise<AgentChatEvent[]> {
  let persistedEvents: AgentChatEvent[] = [];
  try {
    persistedEvents = threadId
      ? await getCurrentTurnEventsForThread(threadId)
      : [];
  } catch {
    persistedEvents = [];
  }
  if (localEvents.length === 0) return persistedEvents;
  const seen = new Set(persistedEvents.map((event) => JSON.stringify(event)));
  return [
    ...persistedEvents,
    ...localEvents.filter((event) => !seen.has(JSON.stringify(event))),
  ];
}

function actionPreparationContinuationOptions(
  events: readonly AgentChatEvent[],
): { actionPreparationTool?: string } {
  const actionPreparationTool =
    lastUnfinishedPreparingActionToolFromEvents(events);
  return actionPreparationTool ? { actionPreparationTool } : {};
}

/**
 * Derive the per-turn tool-call journal from the durable run-event ledger and,
 * when there is anything to report, append a STRUCTURED note to the message
 * prefix so the resumed model:
 *   - does NOT re-execute tool calls that already completed (avoiding duplicate
 *     side effects like re-sending an email or re-creating a ticket), and
 *   - is explicitly told about any tool call that started but whose outcome was
 *     never recorded ("interrupted, unknown outcome") so it can decide.
 *
 * This is additive to the existing "continue from where you left off" nudge —
 * it is appended right after it. When the journal is empty (no completed or
 * interrupted tool calls — e.g. a turn with no tool activity, or a clean
 * continuation), nothing extra is appended and resume behavior is byte-for-byte
 * what it was before. Best-effort: any ledger read/parse failure is swallowed so
 * a journal hiccup can never block a recovery that would otherwise succeed.
 *
 * This prompt-level journal is paired with tool-layer enforcement in
 * production-agent.ts/runToolCall, which refuses to re-execute a journaled-
 * complete write tool (returning the journaled result instead). See
 * `tool-call-journal.ts` (`findCompletedJournalEntry`) for the keying used.
 */
function appendToolCallJournalNote(
  messages: EngineMessage[],
  events: readonly AgentChatEvent[],
): void {
  try {
    if (events.length === 0) return;
    const journal = classifyToolCallJournal(events);
    const note = buildResumeJournalNote(journal);
    if (!note) return;
    messages.push({
      role: "user",
      content: [{ type: "text", text: note }],
    });
  } catch {
    // The journal is a hardening layer, never a gate. A failed ledger read or
    // parse must not break the resume that the continuation nudge already set
    // up — the model still continues, just without the structured journal.
  }
}

async function appendContinuationAndJournal(
  messages: EngineMessage[],
  reason: AgentLoopContinuationReason | "rate_limited",
  threadId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
): Promise<void> {
  const events = await readCurrentTurnEventsForResume(threadId, localEvents);
  appendAgentLoopContinuation(
    messages,
    reason,
    actionPreparationContinuationOptions(events),
  );
  appendToolCallJournalNote(messages, events);
}

/**
 * Rebuild the same safe continuation context for a logical turn that resumes
 * in a fresh hosted invocation.
 */
export async function appendDurableContinuationContext(
  messages: EngineMessage[],
  reason: AgentLoopContinuationReason,
  threadId: string,
): Promise<void> {
  await appendContinuationAndJournal(messages, reason, threadId);
}

async function hasCompletedSideEffectToolCallInCurrentTurn(
  threadId: string | undefined,
  localEvents: readonly AgentChatEvent[] = [],
): Promise<boolean> {
  try {
    const events = await readCurrentTurnEventsForResume(threadId, localEvents);
    if (events.length === 0) return false;
    return events.some(
      (event) =>
        event.type === "tool_done" &&
        event.completedSideEffect === true &&
        event.isError !== true,
    );
  } catch {
    return false;
  }
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
    last.reason === "network_interrupted"
  ) {
    return last.reason;
  }
  return undefined;
}

/**
 * Cap on continuation iterations inside a single
 * `runAgentLoopDirectWithSoftTimeout` invocation. The host's hard function
 * timeout usually bounds this naturally — but a defensive cap prevents an
 * instant-error spiral from looping forever inside hosting environments with a
 * generous budget.
 *
 * 6 leaves room for: 1 normal completion + a few resume rounds for design
 * generation (prompt + 3 variants ≈ 4 LLM calls), with a small safety margin.
 */
export const MAX_RUN_LOOP_CONTINUATIONS = 6;

/**
 * A delegated turn that is proven to be running inside a durable background
 * function has the same 15-minute host budget as main chat, but this wrapper
 * historically kept the foreground-sized six-continuation cap. A healthy
 * child A2A call can consume several minutes and the receiving model may then
 * need more than six recovery/model-stream boundaries to finish its own tool
 * work. Keep a hard cap, but give the proven background path the same bounded
 * continuation allowance as the durable main-chat runner. The cumulative
 * soft-timeout below still prevents these rounds from exceeding the one real
 * background-function wall-clock budget.
 */
export const MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS = 20;

/**
 * The engine already performs its own short provider retries. After those are
 * exhausted, a proven durable background A2A/MCP run gets one cooled-down
 * continuation for a transient 429/529. One extra round is enough to bridge a
 * short provider bucket without multiplying a sustained rate limit into a
 * request storm across the larger background continuation allowance.
 */
export const MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS = 1;
export const BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS = 20_000;

function waitForBackgroundRateLimitCooldown(
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(
      finish,
      BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS,
    );
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Machine-readable code carried on the give-up terminal `error` event so the
 * client renders a loud "stopped before finishing" terminal instead of an
 * ambiguous silent stall. Deliberately NOT in the client's auto-recoverable
 * allow-list (`isAutoRecoverableError`) so it terminates the chain rather than
 * looping another POST that would hit the same wall. */
export const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";

/** User-facing terminal message when a hosted run is cut off mid-step and
 * exhausts its in-invocation continuation budget without finishing. Generic and
 * framework-level (not app-specific). Mirrors the `reliable-mutations` skill's
 * "fail loud, retry as a single bulk action" guidance so the user understands
 * the turn stopped before finishing without implying that earlier completed
 * tool calls did not persist. */
export const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";

/**
 * Internal entry point used by the agent-chat plugin's run handler. Wraps
 * `runAgentLoop` with soft-timeout + resumable-error continuation recovery.
 *
 * The `softTimeoutMs` argument falls back to `resolveRunSoftTimeoutMs(...)` so
 * different hosting environments (Lambda, Vercel, Cloudflare, local dev) get
 * an appropriate inner budget. Setting it to <= 0 disables both layers — the
 * call goes straight to `runAgentLoop` with no wrapping.
 */
export async function runAgentLoopDirectWithSoftTimeout(
  opts: Parameters<typeof runAgentLoop>[0],
  softTimeoutMs?: number,
  timeoutOptions?: ResolveRunSoftTimeoutOptions,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const finalResponseGuardRequestText =
    opts.finalResponseGuardRequestText ??
    resolveFinalResponseGuardRequestText(opts.messages);
  const stableOpts = { ...opts, finalResponseGuardRequestText };
  const timeoutMs = resolveRunSoftTimeoutMs(softTimeoutMs, timeoutOptions);
  let finalOutcomeReported = false;
  const reportFinalOutcome = (outcome: AgentLoopOutcome) => {
    if (finalOutcomeReported) return;
    finalOutcomeReported = true;
    try {
      opts.onOutcome?.(outcome);
    } catch {
      // Outcome observers cannot alter recovery or completion.
    }
  };

  // Disabling continuation recovery must not disable terminal classification.
  // Keep the same outcome boundary around a direct loop so A2A/MCP callers
  // never infer success from a rejected or canceled run.
  if (timeoutMs <= 0) {
    const directEvents: AgentChatEvent[] = [];
    let directOutcome: AgentLoopOutcome | undefined;
    try {
      const result = await runAgentLoop({
        ...stableOpts,
        send: (event) => {
          directEvents.push(event);
          stableOpts.send(event);
        },
        onOutcome: (outcome) => {
          directOutcome = outcome;
        },
      });
      const unfinishedReason =
        internalContinuationReasonForAttempt(directEvents);
      if (opts.signal.aborted) {
        reportFinalOutcome({
          state: "canceled",
          message: "Agent run was aborted.",
        });
      } else if (unfinishedReason) {
        reportFinalOutcome({
          state: "failed",
          code: unfinishedReason,
          retryable: false,
          message: `Agent stopped before finishing (${unfinishedReason}).`,
        });
      } else {
        reportFinalOutcome(directOutcome ?? { state: "completed" });
      }
      return result;
    } catch (err) {
      const candidate = err as { errorCode?: unknown; message?: unknown };
      reportFinalOutcome(
        opts.signal.aborted
          ? { state: "canceled", message: "Agent run was aborted." }
          : {
              state: "failed",
              code:
                typeof candidate?.errorCode === "string" && candidate.errorCode
                  ? candidate.errorCode
                  : "internal_error",
              retryable: isResumableEngineError(err),
              message:
                typeof candidate?.message === "string"
                  ? candidate.message
                  : String(err),
            },
      );
      throw err;
    }
  }

  const upstreamSignal = opts.signal;
  const usage: Awaited<ReturnType<typeof runAgentLoop>> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: opts.model,
  };

  const addUsage = (next: Awaited<ReturnType<typeof runAgentLoop>>) => {
    usage.inputTokens += next.inputTokens;
    usage.outputTokens += next.outputTokens;
    usage.cacheReadTokens += next.cacheReadTokens;
    usage.cacheWriteTokens += next.cacheWriteTokens;
    usage.model = next.model;
    // Without these, a retry that never got a usage report merges its zeros
    // over an earlier attempt's real numbers, and telemetry reports an
    // unmeasured run as a measured empty one.
    if (next.usageReported) usage.usageReported = true;
    usage.firstEngineEventAtMs ??= next.firstEngineEventAtMs;
  };

  const localTurnEvents: AgentChatEvent[] = [];
  let attempts = 0;
  // Every current hosted caller of this function (A2A/MCP delegated turns)
  // runs inside ONE serverless invocation whose real platform hard-kill is
  // what `timeoutMs` was sized to survive ONCE — reusing that same fresh
  // window for every one of up to `MAX_RUN_LOOP_CONTINUATIONS` in-process
  // rounds ignores the wall-clock the earlier rounds already spent, so a 2nd+
  // round can gamble past the host's real limit and die with a silent
  // mid-stream kill instead of a clean give-up. Budget subsequent rounds
  // against cumulative elapsed time since this call started (mirrors
  // `resolveSelfChainContinuationBudget`'s "remaining = ceiling - elapsed"
  // pattern, already proven for the analogous foreground self-chain case).
  // The first round is unaffected — it always gets the full `timeoutMs`.
  const loopEntryAt = Date.now();
  const maxRunLoopContinuations =
    timeoutOptions?.backgroundFunction === true
      ? MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS
      : MAX_RUN_LOOP_CONTINUATIONS;
  let backgroundRateLimitContinuations = 0;
  // Tracks whether the most recent attempt ended by scheduling another
  // continuation (soft-timeout or resumable error → `continue`) rather than
  // returning a finished turn. When the loop then exits because the budget is
  // exhausted (NOT because the user aborted and NOT because the turn finished),
  // this is the silent give-up case: emit a loud terminal so the user sees an
  // unambiguous "stopped before finishing" instead of a bare done/"…".
  let lastAttemptWasUnfinishedContinuation = false;
  while (!upstreamSignal.aborted && attempts < maxRunLoopContinuations) {
    const roundTimeoutMs =
      attempts === 0 ? timeoutMs : timeoutMs - (Date.now() - loopEntryAt);
    if (
      attempts > 0 &&
      roundTimeoutMs < SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS
    ) {
      // Not enough wall-clock left in this invocation to safely start
      // another round — stop here (lastAttemptWasUnfinishedContinuation is
      // already true from the prior round) so the loop exits through the
      // existing RUN_BUDGET_EXHAUSTED_MESSAGE path below instead of risking
      // a raw platform kill mid-stream.
      break;
    }
    attempts++;
    lastAttemptWasUnfinishedContinuation = false;
    const controller = new AbortController();
    const abortFromUpstream = () => controller.abort();
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, {
        once: true,
      });
    }

    let softTimedOut = false;
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      softTimedOut = true;
      controller.abort();
    }, roundTimeoutMs);

    const attemptStartIndex = localTurnEvents.length;
    const send = (event: AgentChatEvent) => {
      localTurnEvents.push(event);
      opts.send(event);
    };

    try {
      let attemptOutcome: AgentLoopOutcome | undefined;
      const nextUsage = await runAgentLoop({
        ...stableOpts,
        send,
        signal: controller.signal,
        onOutcome: (outcome) => {
          attemptOutcome = outcome;
        },
      });
      addUsage(nextUsage);
      const attemptEvents = localTurnEvents.slice(attemptStartIndex);
      const internalContinuationReason =
        internalContinuationReasonForAttempt(attemptEvents);
      if (internalContinuationReason && !upstreamSignal.aborted) {
        lastAttemptWasUnfinishedContinuation = true;
        const continuationEvents = [...localTurnEvents];
        if (
          !(await hasCompletedSideEffectToolCallInCurrentTurn(
            opts.threadId,
            continuationEvents,
          ))
        ) {
          opts.send({ type: "clear" });
        }
        await appendContinuationAndJournal(
          opts.messages,
          internalContinuationReason,
          opts.threadId,
          continuationEvents,
        );
        continue;
      }
      if (softTimedOut && !upstreamSignal.aborted) {
        lastAttemptWasUnfinishedContinuation = true;
        await appendContinuationAndJournal(
          opts.messages,
          "run_timeout",
          opts.threadId,
          localTurnEvents,
        );
        continue;
      }
      reportFinalOutcome(
        upstreamSignal.aborted
          ? { state: "canceled", message: "Agent run was aborted." }
          : (attemptOutcome ?? { state: "completed" }),
      );
      return usage;
    } catch (err) {
      if (softTimedOut && !upstreamSignal.aborted) {
        // Clear partial text the client received before the abort so the
        // resumed model doesn't re-emit it and produce duplicated output.
        lastAttemptWasUnfinishedContinuation = true;
        if (
          !(await hasCompletedSideEffectToolCallInCurrentTurn(
            opts.threadId,
            localTurnEvents,
          ))
        ) {
          opts.send({ type: "clear" });
        }
        await appendContinuationAndJournal(
          opts.messages,
          "run_timeout",
          opts.threadId,
          localTurnEvents,
        );
        continue;
      }
      const transientRateLimit = isTransientProviderRateLimitError(err);
      const rateLimitRetryFitsBudget =
        timeoutOptions?.backgroundFunction === true &&
        backgroundRateLimitContinuations <
          MAX_BACKGROUND_RATE_LIMIT_CONTINUATIONS &&
        timeoutMs -
          (Date.now() - loopEntryAt) -
          BACKGROUND_RATE_LIMIT_CONTINUATION_DELAY_MS >=
          SELF_CHAIN_MIN_CONTINUATION_BUDGET_MS;
      if (
        !upstreamSignal.aborted &&
        transientRateLimit &&
        rateLimitRetryFitsBudget
      ) {
        lastAttemptWasUnfinishedContinuation = true;
        backgroundRateLimitContinuations++;
        if (
          !(await hasCompletedSideEffectToolCallInCurrentTurn(
            opts.threadId,
            localTurnEvents,
          ))
        ) {
          opts.send({ type: "clear" });
        }
        await appendContinuationAndJournal(
          opts.messages,
          "rate_limited",
          opts.threadId,
          localTurnEvents,
        );
        await waitForBackgroundRateLimitCooldown(upstreamSignal);
        continue;
      }
      // Resumable transport / gateway interruptions: the LLM call was cut off
      // mid-stream (gateway 45s timeout, socket hang up, function-level
      // timeout that didn't trip our soft timer first). Treat it the same way
      // as a soft timeout — append a "continue from where you left off" nudge
      // and let the loop run another LLM call. The conversation prefix up to
      // the cut-off is preserved in opts.messages, and Anthropic's prompt
      // cache makes the resume call much faster.
      //
      // Emit 'clear' so any partial streamed text is discarded on the client
      // before the model resumes. Without this the model restarts its sentence
      // from scratch and the fold produces duplicated text in one message
      // (the partial text was already sent to the client but never entered
      // the in-memory messages array, so the next attempt re-emits it).
      if (!upstreamSignal.aborted && isResumableEngineError(err)) {
        lastAttemptWasUnfinishedContinuation = true;
        if (
          !(await hasCompletedSideEffectToolCallInCurrentTurn(
            opts.threadId,
            localTurnEvents,
          ))
        ) {
          opts.send({ type: "clear" });
        }
        await appendContinuationAndJournal(
          opts.messages,
          continuationReasonForResumableError(err),
          opts.threadId,
          localTurnEvents,
        );
        continue;
      }
      if (upstreamSignal.aborted) {
        reportFinalOutcome({
          state: "canceled",
          message: "Agent run was aborted.",
        });
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
      clearTimeout(timer);
      upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }

  // The loop exited without a clean return. If the user aborted, that's a Stop —
  // stay silent. Otherwise we only get here by exhausting
  // MAX_RUN_LOOP_CONTINUATIONS while the last attempt was still trying to
  // continue (soft-timeout / resumable error). That is the genuinely-silent
  // give-up the run-manager would otherwise report as a clean `done`: emit a
  // loud, non-auto-continuing terminal so the user knows the turn stopped
  // before finishing and nothing was partially saved by the run itself.
  if (!upstreamSignal.aborted && lastAttemptWasUnfinishedContinuation) {
    // Discard any partial text already streamed for the unfinished attempt so
    // the terminal message stands alone instead of trailing a half sentence.
    // Preserve completed tool cards: they are the user's only durable proof
    // that a side effect landed before the final assistant note timed out.
    if (
      !(await hasCompletedSideEffectToolCallInCurrentTurn(
        opts.threadId,
        localTurnEvents,
      ))
    ) {
      opts.send({ type: "clear" });
    }
    opts.send({
      type: "error",
      error: RUN_BUDGET_EXHAUSTED_MESSAGE,
      errorCode: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      recoverable: false,
    });
    reportFinalOutcome({
      state: "failed",
      code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      retryable: false,
      message: RUN_BUDGET_EXHAUSTED_MESSAGE,
    });
  } else if (upstreamSignal.aborted) {
    reportFinalOutcome({
      state: "canceled",
      message: "Agent run was aborted.",
    });
  }

  return usage;
}
