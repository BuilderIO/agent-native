const CONNECTION_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EMAXCONN",
  "53300",
  "CONNECT_TIMEOUT",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
]);

export function isConnectionError(value: unknown): boolean {
  const err = value as
    | {
        code?: string;
        name?: string;
        stack?: string;
        message?: string;
        cause?: {
          code?: string;
          name?: string;
          stack?: string;
          message?: string;
        };
      }
    | null
    | undefined;
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const name = err.name || err.cause?.name || "";
  if (name === "ErrorEvent") return true;
  const stack = String(err.stack || err.cause?.stack || "");
  if (
    /WebSocket\.#onSocketClose|failWebsocketConnection|onSocketClose/.test(
      stack,
    )
  ) {
    return true;
  }
  const msg = String(err.message || err.cause?.message || "");
  return /ECONNRESET|ETIMEDOUT|EPIPE|EMAXCONN|too many connections|max client connections|remaining connection slots|connection.*(closed|ended|terminated)|socket hang up|websocket/i.test(
    msg,
  );
}

const DATABASE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ECONNABORTED",
]);

// Query boundaries can establish database origin when a transport error has no driver frames.
export function isTransientDatabaseError(
  err: unknown,
  context?: { source: "database" },
): boolean {
  const error = err as
    | {
        code?: unknown;
        name?: unknown;
        message?: unknown;
        stack?: unknown;
        cause?: {
          code?: unknown;
          name?: unknown;
          message?: unknown;
          stack?: unknown;
        };
      }
    | null
    | undefined;
  const code = String(error?.code ?? error?.cause?.code ?? "");
  if (
    code === "ECHECKOUTTIMEOUT" ||
    code === "DB_CONNECT_COOLDOWN" ||
    code === "EMAXCONN" ||
    code === "53300" ||
    code === "57014" ||
    /^08/.test(code) ||
    /^57P0[123]$/.test(code)
  ) {
    return true;
  }

  const message = [error?.message, error?.cause?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (
    /\bstatement timeout\b|\bdb (?:query|connect) timed out\b/i.test(message)
  ) {
    return true;
  }

  const databaseSurface = [
    error?.name,
    error?.cause?.name,
    error?.stack,
    error?.cause?.stack,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    (isConnectionError(error) || DATABASE_NETWORK_ERROR_CODES.has(code)) &&
    (context?.source === "database" ||
      /@neondatabase|\bpostgres(?:ql)?\b|\bpg-pool\b|drizzle-orm|\/db\/client\.[cm]?[jt]s/i.test(
        databaseSurface,
      ))
  );
}
