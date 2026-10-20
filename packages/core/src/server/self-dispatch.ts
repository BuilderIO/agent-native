import { getAppConfig } from "../app-config/index.js";
import { isLocalDatabase } from "../db/client.js";
import { signInternalToken } from "../integrations/internal-token.js";
import { parseRetryAfterMs } from "../shared/retry-after.js";
import {
  SYNTHETIC_TRAFFIC_BETA_E2E,
  SYNTHETIC_TRAFFIC_HEADER,
} from "../shared/test-traffic.js";
import {
  getConfiguredAppBasePath,
  withConfiguredAppBasePath,
} from "./app-base-path.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";
import { getRequestContext } from "./request-context.js";

export const DEFAULT_DISPATCH_SETTLE_MS = 250;

function readHeader(event: any, name: string): string | undefined {
  try {
    const headers = event?.node?.req?.headers ?? event?.headers;
    if (!headers) return undefined;
    if (typeof headers.get === "function") {
      return headers.get(name) ?? undefined;
    }
    const map = headers as Record<string, string | undefined>;
    return map[name] ?? map[String(name).toLowerCase()];
  } catch {
    return undefined;
  }
}

export function resolveSelfDispatchBaseUrl(event?: any): string {
  // A deployment that names where its own processor lives wins outright.
  // Reaching itself through its public hostname means a round trip through the
  // provider's edge, which was measured answering 404 to that hairpin for a
  // deployment's whole life while serving every external request. Loopback
  // (`http://127.0.0.1:${PORT}`) needs no edge.
  // config-ok: read raw, like the platform deploy URLs below — it names where
  // this process answers, which a checked-in app config cannot know (see the
  // `app.url` docblock).
  const declared = process.env.AGENT_NATIVE_SELF_DISPATCH_URL?.trim();
  if (declared) {
    const parsed = URL.canParse(declared) ? new URL(declared) : null;
    if (parsed?.protocol !== "http:" && parsed?.protocol !== "https:") {
      throw new Error(
        `AGENT_NATIVE_SELF_DISPATCH_URL must be an absolute http(s) URL, got "${declared}".`,
      );
    }
    return withConfiguredAppBasePath(declared);
  }
  return resolveDeploymentBaseUrl(event);
}

/**
 * Resolve this deployment's own address. Prefer the URL for this exact deploy
 * before stable app URLs: a preview or in-flight deploy must not send a token
 * minted by its function fleet to a different deploy that happens to serve the
 * same public hostname. Fall back to the inbound request headers, then the
 * origin the current request was served on, and finally localhost in dev.
 *
 * Throws in production / shared deployments when no env var is set — a silent
 * fallback to a bad host there would drop background work invisibly.
 */
export function resolveDeploymentBaseUrl(event?: any): string {
  const fromEnv =
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    process.env.URL ||
    getAppConfig().app.url;
  if (fromEnv) return withConfiguredAppBasePath(String(fromEnv));

  if (process.env.NODE_ENV === "production" || !isLocalDatabase()) {
    throw new Error(
      "Self-dispatch requires DEPLOY_PRIME_URL, DEPLOY_URL, URL, APP_URL, or " +
        "BETTER_AUTH_URL in " +
        "production/shared deployments so background work can reach this " +
        "deployment's own URL.",
    );
  }

  const inboundHost = readHeader(event, "host");
  // An agent turn or a CLI call forwarded to the dev server has no inbound
  // event, but its request context remembers where this server was reached.
  // Without it the guess below is port 3000, which is not where Vite serves.
  const contextOrigin = inboundHost
    ? undefined
    : getRequestContext()?.requestOrigin;
  if (contextOrigin) return withConfiguredAppBasePath(contextOrigin);

  const host = inboundHost || `localhost:${process.env.PORT || 3000}`;
  const hostName = (
    host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0]
  ).toLowerCase();
  const isLoopback =
    hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1";
  const proto = isLoopback
    ? "http"
    : readHeader(event, "x-forwarded-proto") || "http";
  return withConfiguredAppBasePath(`${proto}://${host}`);
}

export interface FireInternalDispatchOptions {
  baseUrl?: string;
  event?: any;
  path: string;
  taskId: string;
  body?: Record<string, unknown>;
  settleMs?: number;
  /**
   * Await the dispatch response fully instead of racing the settle timer.
   *
   * The 250ms settle race is correct for a synchronous handler that must
   * respond to its own caller quickly — but it is WRONG for a handoff fired
   * from a function that is about to finish (e.g. a background worker chaining
   * its continuation chunk): once the handler's promise resolves, the Lambda
   * freezes and a still-in-flight dispatch fetch is killed WITHOUT rejecting,
   * so the handoff is lost silently — the error path never fires. With
   * `awaitResponse: true` the call resolves only after the target confirmed
   * receipt (Netlify background functions 202 on enqueue, normally well under
   * a second) and throws on any network error or non-2xx, bounded by
   * `responseTimeoutMs`.
   */
  awaitResponse?: boolean;
  responseTimeoutMs?: number;
}

/**
 * A non-2xx answer from the dispatch target. Callers decide whether to back
 * off from `httpStatus` and `retryAfterMs` instead of parsing the message.
 */
export class SelfDispatchHttpError extends Error {
  readonly httpStatus: number;
  readonly retryAfterMs?: number;
  /** Origin the request went to; never a path, query, or credentials. */
  readonly target?: string;
  constructor(
    message: string,
    httpStatus: number,
    retryAfterMs?: number,
    target?: string,
  ) {
    super(message);
    this.name = "SelfDispatchHttpError";
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
    this.target = target;
  }
}

/**
 * A dispatch that never got an HTTP answer: the connection was refused, DNS
 * failed, or the response timer ran out. `fetch` reports all of these as an
 * opaque `fetch failed` with the real code one `cause` down, so this names
 * where the request went (`target`, an origin) and why (`causeCode`, such as
 * `ECONNREFUSED`, `ENOTFOUND` or `TimeoutError`).
 */
export class SelfDispatchNetworkError extends Error {
  readonly target: string;
  readonly causeCode?: string;
  constructor(path: string, target: string, cause: unknown) {
    const causeCode = networkCauseCode(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Self-dispatch to ${path} at ${target} failed: ${detail}${causeCode ? ` (${causeCode})` : ""}`,
      { cause },
    );
    this.name = "SelfDispatchNetworkError";
    this.target = target;
    this.causeCode = causeCode;
  }
}

function networkCauseCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const nested = (error as { cause?: unknown }).cause as
    | { code?: unknown; errors?: Array<{ code?: unknown }> }
    | undefined;
  // A dual-stack `localhost` refusal arrives as an AggregateError.
  const code = nested?.code ?? nested?.errors?.[0]?.code;
  if (typeof code === "string") return code;
  return error.name === "TimeoutError" || error.name === "AbortError"
    ? error.name
    : undefined;
}

async function dispatchResponseError(
  path: string,
  res: Response,
  target: string,
): Promise<SelfDispatchHttpError> {
  let body = "";
  try {
    body = (await res.text()).trim();
  } catch {
    body = "";
  }
  const detail = body ? `: ${body.slice(0, 300)}` : "";
  const retryAfter = res.headers?.get("retry-after");
  const retryAfterMs = retryAfter
    ? parseRetryAfterMs({ "retry-after": retryAfter })
    : null;
  return new SelfDispatchHttpError(
    `Self-dispatch to ${path} returned HTTP ${res.status} ${res.statusText}${detail}`,
    res.status,
    retryAfterMs ?? undefined,
    target,
  );
}

/**
 * Fire a fresh, HMAC-signed POST to a processor route on this same deployment.
 * Fire-and-forget: the dispatch is NOT awaited to completion (the processed run
 * may take minutes); it is only raced against a short settle timer so the
 * request reliably leaves a serverless box before it freezes.
 *
 * Dispatches require an HMAC signature before sending an unauthenticated request.
 * Local PGlite development may use the trusted loopback path when no secret is set.
 */
/**
 * For host-root dispatch targets (`/.netlify/functions/*`), strip the configured
 * app base path suffix from the resolved base url so the request reaches the
 * function at the host root rather than under the workspace app base path. For
 * every other (framework-route) path the base-path-prefixed base url is returned
 * unchanged, preserving the existing self-dispatch behavior.
 */
function rootBaseUrlForPath(baseUrl: string, path: string): string {
  if (!path.startsWith("/.netlify/")) return baseUrl;
  const basePath = getConfiguredAppBasePath();
  if (!basePath) return baseUrl;
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith(basePath)) {
    return trimmed.slice(0, trimmed.length - basePath.length);
  }
  return trimmed;
}

export async function fireInternalDispatch(
  options: FireInternalDispatchOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? resolveSelfDispatchBaseUrl(options.event);
  const url = `${rootBaseUrlForPath(baseUrl, options.path)}${publicFrameworkPath(options.path)}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (getRequestContext()?.isSyntheticTraffic === true) {
    headers[SYNTHETIC_TRAFFIC_HEADER] = SYNTHETIC_TRAFFIC_BETA_E2E;
  }
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(options.taskId)}`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (
      process.env.NODE_ENV !== "production" &&
      isLocalDatabase() &&
      /A2A_SECRET/i.test(detail)
    ) {
      // The processor applies the matching trusted-local policy.
    } else {
      throw new Error(
        `[self-dispatch] Cannot sign processor handoff for ${options.taskId}: ${detail}`,
        { cause: err },
      );
    }
  }

  const awaitResponse = options.awaitResponse === true;
  const target = URL.canParse(url) ? new URL(url).origin : "an unparseable URL";
  const dispatchPromise = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId: options.taskId, ...(options.body ?? {}) }),
    ...(awaitResponse
      ? { signal: AbortSignal.timeout(options.responseTimeoutMs ?? 15_000) }
      : {}),
  })
    .then(async (res) => {
      if (!res.ok) {
        throw await dispatchResponseError(options.path, res, target);
      }
    })
    .catch((err: unknown) => {
      throw err instanceof SelfDispatchHttpError
        ? err
        : new SelfDispatchNetworkError(options.path, target, err);
    });
  dispatchPromise.catch((err) => {
    console.error(
      `[self-dispatch] dispatch to ${options.path} (base ${baseUrl}) failed:`,
      err,
    );
  });

  if (awaitResponse) {
    await dispatchPromise;
    return;
  }

  const settleMs = options.settleMs ?? DEFAULT_DISPATCH_SETTLE_MS;
  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) => setTimeout(resolve, settleMs)),
  ]);
}
