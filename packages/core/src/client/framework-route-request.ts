export type FrameworkRouteFailureKind = "network" | "http" | "malformed";

/**
 * A framework route that could not answer. `kind` separates an unreachable
 * server, a non-2xx response, and a 2xx body that is not the route's contract,
 * so a failed read can never be mistaken for an empty one.
 */
export class FrameworkRouteError extends Error {
  readonly route: string;
  readonly kind: FrameworkRouteFailureKind;
  readonly status: number | null;
  /** The server's own `error` text, when the response carried one. */
  readonly serverMessage: string | null;
  /** The server's machine-readable `errorCode`, when the response carried one. */
  readonly errorCode: string | null;

  constructor(input: {
    route: string;
    kind: FrameworkRouteFailureKind;
    message: string;
    status?: number | null;
    serverMessage?: string | null;
    errorCode?: string | null;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FrameworkRouteError";
    this.route = input.route;
    this.kind = input.kind;
    this.status = input.status ?? null;
    this.serverMessage = input.serverMessage ?? null;
    this.errorCode = input.errorCode ?? null;
  }
}

export function isFrameworkRouteError(
  value: unknown,
): value is FrameworkRouteError {
  return value instanceof FrameworkRouteError;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function malformedFrameworkRouteResponse(
  route: string,
  status: number,
  detail: string,
): FrameworkRouteError {
  return new FrameworkRouteError({
    route,
    kind: "malformed",
    status,
    message: `${route} returned an unexpected response: ${detail}.`,
  });
}

/**
 * Fetch a framework route and return its parsed 2xx JSON body. Aborts rethrow
 * unchanged so callers can drop them; every other failure is a
 * `FrameworkRouteError`.
 */
export async function requestFrameworkRouteJson(
  route: string,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new FrameworkRouteError({
      route,
      kind: "network",
      message: `Could not reach ${route}.`,
      cause: error,
    });
  }

  let body: unknown;
  let parsed = false;
  if (text) {
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch (error) {
      if (response.ok) {
        throw new FrameworkRouteError({
          route,
          kind: "malformed",
          status: response.status,
          message: `${route} returned a body that is not JSON.`,
          cause: error,
        });
      }
    }
  }

  if (!response.ok) {
    const serverMessage =
      parsed && isRecord(body) && typeof body.error === "string" && body.error
        ? body.error
        : null;
    const errorCode =
      parsed && isRecord(body) && typeof body.errorCode === "string"
        ? body.errorCode
        : null;
    throw new FrameworkRouteError({
      route,
      kind: "http",
      status: response.status,
      serverMessage,
      errorCode,
      message: serverMessage ?? `${route} failed (HTTP ${response.status}).`,
    });
  }
  if (!parsed) {
    throw malformedFrameworkRouteResponse(route, response.status, "empty body");
  }
  return { status: response.status, body };
}
