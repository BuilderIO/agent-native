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
 * instead of from the client: `user.email` is the session's email, with a
 * `user` added when the client sent none, and a session that can't edit the
 * document advertises no save capability. Returns null when the state isn't a
 * JSON object, since its identity can't be set.
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
  // A user is added, not only corrected: a server asking open editors to save
  // reaches each one by its email, so an editor's state posted before its
  // user was set would otherwise refuse every save as unidentified.
  const stamped: Record<string, unknown> = {
    ...parsed,
    user: {
      ...(isPlainObject(parsed.user) ? parsed.user : {}),
      email: identity.email,
    },
  };
  if (!identity.canEdit) {
    // Set, not deleted: a state without `canFlushDocument` still counts as a
    // best-effort editor to the servers that ask open editors to save.
    for (const field of EDIT_CAPABILITY_FIELDS) stamped[field] = false;
  }
  return JSON.stringify(stamped);
}
