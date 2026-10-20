/**
 * Show a Builder (Fusion) coding agent's run as a delegated sub-agent inside
 * an Agent-Native chat.
 *
 * Fusion streams `GenerateCompletionStep`s (see sendFusionBranchMessage's
 * `onEvent`). This folds them into the same `agent_call*` events the A2A
 * `call-agent` path emits, so the chat renders the Builder agent's reasoning,
 * tool calls, file edits and reply in the existing delegated-agent cell, with
 * no UI changes.
 *
 * This is the AN-side half of the sub-agent protocol, written against today's
 * JSONL stream. When ai-services exposes the agent over AgentKit (HTTP+SSE),
 * only the input side of this mapping changes.
 */
import {
  applyA2AAgentActivityEvent,
  buildA2AAgentActivitySnapshot,
  createA2AAgentActivityState,
  type A2AAgentActivityState,
} from "../a2a/activity.js";
import type { AgentChatEvent } from "../agent/types.js";

const SNAPSHOT_INTERVAL_MS = 400;

export interface FusionAgentFeedSummary {
  text?: string;
  changedFiles: string[];
  creditsUsed?: number;
  error?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function shortToolInput(content: unknown): Record<string, unknown> {
  const raw = str(content) ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object")
      return parsed as Record<string, unknown>;
  } catch {
    // coercion-ok: tool input is not always JSON; show it as text.
  }
  return raw ? { input: raw.slice(0, 400) } : {};
}

/**
 * Fusion tool results carry the call's id but often not its name. Remember
 * what each started call was named, so a result completes that call (named)
 * instead of being folded in as a second, unnamed "tool" step.
 */
export interface FusionToolCallMemory {
  names: Map<string, string>;
  open: string[];
}

export function createFusionToolCallMemory(): FusionToolCallMemory {
  return { names: new Map(), open: [] };
}

/** Fusion step → the AN chat events the activity folder understands. */
export function fusionStepToAgentChatEvents(
  step: Record<string, unknown>,
  memory: FusionToolCallMemory = createFusionToolCallMemory(),
): AgentChatEvent[] {
  switch (step.type) {
    case "thinking": {
      const text = str(step.content);
      return text ? [{ type: "thinking", text }] : [];
    }
    case "text": {
      const text = str(step.content);
      return text ? [{ type: "text", text }] : [];
    }
    case "tool": {
      const tool = str(step.name) ?? str(step.toolName) ?? "tool";
      const id = str(step.id);
      if (id) {
        memory.names.set(id, tool);
        memory.open.push(id);
      }
      return [
        {
          type: "tool_start",
          tool,
          id,
          input: shortToolInput(step.content) as never,
        },
      ];
    }
    case "tool_result": {
      const result = (step.result ?? {}) as Record<string, unknown>;
      const knownId = str(result.tool_use_id) ?? str(result.id);
      // No id (or one never started): it finishes the oldest open call.
      const id =
        knownId && memory.names.has(knownId)
          ? knownId
          : (memory.open[0] ?? knownId);
      if (id) memory.open = memory.open.filter((openId) => openId !== id);
      const content = result.content;
      return [
        {
          type: "tool_done",
          tool:
            (id ? memory.names.get(id) : undefined) ??
            str(result.name) ??
            "tool",
          id,
          result:
            typeof content === "string"
              ? content.slice(0, 500)
              : JSON.stringify(content ?? "").slice(0, 500),
          isError: result.is_error === true,
        },
      ];
    }
    case "file":
    case "diff": {
      const filePath = str(step.filePath);
      if (!filePath) return [];
      const id = `edit:${filePath}`;
      return [
        {
          type: "tool_start",
          tool: "Edit",
          id,
          input: { file: filePath } as never,
        },
        { type: "tool_done", tool: "Edit", id, result: filePath },
      ];
    }
    case "error":
      return [
        {
          type: "error",
          error: str(step.message) ?? "Builder agent error",
        } as never,
      ];
    default:
      return [];
  }
}

export function createFusionAgentFeed(args: {
  send?: (event: AgentChatEvent) => void;
  agent: string;
  agentCallId: string;
}) {
  const { send, agent, agentCallId } = args;
  let state: A2AAgentActivityState = createA2AAgentActivityState();
  let lastSnapshotAt = 0;
  let lastSequence = -1;
  const summary: FusionAgentFeedSummary = { changedFiles: [] };
  const changed = new Set<string>();
  const toolCalls = createFusionToolCallMemory();

  const flush = (force = false) => {
    if (!send || state.sequence === lastSequence) return;
    const now = Date.now();
    if (!force && now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotAt = now;
    lastSequence = state.sequence;
    send({
      type: "agent_call_activity",
      agent,
      agentCallId,
      snapshot: buildA2AAgentActivitySnapshot(state),
    });
  };

  send?.({ type: "agent_call", agent, status: "start", agentCallId });

  return {
    summary,
    onEvent(step: Record<string, unknown>) {
      if (step.type === "text" && str(step.content))
        summary.text = str(step.content);
      if (
        (step.type === "file" || step.type === "diff") &&
        str(step.filePath)
      ) {
        changed.add(str(step.filePath)!);
      }
      if (step.type === "done") {
        const results = Array.isArray(step.applyResults)
          ? step.applyResults
          : [];
        for (const r of results) {
          const filePath = str((r as Record<string, unknown>)?.filePath);
          if (filePath) changed.add(filePath);
        }
        if (typeof step.creditsUsed === "number")
          summary.creditsUsed = step.creditsUsed;
      }
      for (const event of fusionStepToAgentChatEvents(step, toolCalls)) {
        state = applyA2AAgentActivityEvent(state, event);
      }
      flush();
    },
    finish(result: { sent: boolean; response?: string; error?: string }) {
      summary.changedFiles = [...changed];
      if (result.error) summary.error = result.error;
      state = applyA2AAgentActivityEvent(
        state,
        result.error
          ? ({ type: "error", error: result.error } as never)
          : ({ type: "done" } as never),
      );
      flush(true);
      // The reply is not sent as a chat line: the calling agent relays it in
      // its own answer, so a "messaged" row would show it twice. The
      // activity snapshot keeps it for the expanded view.
      send?.({
        type: "agent_call",
        agent,
        agentCallId,
        status: result.error ? "error" : "done",
        durationMs: Date.now() - state.startedAt,
      });
      return summary;
    },
  };
}
