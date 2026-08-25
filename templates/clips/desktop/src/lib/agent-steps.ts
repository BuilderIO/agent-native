// What the agent did, as the ask sheet shows it.
//
// The framework's agent-chat stream already carries tool calls, their results,
// and server-authored progress labels — see the `AgentChatEvent` union in
// `packages/core/src/agent/types.ts`, which core's own `sse-event-processor`
// renders in full for the web chat. The pill consumed `text` plus `activity`
// and dropped the rest, which is why a working agent looked like it sat there
// doing nothing and then answered.
//
// The desktop app deliberately carries no `@agent-native/core` dependency
// (overlay bundle weight), so the frames it reads are re-declared here. Keep
// this union a strict subset of the framework's: a frame that changes shape
// upstream must fail to parse here, not render as something plausible.

/** The subset of the framework's stream frames the pill presents. */
export type AgentFrame =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "activity"; label: string; tool?: string }
  | { type: "tool_start"; tool: string; id?: string }
  | {
      type: "tool_done";
      tool: string;
      id?: string;
      result?: unknown;
      isError?: boolean;
    }
  | { type: "approval_required"; tool?: string }
  | { type: "error"; error?: string }
  | { type: "missing_api_key" }
  | { type: "done" };

export type AgentStepStatus = "running" | "done" | "error" | "blocked";

/** One row in the sheet's step list. */
export interface AgentStep {
  /** Tool-call id when the stream gave one, else derived from the tool name. */
  key: string;
  label: string;
  status: AgentStepStatus;
  /** One line about the outcome, only when the result actually says something. */
  detail?: string;
}

/**
 * Frames arrive as untyped JSON. Anything unrecognized returns null so it is
 * skipped rather than rendered as an empty step.
 */
export function parseAgentFrame(raw: unknown): AgentFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  const type = typeof ev.type === "string" ? ev.type : null;
  if (!type) return null;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;

  switch (type) {
    case "text":
      return str(ev.text) ? { type, text: ev.text as string } : null;
    case "thinking":
      return str(ev.text) ? { type, text: ev.text as string } : null;
    case "activity":
      return str(ev.label)
        ? { type, label: ev.label as string, tool: str(ev.tool) }
        : null;
    case "tool_start":
      return str(ev.tool)
        ? { type, tool: ev.tool as string, id: str(ev.id) }
        : null;
    case "tool_done":
      return str(ev.tool)
        ? {
            type,
            tool: ev.tool as string,
            id: str(ev.id),
            result: ev.result,
            isError: ev.isError === true,
          }
        : null;
    case "approval_required":
      return { type, tool: str(ev.tool) };
    case "error":
      return { type, error: str(ev.error) };
    case "missing_api_key":
    case "done":
      return { type };
    default:
      return null;
  }
}

const TOOL_LABELS: Record<string, string> = {
  "get-meeting": "Reading this meeting",
  "list-meetings": "Checking your meetings",
  "search-meetings": "Searching past meetings",
  "update-meeting": "Updating the meeting",
  "create-meeting": "Creating a meeting",
  "finalize-meeting": "Wrapping up the meeting",
  "search-recordings": "Searching recordings",
  "get-recording-player-data": "Reading a recording",
  "add-comment": "Adding a comment",
  "view-screen": "Checking the current screen",
  "tool-search": "Finding the right tool",
  "provider-api-catalog": "Checking connected apps",
  "provider-api-docs": "Reading the provider's API",
  "provider-api-request": "Calling a connected app",
};

/**
 * A readable label for a tool row. Unknown tools fall back to their own id
 * rather than a generic "Working", so a new action is still legible.
 */
export function labelForTool(tool: string): string {
  const known = TOOL_LABELS[tool];
  if (known) return known;
  const words = tool.replace(/[-_]+/g, " ").trim();
  if (!words) return "Working";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DETAIL_MAX = 80;
const COUNTABLE_KEYS = [
  "meetings",
  "recordings",
  "results",
  "items",
  "rows",
  "comments",
  "events",
];

/**
 * One line about what a tool returned, or nothing.
 *
 * Nothing is the common case on purpose: a result is arbitrary JSON, and a
 * stringified blob under a step row reads as detail while saying less than the
 * row above it. Only a plain string or a countable collection qualifies.
 */
export function summarizeToolResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    const line = result.trim().split("\n")[0]?.trim();
    if (!line) return undefined;
    return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX)}…` : line;
  }
  if (Array.isArray(result)) return countLabel(result.length);
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    for (const key of COUNTABLE_KEYS) {
      const value = obj[key];
      if (Array.isArray(value)) return countLabel(value.length);
    }
    if (typeof obj.count === "number" && Number.isFinite(obj.count)) {
      return countLabel(obj.count);
    }
  }
  return undefined;
}

function countLabel(count: number): string {
  return count === 1 ? "1 result" : `${count} results`;
}

function keyFor(tool: string, id?: string): string {
  return id ? `id:${id}` : `tool:${tool}`;
}

/**
 * Fold one frame into the step list, returning the same array when the frame
 * changes nothing so React can skip the render.
 */
export function applyFrame(steps: AgentStep[], frame: AgentFrame): AgentStep[] {
  switch (frame.type) {
    case "tool_start": {
      const key = keyFor(frame.tool, frame.id);
      if (steps.some((s) => s.key === key && s.status === "running")) {
        return steps;
      }
      return [
        ...steps,
        { key, label: labelForTool(frame.tool), status: "running" },
      ];
    }
    case "tool_done": {
      const key = keyFor(frame.tool, frame.id);
      const status: AgentStepStatus = frame.isError ? "error" : "done";
      const detail = frame.isError
        ? undefined
        : summarizeToolResult(frame.result);
      const index = lastIndexWhere(
        steps,
        (s) => s.key === key && s.status === "running",
      );
      // A result with no matching start still gets a row: a step that only ever
      // reports its outcome is worth showing, and dropping it would hide work.
      if (index < 0) {
        return [
          ...steps,
          { key, label: labelForTool(frame.tool), status, detail },
        ];
      }
      const next = [...steps];
      next[index] = { ...next[index], status, detail };
      return next;
    }
    case "activity": {
      // Server-authored progress. It renames the work already in flight when
      // there is some, and stands alone when the agent is between tools.
      const index = lastIndexWhere(steps, (s) => s.status === "running");
      if (index < 0) {
        return [
          ...steps,
          {
            key: `activity:${steps.length}`,
            label: frame.label,
            status: "running",
          },
        ];
      }
      if (steps[index].label === frame.label) return steps;
      const next = [...steps];
      next[index] = { ...next[index], label: frame.label };
      return next;
    }
    case "approval_required": {
      const label = frame.tool
        ? `Waiting for approval: ${labelForTool(frame.tool)}`
        : "Waiting for approval";
      return [
        ...steps,
        { key: `approval:${steps.length}`, label, status: "blocked" },
      ];
    }
    default:
      return steps;
  }
}

/**
 * Close out the list when the stream ends. A step left spinning after the
 * answer arrived would claim work is still running forever — the stream's own
 * end is the only signal that it is not.
 */
export function settleSteps(steps: AgentStep[]): AgentStep[] {
  if (!steps.some((s) => s.status === "running")) return steps;
  return steps.map((s) =>
    s.status === "running" ? { ...s, status: "done" } : s,
  );
}

function lastIndexWhere<T>(items: T[], match: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (match(items[i])) return i;
  }
  return -1;
}
