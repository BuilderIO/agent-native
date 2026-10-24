/**
 * Awareness fields through which a client says it can save the document's
 * pending edits. A server asks the clients that set them to save before it
 * writes, so only a session that can edit the document may set them.
 */
const EDIT_CAPABILITY_FIELDS = ["canFlushDocument", "canFlushTitle"] as const;

export interface AwarenessIdentity {
  email: string;
  canEdit: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns the state a client posted, with its identity taken from the session
 * instead of from the client: `user.email` is the session's email, and a
 * session that can't edit the document advertises no save capability. Returns
 * null when the state isn't a JSON object, since its identity can't be set.
 */
export function stampAwarenessState(
  state: unknown,
  identity: AwarenessIdentity,
): string | null {
  if (typeof state !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
    // coercion-ok: null is the refusal postAwareness answers with a 400
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const stamped: Record<string, unknown> = { ...parsed };
  if (stamped.user != null) {
    stamped.user = {
      ...(isPlainObject(stamped.user) ? stamped.user : {}),
      email: identity.email,
    };
  }
  if (!identity.canEdit) {
    // Set, not deleted: a state without `canFlushDocument` still counts as a
    // best-effort editor to the servers that ask open editors to save.
    for (const field of EDIT_CAPABILITY_FIELDS) stamped[field] = false;
  }
  return JSON.stringify(stamped);
}
