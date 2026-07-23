/**
 * Realtime SSE wire protocol — shared by the server SSE handlers (framework
 * in-process path + the hosted Realtime Gateway) and the client transport.
 *
 * Pure constants, types, and parsers only — NO h3/node/browser deps — so both
 * the Node server and the browser client import it.
 *
 * Frame taxonomy:
 *   - CHANGE / batch frames ride the default (unnamed) SSE `message` event and
 *     are parsed by the client's existing `normalizeEventPayload`. Unchanged.
 *   - CONTROL frames (handshake, token rotation) ride NAMED SSE events, so
 *     `EventSource.addEventListener(name)` routes them separately and an older
 *     client that only reads `onmessage` silently ignores them (backward safe).
 */

export const REALTIME_PROTOCOL_VERSION = 1;

/** Named SSE event carrying the one-time handshake ({@link RealtimeHandshake}). */
export const REALTIME_SSE_HANDSHAKE_EVENT = "handshake";
/** Named SSE event carrying a rotated subscribe token ({@link RealtimeTokenFrame}). */
export const REALTIME_SSE_TOKEN_EVENT = "token";

/**
 * Capability advertised by the hosted gateway: awareness/presence is NOT
 * forwarded (it lives only on the in-process emitter, never in `sync_events`),
 * so the collab client must keep its own presence cadence. The framework's
 * in-process SSE path forwards awareness and therefore sends no handshake — the
 * client treats an absent handshake as "all capabilities present."
 */
export const REALTIME_CAP_NO_AWARENESS = "no-awareness";

export interface RealtimeHandshake {
  protocol: number;
  capabilities: string[];
}

export interface RealtimeTokenFrame {
  token: string;
  /** ISO expiry, informational; the client re-mints/rotates before this. */
  expiresAt?: string;
}

export function buildHandshakeFrame(
  capabilities: readonly string[] = [],
): RealtimeHandshake {
  return {
    protocol: REALTIME_PROTOCOL_VERSION,
    capabilities: [...capabilities],
  };
}

export function parseHandshakeFrame(data: string): RealtimeHandshake | null {
  try {
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.protocol === "number" &&
      Array.isArray(parsed.capabilities)
    ) {
      return {
        protocol: parsed.protocol,
        capabilities: parsed.capabilities.filter(
          (c: unknown): c is string => typeof c === "string",
        ),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export function parseTokenFrame(data: string): RealtimeTokenFrame | null {
  try {
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.token === "string"
    ) {
      return {
        token: parsed.token,
        expiresAt:
          typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
      };
    }
  } catch {
    // fall through
  }
  return null;
}
