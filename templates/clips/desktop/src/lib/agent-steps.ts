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
  | {
      type: "approval_required";
      tool: string;
      /** Echoed back as `approvedToolCalls` to let the paused call run. Kept
       *  because a step that drops it can never be resumed by anything. */
      approvalKey: string;
      toolCallId?: string;
      /** Distinguishes THIS gate hit from an earlier ask for the same call. */
      askId?: string;
      input?: Record<string, string>;
    }
  | { type: "error"; error?: string }
  | { type: "missing_api_key" }
  /** Terminal, and NOT a finished answer: the run was cut at a continuation
   *  boundary (timeout, token budget, no progress). See `ContinuationReason`
   *  in the framework's `agent/types.ts`. */
  | { type: "auto_continue"; reason: string }
  /** Terminal, and NOT a finished answer: the loop hit its iteration cap. */
  | { type: "loop_limit"; maxIterations?: number }
  | { type: "done" };

export type AgentStepStatus = "running" | "done" | "error" | "blocked";

/**
 * What kind of work a step is, which is all the icon strip shows.
 *
 * Every tool the agent can reach falls into one of these, so a run reads as a
 * short sequence of shapes — read, think, write — instead of a paragraph of
 * tool names nobody scans.
 */
export type AgentStepKind =
  | "think"
  | "read"
  | "search"
  | "write"
  | "call"
  | "wait";

/** One row in the sheet's step list. */
export interface AgentStep {
  /** Tool-call id when the stream gave one, else derived from the tool name. */
  key: string;
  label: string;
  kind: AgentStepKind;
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
  // For identifiers and labels, where blank means absent.
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;
  // For stream deltas, where blank means a space. Model chunks are not
  // word-aligned, so " " and "\n" arrive as deltas of their own; dropping them
  // is what runs two words together. `tail()` below already preserves this
  // seam once the text is in — it never gets the chance if the frame is
  // discarded here first.
  const delta = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  switch (type) {
    case "text": {
      const text = delta(ev.text);
      return text === undefined ? null : { type, text };
    }
    case "thinking": {
      const text = delta(ev.text);
      return text === undefined ? null : { type, text };
    }
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
    case "approval_required": {
      const tool = str(ev.tool);
      const approvalKey = str(ev.approvalKey);
      // Both are required upstream. A frame missing either cannot be resumed
      // by anyone, so rendering a "waiting for approval" row from it would be
      // a spinner with nothing behind it — exactly the plausible-looking state
      // this parser exists to refuse.
      if (!tool || !approvalKey) return null;
      return {
        type,
        tool,
        approvalKey,
        toolCallId: str(ev.toolCallId),
        askId: str(ev.askId),
        input: stringRecord(ev.input),
      };
    }
    case "error":
      return { type, error: str(ev.error) };
    case "auto_continue":
      return { type, reason: str(ev.reason) ?? "unknown" };
    case "loop_limit":
      return {
        type,
        maxIterations:
          typeof ev.maxIterations === "number" &&
          Number.isFinite(ev.maxIterations)
            ? ev.maxIterations
            : undefined,
      };
    case "missing_api_key":
    case "done":
      return { type };
    default:
      return null;
  }
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Why a run ended without finishing, or null when it finished cleanly.
 *
 * The stream closes the same way whether the agent answered or was cut off at
 * a timeout, a loop cap, or an approval gate. Only the terminal frame tells
 * those apart, so whatever text arrived before one of these is a fragment, not
 * the answer — presenting it as the answer is the bug this guards.
 */
export interface AskIncomplete {
  kind: "auto_continue" | "loop_limit" | "approval_required" | "error";
  /** One line to show under whatever text did arrive. */
  message: string;
}

export function askIncompleteForFrame(frame: AgentFrame): AskIncomplete | null {
  switch (frame.type) {
    case "auto_continue":
      return {
        kind: "auto_continue",
        message: "The agent ran out of time before finishing this answer.",
      };
    case "loop_limit":
      return {
        kind: "loop_limit",
        message: "The agent hit its step limit before finishing this answer.",
      };
    case "approval_required":
      return {
        kind: "approval_required",
        message: `This needs approval to run ${labelForTool(frame.tool).toLowerCase()}. Open Clips to approve it.`,
      };
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

/** Verb-first classification. A tool absent here is read-only by default:
 *  claiming the agent wrote something it only looked at is the worse error. */
const WRITE_PREFIXES = [
  "create-",
  "update-",
  "add-",
  "delete-",
  "trash-",
  "archive-",
  "restore-",
  "move-",
  "finalize-",
  "share-",
  "set-",
  "send-",
  "import-",
  "export-",
  "trim-",
  "split-",
  "remove-",
  "cleanup-",
  "regenerate-",
  "prepare-",
];

export function kindForTool(tool: string): AgentStepKind {
  if (!tool) return "think";
  if (tool.startsWith("provider-api-") || tool.startsWith("integration")) {
    return "call";
  }
  if (WRITE_PREFIXES.some((prefix) => tool.startsWith(prefix))) return "write";
  // Searching and reading are the same to the code and different to the
  // reader: a magnifier over "Reading" is the mismatch that reads as a bug.
  if (tool.startsWith("search-") || tool.startsWith("find-")) return "search";
  return "read";
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

/** Newest reasoning, bounded to what a small overlay can show. */
const THINKING_TAIL = 220;

function tail(text: string): string | undefined {
  // Only the leading edge is trimmed. Trailing whitespace is the seam between
  // two deltas — trimming it here is what runs the next word into this one.
  const collapsed = text.replace(/\s+/g, " ").replace(/^ /, "");
  if (!collapsed.trim()) return undefined;
  return collapsed.length > THINKING_TAIL
    ? `…${collapsed.slice(-THINKING_TAIL)}`
    : collapsed;
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
        {
          key,
          label: labelForTool(frame.tool),
          kind: kindForTool(frame.tool),
          status: "running",
        },
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
          {
            key,
            label: labelForTool(frame.tool),
            kind: kindForTool(frame.tool),
            status,
            detail,
          },
        ];
      }
      const next = [...steps];
      next[index] = { ...next[index], status, detail };
      return next;
    }
    case "thinking": {
      // Reasoning streams in deltas. Only the tail is kept: the strip shows
      // what the agent is thinking now, not a transcript of how it got there.
      const index = lastIndexWhere(
        steps,
        (s) => s.kind === "think" && s.status === "running",
      );
      if (index < 0) {
        return [
          ...steps,
          {
            key: `thinking:${steps.length}`,
            label: "Thought",
            kind: "think",
            status: "running",
            detail: tail(frame.text),
          },
        ];
      }
      const next = [...steps];
      next[index] = {
        ...next[index],
        detail: tail(`${next[index].detail ?? ""}${frame.text}`),
      };
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
            kind: frame.tool ? kindForTool(frame.tool) : "think",
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
      // Keyed by the call, not by position: a failed resume re-emits the same
      // approval with a fresh `askId`, and stacking a second identical row
      // would read as the agent asking twice.
      const key = `approval:${frame.approvalKey}`;
      const step: AgentStep = {
        key,
        label: `Needs approval: ${labelForTool(frame.tool)}`,
        kind: "wait",
        status: "blocked",
      };
      const index = steps.findIndex((s) => s.key === key);
      if (index < 0) return [...steps, step];
      const next = [...steps];
      next[index] = step;
      return next;
    }
    default:
      return steps;
  }
}

/**
 * Close out the list when the stream ends. A step left spinning after the
 * answer arrived would claim work is still running forever — the stream's own
 * end is the only signal that it is not.
 *
 * `incomplete` is what the run ended on. A run cut at a timeout, a loop cap, or
 * an approval gate did NOT finish the tool it was in the middle of, so those
 * steps settle as blocked rather than done: "Searched" under an answer that was
 * truncated mid-search is the same lie as calling the fragment an answer.
 */
export function settleSteps(
  steps: AgentStep[],
  incomplete?: AskIncomplete | null,
): AgentStep[] {
  if (!steps.some((s) => s.status === "running")) return steps;
  const settled: AgentStepStatus = incomplete ? "blocked" : "done";
  return steps.map((s) =>
    s.status === "running" ? { ...s, status: settled } : s,
  );
}

function lastIndexWhere<T>(items: T[], match: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (match(items[i])) return i;
  }
  return -1;
}
