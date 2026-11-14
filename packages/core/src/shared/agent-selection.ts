/**
 * Objects the user picked with the composer's Select mode travel as ordinary
 * agent chat context items. This key namespace is what marks them as the
 * target set, so the prompt formatter and server actions can tell them apart
 * from ambient context such as the open page.
 */
export const AGENT_SELECTION_CONTEXT_KEY_PREFIX = "agent-select:";

/** application_state key mirroring the picked objects for actions to read. */
export const AGENT_SELECTION_STATE_KEY = "agent-selection";

export interface AgentSelectionReference {
  kind: string;
  id: string;
}

export interface AgentSelectionStateItem extends AgentSelectionReference {
  title: string;
}

export interface AgentSelectionState {
  items: AgentSelectionStateItem[];
  updatedAt: number;
}

// The kind is the segment before the first ":" after the prefix, so it must
// not contain one; the id is URI-encoded and may contain anything.
const KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function agentSelectionContextKey(kind: string, id: string): string {
  const normalizedKind = kind.trim();
  const normalizedId = id.trim();
  if (!KIND_PATTERN.test(normalizedKind)) {
    throw new TypeError(
      `Invalid agent selection kind: ${JSON.stringify(kind)}`,
    );
  }
  if (!normalizedId) {
    throw new TypeError("Agent selection id must not be empty.");
  }
  return `${AGENT_SELECTION_CONTEXT_KEY_PREFIX}${normalizedKind}:${encodeURIComponent(normalizedId)}`;
}

export function parseAgentSelectionContextKey(
  key: string,
): AgentSelectionReference | null {
  if (!key.startsWith(AGENT_SELECTION_CONTEXT_KEY_PREFIX)) return null;
  const rest = key.slice(AGENT_SELECTION_CONTEXT_KEY_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const kind = rest.slice(0, separator);
  if (!KIND_PATTERN.test(kind)) return null;
  try {
    const id = decodeURIComponent(rest.slice(separator + 1));
    return id ? { kind, id } : null;
  } catch {
    // coercion-ok: a key that is not URI-decodable was not written by agentSelectionContextKey
    return null;
  }
}

export function isAgentSelectionContextKey(key: string): boolean {
  return parseAgentSelectionContextKey(key) !== null;
}

/**
 * The preamble that makes picked objects the explicit target set. Returns an
 * empty string when nothing in `items` was picked with Select.
 */
export function formatAgentSelectionPreamble(
  items: readonly { key: string; title: string }[],
): string {
  const lines: string[] = [];
  for (const item of items) {
    const reference = parseAgentSelectionContextKey(item.key);
    if (!reference) continue;
    lines.push(
      `- ${reference.kind} ${JSON.stringify(item.title)} (id: ${JSON.stringify(reference.id)})`,
    );
  }
  if (lines.length === 0) return "";
  return [
    "## Selected objects",
    "The user picked these objects with Select. They are the target set: apply the request to them and leave everything else unchanged unless the message says otherwise.",
    ...lines,
  ].join("\n");
}
