import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../../artifacts/detect.js";
import { getCurrentTurnEventsForThread } from "../run-store.js";
import {
  classifyToolCallJournal,
  type ToolCallJournal,
} from "../tool-call-journal.js";
import type { AgentChatEvent } from "../types.js";

export interface PriorTurnToolCallSummary {
  name: string;
  input: unknown;
}

export interface PriorTurnToolResultSummary {
  name: string;
  input?: unknown;
  content: string;
  isError: boolean;
  artifacts?: ArtifactReceipt[];
}

export type PriorTurnToolCallJournalRead =
  | {
      status: "read";
      toolCallJournal: ToolCallJournal | null;
      priorToolCalls: PriorTurnToolCallSummary[];
      priorToolResults: PriorTurnToolResultSummary[];
    }
  | { status: "unreadable"; error: string };

const LEDGER_READ_RETRY_MS = 250;

async function readCurrentTurnEventsWithRetry(
  threadId: string,
  turnId?: string,
): Promise<AgentChatEvent[]> {
  try {
    return await getCurrentTurnEventsForThread(threadId, turnId);
  } catch (err) {
    console.warn(
      `[tool-call-journal] per-turn ledger read failed for thread ${threadId}, retrying once: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await new Promise((resolve) => setTimeout(resolve, LEDGER_READ_RETRY_MS));
    return await getCurrentTurnEventsForThread(threadId, turnId);
  }
}

export async function loadPriorTurnToolCallJournal(
  threadId: string | undefined,
  turnId?: string,
): Promise<PriorTurnToolCallJournalRead> {
  if (!threadId) {
    return {
      status: "read",
      toolCallJournal: null,
      priorToolCalls: [],
      priorToolResults: [],
    };
  }
  let priorEvents: AgentChatEvent[];
  try {
    priorEvents = await readCurrentTurnEventsWithRetry(threadId, turnId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      `[tool-call-journal] per-turn ledger read failed for thread ${threadId}: ${error}`,
    );
    return { status: "unreadable", error };
  }
  const priorToolCalls: PriorTurnToolCallSummary[] = [];
  const priorToolResults: PriorTurnToolResultSummary[] = [];
  const openInputsByTool = new Map<string, unknown[]>();
  for (const event of priorEvents) {
    if (event.type === "tool_start") {
      priorToolCalls.push({ name: event.tool, input: event.input });
      const queue = openInputsByTool.get(event.tool);
      if (queue) queue.push(event.input);
      else openInputsByTool.set(event.tool, [event.input]);
    } else if (event.type === "tool_done") {
      const fifoInput = openInputsByTool.get(event.tool)?.shift();
      const artifacts = event.artifacts?.filter(isArtifactReceipt);
      priorToolResults.push({
        name: event.tool,
        input: event.input ?? fifoInput,
        content: event.result,
        isError: event.isError === true,
        ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
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
