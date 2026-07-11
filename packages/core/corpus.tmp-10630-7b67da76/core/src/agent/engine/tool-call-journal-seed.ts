import { getCurrentTurnEventsForThread } from "../run-store.js";
import {
  classifyToolCallJournal,
  type ToolCallJournal,
} from "../tool-call-journal.js";

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
  content: string;
  isError: boolean;
}

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
 * same-chunk call wrongly short-circuit. Best-effort: any ledger failure
 * leaves the journal empty and all calls run normally. Fresh first-turn calls
 * see an empty journal and are unaffected.
 *
 * Also returns the prior chunks' tool calls/results so the caller can seed
 * its own `toolCallHistory` / `toolResultHistory` accumulators — final
 * response guards must see successful reads from earlier chunks, not only
 * tools executed after the latest handoff. Otherwise a guard can reject a
 * grounded answer (or a successfully-created artifact) after the
 * evidence-producing query completed in a predecessor run.
 *
 * Moved verbatim out of `runAgentLoop`'s per-turn setup — behavior unchanged.
 */
export async function loadPriorTurnToolCallJournal(
  threadId: string | undefined,
): Promise<{
  toolCallJournal: ToolCallJournal | null;
  priorToolCalls: PriorTurnToolCallSummary[];
  priorToolResults: PriorTurnToolResultSummary[];
}> {
  const priorToolCalls: PriorTurnToolCallSummary[] = [];
  const priorToolResults: PriorTurnToolResultSummary[] = [];
  let toolCallJournal: ToolCallJournal | null = null;
  if (!threadId) {
    return { toolCallJournal, priorToolCalls, priorToolResults };
  }
  try {
    const priorEvents = await getCurrentTurnEventsForThread(threadId);
    if (priorEvents.length > 0) {
      for (const event of priorEvents) {
        if (event.type === "tool_start") {
          priorToolCalls.push({
            name: event.tool,
            input: event.input,
          });
        } else if (event.type === "tool_done") {
          priorToolResults.push({
            name: event.tool,
            content: event.result,
            isError: event.isError === true,
          });
        }
      }
      toolCallJournal = classifyToolCallJournal(priorEvents);
    }
  } catch {
    // Journal is a hardening layer, never a gate — a failed ledger read just
    // means no hard-block this turn.
  }
  return { toolCallJournal, priorToolCalls, priorToolResults };
}
