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
      approvalKey: string;
      toolCallId?: string;
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

export type AgentStepKind =
  | "think"
  | "read"
  | "search"
  | "write"
  | "call"
  | "wait";

export interface AgentStep {
  key: string;
  label: string;
  kind: AgentStepKind;
  status: AgentStepStatus;
  detail?: string;
}

export function parseAgentFrame(raw: unknown): AgentFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  const type = typeof ev.type === "string" ? ev.type : null;
  if (!type) return null;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;
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

export interface AskIncomplete {
  kind: "auto_continue" | "loop_limit" | "approval_required" | "error";
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

export function labelForTool(tool: string): string {
  const known = TOOL_LABELS[tool];
  if (known) return known;
  const words = tool.replace(/[-_]+/g, " ").trim();
  if (!words) return "Working";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

const THINKING_TAIL = 220;

function tail(text: string): string | undefined {
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
