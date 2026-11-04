// Only the signed-in person's own UI is "person"; every other caller (tool, MCP, HTTP, A2A) acts on their behalf.
export function commentAuthorKind(
  caller: string | undefined,
): "agent" | "person" {
  return caller === undefined || caller === "frontend" ? "person" : "agent";
}
