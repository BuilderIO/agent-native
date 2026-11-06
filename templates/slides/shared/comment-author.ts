// Widget callers are the signed-in person clicking inside an embedded view; every other caller acts on their behalf.
const PERSON_CALLERS = new Set(["frontend", "mcp-widget", "mcp-widget-write"]);

export const AGENT_AUTHOR_NAME = "AI Agent";

// Comments saved before author_kind existed have a null kind but carry the agent's display name.
export function isAgentAuthoredComment(comment: {
  authorKind: string | null;
  authorName: string | null;
}): boolean {
  return (
    comment.authorKind === "agent" ||
    (comment.authorKind === null && comment.authorName === AGENT_AUTHOR_NAME)
  );
}

export function commentAuthorKind(
  caller: string | undefined,
): "agent" | "person" {
  return caller === undefined || PERSON_CALLERS.has(caller)
    ? "person"
    : "agent";
}

// The agent runs as the signed-in user, so its reactions need their own key or the user's toggle would remove them.
export function commentActorKey(
  caller: string | undefined,
  email: string,
): string {
  return commentAuthorKind(caller) === "agent" ? `agent:${email}` : email;
}
