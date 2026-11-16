import { randomUUID } from "node:crypto";

export type BuilderGatewayStep = "signed_url" | "session_start" | "complete";

export interface BuilderGatewayErrorDetails {
  step: BuilderGatewayStep;
  /** HTTP status of the last attempt; 0 when no response arrived. */
  status: number;
  attempts: number;
  /** The last response was an HTML error page, not the gateway's JSON. */
  isHtml: boolean;
  /** One id per attempt sent to Builder; search the upload function's logs by it. */
  traceIds: string[];
  /** Allow-listed response headers of the last failed attempt. */
  headers: Record<string, string>;
  cause?: unknown;
}

export class BuilderGatewayError extends Error {
  readonly provider = "builder";
  readonly step: BuilderGatewayStep;
  readonly status: number;
  readonly attempts: number;
  readonly isHtml: boolean;
  readonly traceIds: string[];
  readonly headers: Record<string, string>;

  constructor(message: string, details: BuilderGatewayErrorDetails) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "BuilderGatewayError";
    this.step = details.step;
    this.status = details.status;
    this.attempts = details.attempts;
    this.isHtml = details.isHtml;
    this.traceIds = details.traceIds;
    this.headers = details.headers;
  }
}

interface GatewayStepPolicy {
  label: string;
  attempts: number;
  /** Wait before the second attempt; each later wait is `BACKOFF_FACTOR` times longer. */
  baseDelayMs: number;
  timeoutMs: number;
  retryStatuses: ReadonlySet<number>;
  retryOnTimeout: boolean;
  /** Send a trace id the upload function records in its own logs. */
  traced: boolean;
}

const BACKOFF_FACTOR = 3;

// The signed-URL and session-start requests are tiny and answer in well under
// a second, so their 15 s cap lets every attempt fit inside one serverless
// request; a slow answer is retried instead of waited on.
const GATEWAY_POLICIES: Record<BuilderGatewayStep, GatewayStepPolicy> = {
  signed_url: {
    label: "Builder.io signed-URL request failed",
    attempts: 3,
    baseDelayMs: 500,
    timeoutMs: 15_000,
    retryStatuses: new Set([502, 503, 504]),
    retryOnTimeout: true,
    traced: true,
  },
  session_start: {
    label: "GCS resumable session initiation failed",
    attempts: 3,
    baseDelayMs: 500,
    timeoutMs: 15_000,
    retryStatuses: new Set([408, 429, 500, 502, 503, 504]),
    retryOnTimeout: true,
    traced: false,
  },
  // Completing a stable video can include server-side compression, so this
  // keeps the long timeout and never retries after our own timeout: that retry
  // would race the first attempt. A 409 is that race from elsewhere (a
  // duplicate in flight); the next call returns the registered asset.
  complete: {
    label: "Builder.io upload complete failed",
    attempts: 4,
    baseDelayMs: 500,
    timeoutMs: 120_000,
    retryStatuses: new Set([409, 502, 503, 504]),
    retryOnTimeout: false,
    traced: true,
  },
};

// Response headers that say which layer answered; never request headers,
// which carry the Authorization token.
const DIAGNOSTIC_RESPONSE_HEADERS = [
  "server",
  "via",
  "x-served-by",
  "x-cache",
  "x-cloud-trace-context",
  "x-amz-cf-id",
  "x-amz-cf-pop",
  "cf-ray",
  "retry-after",
  "content-type",
  "date",
] as const;

function snapshotResponseHeaders(headers: Headers): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const name of DIAGNOSTIC_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value) snapshot[name] = value;
  }
  return snapshot;
}

/** Summarize a failed response without keeping a whole HTML error page. */
export async function describeErrorBody(
  res: Response,
): Promise<{ detail: string; isHtml: boolean }> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return {
      detail: `${res.statusText || "no status text"} (response body unreadable)`,
      isHtml: false,
    };
  }
  const isHtml =
    /text\/html/i.test(res.headers.get("content-type") ?? "") ||
    /^\s*<(?:!doctype\s+html|html)\b/i.test(raw);
  if (isHtml) {
    return { detail: "HTML error page returned instead of JSON", isHtml: true };
  }
  const text = raw.trim();
  return { detail: text ? text.slice(0, 500) : res.statusText, isHtml: false };
}

type GatewayAttempt =
  | { kind: "response"; response: Response }
  | { kind: "network"; error: unknown; timedOut: boolean };

async function sendOnce(
  url: string,
  init: GatewayRequestInit,
  policy: GatewayStepPolicy,
  traceId: string | null,
): Promise<GatewayAttempt> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, policy.timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: traceId
        ? { ...init.headers, "X-Cloud-Trace-Context": `${traceId}/1;o=1` }
        : init.headers,
      signal: controller.signal,
    });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "network", error, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export interface GatewayRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

/**
 * One bounded, observable call to the Builder upload gateway or the storage
 * session it hands out. Retries only failures that say "try again": no
 * response, a gateway 5xx, and the step's own extra statuses. Resolves with
 * the OK response; rejects with `BuilderGatewayError` once the attempts run
 * out or the failure is not retryable.
 */
export async function builderGatewayRequest(
  step: BuilderGatewayStep,
  url: string,
  init: GatewayRequestInit,
): Promise<Response> {
  const policy = GATEWAY_POLICIES[step];
  const traceIds: string[] = [];

  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    const traceId = policy.traced ? randomUUID().replaceAll("-", "") : null;
    if (traceId) traceIds.push(traceId);

    const result = await sendOnce(url, init, policy, traceId);
    const elapsedMs = Date.now() - startedAt;

    if (result.kind === "response" && result.response.ok) {
      if (attempt > 1) {
        console.log(
          `[builder-upload] ${step} recovered on attempt ${attempt}/${policy.attempts}`,
          { elapsedMs, traceId },
        );
      }
      return result.response;
    }

    let status = 0;
    let isHtml = false;
    let detail: string;
    let headers: Record<string, string> = {};
    let retryable: boolean;
    if (result.kind === "response") {
      status = result.response.status;
      headers = snapshotResponseHeaders(result.response.headers);
      ({ detail, isHtml } = await describeErrorBody(result.response));
      retryable = policy.retryStatuses.has(status);
    } else {
      detail = result.timedOut
        ? `timed out after ${policy.timeoutMs} ms`
        : result.error instanceof Error
          ? result.error.message
          : String(result.error);
      retryable = result.timedOut ? policy.retryOnTimeout : true;
    }

    const willRetry = retryable && attempt < policy.attempts;
    console.warn(
      `[builder-upload] ${step} attempt ${attempt}/${policy.attempts} failed${willRetry ? ", retrying" : ""}`,
      { status: status || "no response", elapsedMs, traceId, headers },
    );
    if (!willRetry) {
      throw new BuilderGatewayError(
        `${policy.label} (${status || "no response"}): ${detail}`,
        {
          step,
          status,
          attempts: attempt,
          isHtml,
          traceIds,
          headers,
          cause: result.kind === "network" ? result.error : undefined,
        },
      );
    }
    // Jitter keeps a burst of retrying recordings from landing together.
    const delayMs = policy.baseDelayMs * BACKOFF_FACTOR ** (attempt - 1);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.round(delayMs * (0.75 + Math.random() * 0.5))),
    );
  }
}
