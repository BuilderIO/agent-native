export const REALTIME_PROTOCOL_VERSION = 1;

export const REALTIME_SSE_HANDSHAKE_EVENT = "handshake";
export const REALTIME_SSE_TOKEN_EVENT = "token";

export const REALTIME_CAP_NO_AWARENESS = "no-awareness";

export const REALTIME_CAP_POLL_LIVE = "poll-live";

export const REALTIME_POLL_LIVE_QUERY_PARAM = "poll_live";

export interface RealtimeHandshake {
  protocol: number;
  capabilities: string[];
}

export interface RealtimeTokenFrame {
  token: string;
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
