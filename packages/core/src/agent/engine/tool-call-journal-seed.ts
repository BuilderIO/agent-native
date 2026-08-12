import { getCurrentTurnEventsForThread } from "../run-store.js";
import {
  classifyToolCallJournal,
  type ToolCallJournal,
} from "../tool-call-journal.js";
import type { AgentChatEvent } from "../types.js";

/**
 * Minimal shape `runAgentLoop` needs from a prior tool call — kept local
 * (rather than importing `AgentLoopToolCallSummary` from `production-agent.js`)
 * so this module has no runtime dependency back on the file that calls it.
 */
export interface PriorTurnToolCallSummary {
  name: string;
  input: unknown;
}

/** Minimal shape `runAgentLoop` needs from a prior tool result. See
 * `PriorTurnToolCallSummary` for why this is a local shape, not an import. */
export interface PriorTurnToolResultSummary {
  name: string;
  /**
   * Input of the `tool_start` this result was matched to, so the caller can
   * rebuild the same `(tool, arguments)` breaker key its live counters use.
   * Legacy `tool_done` events carry no input; those keep the positional
   * FIFO-per-tool pairing documented in `tool-call-journal.ts`, so this is
   * absent only when neither event carried one.
   */
  input?: unknown;
  content: string;
  isError: boolean;
}

/**
 * Outcome of reading the per-turn ledger. `unreadable` is deliberately NOT the
 * same value as a turn with no history: the repetition ledger, the read-only
 * result cache and the write-replay hard block are all seeded from this read,
 * so a swallowed ledger failure silently restores the per-chunk ceilings those
 * mechanisms exist to remove.
 */
export type PriorTurnToolCallJournalRead =
  | {
      status: "read";
      toolCallJournal: ToolCallJournal | null;
      priorToolCalls: PriorTurnToolCallSummary[];
      priorToolResults: PriorTurnToolResultSummary[];
    }
  | { status: "unreadable"; error: string };

/**
 * Tool-call journal hard-block (resume safety). Snapshot the per-turn journal
 * ONCE here, before any tool runs in this chunk, so it reflects only PRIOR
 * run chunks of this logical turn. A write tool whose exact call already
 * completed in an earlier interrupted chunk must not re-fire its side effect;
 * when matched, `runToolCall` returns the journaled result instead of
 * executing.
 *
 * Loaded eagerly (not lazily mid-loop) so the current chunk's own
 * asynchronously-persisted tool_done events can never leak in and make a
 * same-chunk call wrongly short-circuit. Fresh first-turn calls see an empty
 * journal and are unaffected.
 *
 * Also returns the prior chunks' tool calls/results so the caller can seed
 * its own `toolCallHistory` / `toolResultHistory` accumulators — final
 * response guards must see successful reads from earlier chunks, not only
 * tools executed after the latest handoff. Otherwise a guard can reject a
 * grounded answer (or a successfully-created artifact) after the
 * evidence-producing query completed in a predecessor run.
 */
export async function loadPriorTurnToolCallJournal(
  threadId: string | undefined,
  turnId?: string,
): Promise<PriorTurnToolCallJournalRead> {
  if (!threadId) {
    // No thread means no durable ledger exists for this turn at all — a true
    // "no prior history", not a read that failed.
    return {
      status: "read",
      toolCallJournal: null,
      priorToolCalls: [],
      priorToolResults: [],
    };
  }
  let priorEvents: AgentChatEvent[];
  try {
    priorEvents = await getCurrentTurnEventsForThread(threadId, turnId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      `[tool-call-journal] per-turn ledger read failed for thread ${threadId}: ${error}`,
    );
    return { status: "unreadable", error };
  }
  const priorToolCalls: PriorTurnToolCallSummary[] = [];
  const priorToolResults: PriorTurnToolResultSummary[] = [];
  // Open `tool_start` inputs per tool, so a legacy `tool_done` with no input of
  // its own can still be attributed to the arguments it ran with.
  const openInputsByTool = new Map<string, unknown[]>();
  for (const event of priorEvents) {
    if (event.type === "tool_start") {
      priorToolCalls.push({ name: event.tool, input: event.input });
      const queue = openInputsByTool.get(event.tool);
      if (queue) queue.push(event.input);
      else openInputsByTool.set(event.tool, [event.input]);
    } else if (event.type === "tool_done") {
      const fifoInput = openInputsByTool.get(event.tool)?.shift();
      priorToolResults.push({
        name: event.tool,
        input: event.input ?? fifoInput,
        content: event.result,
        isError: event.isError === true,
      });
    }
  }
  return {
    status: "read",
    toolCallJournal:
      priorEvents.length > 0 ? classifyToolCallJournal(priorEvents) : null,
    priorToolCalls,
    priorToolResults,
  };
}
