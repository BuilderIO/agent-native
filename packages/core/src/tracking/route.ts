/**
 * Server route handler for client-originated tracking events.
 *
 * The browser-side `track()` helper (see `client/track.ts`) POSTs
 * `{ name, properties }` to `/_agent-native/track`. This handler validates the
 * payload, resolves the caller's identity, and forwards the event to the same
 * server-side provider registry that server code reaches through `track()`.
 *
 * It is deliberately best-effort: a malformed body is rejected with a 400, but
 * provider delivery never throws back to the browser (the server `track()`
 * already swallows provider errors). On success it returns 204 with no body.
 *
 * Security: this is an authenticated, first-party-only endpoint. It is mounted
 * behind the framework CSRF middleware (which requires the
 * `X-Agent-Native-CSRF` header / JSON content type / same-origin marker that
 * the client helper always sends) and it requires a resolved session so it
 * cannot be used as an open analytics relay. Events are attributed to the
 * resolved `userId` (and `orgId` when the request has an active org), never to
 * a client-supplied identity.
 */

/** Max length of an event name. Mirrors typical provider limits. */
export const MAX_TRACK_EVENT_NAME_LENGTH = 200;

/** Max serialized size of the `properties` object, in bytes. */
export const MAX_TRACK_PROPERTIES_BYTES = 16 * 1024;

export interface TrackRouteValidationResult {
  ok: boolean;
  /** Present when `ok` is true. */
  name?: string;
  properties?: Record<string, unknown>;
  /** Present when `ok` is false — a short, client-safe reason. */
  error?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate a client tracking payload. Pure and synchronous so it can be unit
 * tested without standing up an h3 event.
 *
 *   - `name` must be a non-empty string no longer than
 *     `MAX_TRACK_EVENT_NAME_LENGTH` characters.
 *   - `properties`, when present, must be a plain JSON object whose serialized
 *     size is at most `MAX_TRACK_PROPERTIES_BYTES` bytes.
 */
export function validateTrackPayload(
  body: unknown,
): TrackRouteValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const { name, properties } = body as {
    name?: unknown;
    properties?: unknown;
  };

  if (typeof name !== "string") {
    return { ok: false, error: "`name` must be a string." };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "`name` must be a non-empty string." };
  }
  if (trimmed.length > MAX_TRACK_EVENT_NAME_LENGTH) {
    return {
      ok: false,
      error: `\`name\` must be at most ${MAX_TRACK_EVENT_NAME_LENGTH} characters.`,
    };
  }

  if (properties !== undefined && !isPlainObject(properties)) {
    return { ok: false, error: "`properties` must be a plain JSON object." };
  }

  let serializedProperties: string | undefined;
  if (properties !== undefined) {
    try {
      serializedProperties = JSON.stringify(properties);
    } catch {
      return { ok: false, error: "`properties` must be JSON-serializable." };
    }
    if (
      serializedProperties !== undefined &&
      Buffer.byteLength(serializedProperties, "utf8") >
        MAX_TRACK_PROPERTIES_BYTES
    ) {
      return {
        ok: false,
        error: `\`properties\` must serialize to at most ${MAX_TRACK_PROPERTIES_BYTES} bytes.`,
      };
    }
  }

  return {
    ok: true,
    name: trimmed,
    properties: properties as Record<string, unknown> | undefined,
  };
}
