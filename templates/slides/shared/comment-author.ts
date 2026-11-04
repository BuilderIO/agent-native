// Widget callers are the signed-in person clicking inside an embedded view; every other caller acts on their behalf.
const PERSON_CALLERS = new Set(["frontend", "mcp-widget", "mcp-widget-write"]);

export function commentAuthorKind(
  caller: string | undefined,
): "agent" | "person" {
  return caller === undefined || PERSON_CALLERS.has(caller)
    ? "person"
    : "agent";
}
