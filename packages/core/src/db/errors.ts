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

const SQLSTATE = /^(?:[0-5][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/;

function isTransientSqlState(code: string): boolean {
  return (
    code === "53300" ||
    code === "57014" ||
    /^08/.test(code) ||
    /^57P0[123]$/.test(code)
  );
}

function driverError(err: unknown): unknown {
  const wrapper = err as
    | { query?: unknown; params?: unknown; cause?: unknown }
    | null
    | undefined;
  return typeof wrapper?.query === "string" &&
    Array.isArray(wrapper.params) &&
    wrapper.cause != null
    ? wrapper.cause
    : err;
}

export function isConnectionError(value: unknown): boolean {
  const err = driverError(value) as
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
  if (code && SQLSTATE.test(code) && !isTransientSqlState(code)) return false;
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

const databaseErrors = new WeakSet<object>();

function hasDatabaseOrigin(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    databaseErrors.has(value)
  );
}

// Preserve frozen errors and their identity while carrying query origin through mixed callers.
export async function withDatabaseErrorProvenance<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (
      (typeof cause === "object" && cause !== null) ||
      typeof cause === "function"
    )
      databaseErrors.add(cause);
    throw cause;
  }
}

const DATABASE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ECONNABORTED",
]);

const CONNECT_REFUSAL_CODES = new Set([
  "57P03",
  "08001",
  "08004",
  "ECONNREFUSED",
  "EAI_AGAIN",
]);

/** For retry loops that wrap only database operations, so provenance is given. */
export function isRetryableConnectionError(err: unknown): boolean {
  if (isConnectionError(err)) return true;
  const error = driverError(err) as
    | { code?: unknown; cause?: { code?: unknown } }
    | null
    | undefined;
  return CONNECT_REFUSAL_CODES.has(
    String(error?.code ?? error?.cause?.code ?? ""),
  );
}

// Query boundaries can establish database origin when a transport error has no driver frames.
export function isTransientDatabaseError(
  err: unknown,
  context?: { source: "database" },
): boolean {
  const error = driverError(err) as
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
    isTransientSqlState(code)
  ) {
    return true;
  }
  if (SQLSTATE.test(code)) return false;

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
      error !== err ||
      hasDatabaseOrigin(err) ||
      hasDatabaseOrigin(error) ||
      hasDatabaseOrigin(error?.cause) ||
      /@neondatabase|\bpostgres(?:ql)?\b|\bpg-pool\b|drizzle-orm|\/db\/client\.[cm]?[jt]s/i.test(
        databaseSurface,
      ))
  );
}
