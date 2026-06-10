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

import {
  runAgentLoop,
  appendAgentLoopContinuation,
  isResumableEngineError,
  continuationReasonForResumableError,
} from "./production-agent.js";
import { resolveRunSoftTimeoutMs } from "./run-manager.js";

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
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const timeoutMs = resolveRunSoftTimeoutMs(softTimeoutMs);
  if (timeoutMs <= 0) return runAgentLoop(opts);

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
  };

  let attempts = 0;
  while (!upstreamSignal.aborted && attempts < MAX_RUN_LOOP_CONTINUATIONS) {
    attempts++;
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
    }, timeoutMs);

    try {
      const nextUsage = await runAgentLoop({
        ...opts,
        signal: controller.signal,
      });
      addUsage(nextUsage);
      if (softTimedOut && !upstreamSignal.aborted) {
        appendAgentLoopContinuation(opts.messages, "run_timeout");
        continue;
      }
      return usage;
    } catch (err) {
      if (softTimedOut && !upstreamSignal.aborted) {
        // Clear partial text the client received before the abort so the
        // resumed model doesn't re-emit it and produce duplicated output.
        opts.send({ type: "clear" });
        appendAgentLoopContinuation(opts.messages, "run_timeout");
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
        opts.send({ type: "clear" });
        appendAgentLoopContinuation(
          opts.messages,
          continuationReasonForResumableError(err),
        );
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }

  return usage;
}
