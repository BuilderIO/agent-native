export function humanizeToolName(toolName: string | undefined): string {
  const raw = (toolName ?? "").trim();
  if (!raw) return "tool";

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
