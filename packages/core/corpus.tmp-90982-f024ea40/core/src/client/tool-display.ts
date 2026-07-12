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
