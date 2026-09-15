/**
 * One answer to "which action inputs did the model announce but never start?".
 *
 * Two callers need it and used to disagree. The continuation prompt
 * (`production-agent.ts`) tracked preparations per tool-call id, so a sibling
 * call finishing never cancelled an unrelated one. The run-manager's terminal
 * gate (`run-manager.ts`) used a single last-wins boolean, so ANY later text,
 * `tool_start`, or `tool_done` — including one belonging to a different call —
 * reported the turn as finished. A run that announced `resources` and then
 * narrated one more sentence therefore ended as a plain `done`, and the browser,
 * which tracks one card per call, rendered "the agent stopped before starting
 * the resources action" over a turn the server had just called successful.
 *
 * Preparation is per tool call, so the evidence has to be keyed per tool call.
 */

import type { AgentChatEvent } from "./types.js";

export type UnfinishedActionPreparation = {
  tool: string;
  /** Index of the newest event that evidenced this preparation. */
  order: number;
  id?: string;
};

export interface ActionPreparationScanOptions {
  /**
   * Errors the turn can still continue past. A recoverable error leaves the
   * preparation open because the continuation resumes the same tool input;
   * anything else ends the turn and takes the preparation with it. Callers that
   * omit this treat every error as terminal.
   */
  isRecoverableError?: (
    event: Extract<AgentChatEvent, { type: "error" }>,
  ) => boolean;
}

function isPreparingActionActivityEvent(
  event: AgentChatEvent,
): event is Extract<AgentChatEvent, { type: "activity" }> {
  if (event.type !== "activity") return false;
  const label = event.label.trim().toLowerCase();
  return label.startsWith("preparing ") && label.includes(" action");
}

/**
 * `tool_input_start` forces a matching preparation `activity` today, so these
 * are redundant in practice. They are read anyway so the answer cannot depend
 * on which of the three preparation signals a given engine or activity throttle
 * happened to emit.
 */
function preparationEvidence(
  event: AgentChatEvent,
): { tool: string; id?: string } | null {
  if (isPreparingActionActivityEvent(event)) {
    const tool = event.tool?.trim();
    if (!tool) return null;
    const id = event.id?.trim();
    return id ? { tool, id } : { tool };
  }
  if (event.type === "tool_input_start" || event.type === "tool_input_delta") {
    const tool = event.tool?.trim();
    if (!tool) return null;
    const id = event.id?.trim();
    return id ? { tool, id } : { tool };
  }
  return null;
}

/**
 * A boundary that ends one attempt at the model.
 *
 * These only clear when something FOLLOWS them: a boundary in the middle of the
 * window closed an earlier attempt, and anything it left open was superseded by
 * the continuation that came after (which re-prompts the model and re-issues
 * work under fresh call ids). A TRAILING boundary is the verdict under review,
 * and the whole point of the scan is what was still open when it arrived -
 * clearing on that would always answer "nothing".
 */
function isTurnBoundaryEvent(event: AgentChatEvent): boolean {
  return (
    event.type === "done" ||
    event.type === "auto_continue" ||
    event.type === "loop_limit"
  );
}

/**
 * Every tool input the model announced and never started, oldest first.
 */
export function unfinishedActionPreparations(
  events: readonly AgentChatEvent[],
  options?: ActionPreparationScanOptions,
): UnfinishedActionPreparation[] {
  const active = new Map<string, UnfinishedActionPreparation>();
  const idlessToolStarts = new Map<string, number>();

  const removeOldestMatchingActivePreparation = (
    tool: string,
    shouldRemove: (value: UnfinishedActionPreparation) => boolean = () => true,
  ) => {
    let oldest: { key: string; order: number } | undefined;
    for (const [key, value] of active) {
      if (value.tool !== tool || !shouldRemove(value)) continue;
      if (!oldest || value.order < oldest.order) {
        oldest = { key, order: value.order };
      }
    }
    if (oldest) active.delete(oldest.key);
    return Boolean(oldest);
  };

  /**
   * Once a tool RUNS, any older announcement of that same tool was served.
   *
   * Call ids are not comparable across a re-issue: when a truncated tool input
   * is retried inside one chunk, the model re-announces under a fresh id and
   * the first announcement would otherwise stay open for the rest of the turn -
   * continuing a turn that had in fact carried the intention out.
   */
  const retireOlderPreparationsForTool = (tool: string, order: number) => {
    for (const [key, value] of [...active]) {
      if (value.tool === tool && value.order < order) active.delete(key);
    }
  };

  const removeMatchingActivePreparation = (
    event: {
      id?: string;
      tool?: string;
      type: "tool_done" | "tool_start";
    },
    order: number,
  ) => {
    const id = event.id?.trim();
    const tool = event.tool?.trim();
    if (!tool) return;
    if (id) {
      if (!active.delete(`id:${id}`)) {
        removeOldestMatchingActivePreparation(tool, (value) => !value.id);
      }
      if (event.type === "tool_start")
        retireOlderPreparationsForTool(tool, order);
      return;
    }

    if (event.type === "tool_start") {
      if (removeOldestMatchingActivePreparation(tool)) {
        idlessToolStarts.set(tool, (idlessToolStarts.get(tool) ?? 0) + 1);
      }
      return;
    }

    const startedCount = idlessToolStarts.get(tool) ?? 0;
    if (startedCount > 0) {
      if (startedCount === 1) {
        idlessToolStarts.delete(tool);
      } else {
        idlessToolStarts.set(tool, startedCount - 1);
      }
      return;
    }
    removeOldestMatchingActivePreparation(tool);
  };

  events.forEach((event, order) => {
    const evidence = preparationEvidence(event);
    if (evidence) {
      const key = evidence.id
        ? `id:${evidence.id}`
        : `tool:${evidence.tool}:${order}`;
      active.set(key, {
        tool: evidence.tool,
        order,
        ...(evidence.id ? { id: evidence.id } : {}),
      });
      return;
    }
    if (event.type === "tool_start" || event.type === "tool_done") {
      removeMatchingActivePreparation(event, order);
      return;
    }
    if (
      event.type === "error" &&
      options?.isRecoverableError?.(event) === true
    ) {
      return;
    }
    if (
      event.type === "clear" ||
      event.type === "error" ||
      event.type === "missing_api_key" ||
      // The turn handed control to the user on purpose. Whatever else the model
      // had queued is the user's call to resume, not ours to auto-continue.
      event.type === "approval_required" ||
      (isTurnBoundaryEvent(event) && order < events.length - 1)
    ) {
      active.clear();
      idlessToolStarts.clear();
    }
  });

  return [...active.values()].sort((a, b) => a.order - b.order);
}

/**
 * The tool whose input was announced most recently and never started.
 */
export function lastUnfinishedActionPreparationTool(
  events: readonly AgentChatEvent[],
  options?: ActionPreparationScanOptions,
): string | undefined {
  return unfinishedActionPreparations(events, options).at(-1)?.tool;
}
