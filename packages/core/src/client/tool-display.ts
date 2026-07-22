const TOOL_DISPLAY_NAMES: Record<string, string> = {
  "delete-file": "remove screen",
  "get-design-snapshot": "get screen snapshot",
  "edit-design": "edit screen",
};

export function humanizeToolName(toolName: string | undefined): string {
  const raw = (toolName ?? "").trim();
  if (!raw) return "tool";
  const displayName = TOOL_DISPLAY_NAMES[raw];
  if (displayName) return displayName;

  let name = raw;
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    name = parts[parts.length - 1] ?? name;
  }

  name = name
    .replace(/^_+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (name || "tool").toLowerCase();
}

export function runningToolLabel(toolName: string | undefined): string {
  return `Running ${humanizeToolName(toolName)}`;
}

export function humanizeToolLabelText(
  label: string,
  toolName: string | undefined,
): string {
  const text = label.trim();
  const tool = (toolName ?? "").trim();
  if (!tool) return text;
  return text.split(tool).join(humanizeToolName(tool));
}

type ToolDisplayPart = {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
};

function normalizedAgentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return name || null;
}

/**
 * `call-agent` emits both its ordinary tool row and a richer `agent:<name>`
 * progress row. Keep the ordinary part in message state for tool completion
 * and history, but let presentation code suppress it once the richer row is
 * available.
 */
export function isCallAgentToolCallShadowed(
  parts: readonly ToolDisplayPart[],
  index: number,
): boolean {
  const part = parts[index];
  if (part?.type !== "tool-call" || part.toolName !== "call-agent") {
    return false;
  }

  const target = normalizedAgentName(part.args?.agent);
  if (!target) return false;

  return parts.slice(index + 1).some((candidate) => {
    if (
      candidate.type !== "tool-call" ||
      !candidate.toolName?.startsWith("agent:")
    ) {
      return false;
    }
    return normalizedAgentName(candidate.toolName.slice(6)) === target;
  });
}

export function shadowedCallAgentToolCallIds(
  parts: readonly ToolDisplayPart[],
): Set<string> {
  const ids = new Set<string>();
  parts.forEach((part, index) => {
    if (part.toolCallId && isCallAgentToolCallShadowed(parts, index)) {
      ids.add(part.toolCallId);
    }
  });
  return ids;
}
