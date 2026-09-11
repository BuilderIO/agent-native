/**
 * Provider-agnostic drop rules for server error reporting.
 *
 * These rules were tuned against real production volume while Sentry was the
 * only backend, and they lived inside its `beforeSend`. They are not Sentry
 * policy — they describe which server errors are non-bugs in *this* framework
 * (expected 4xx, access-control rejections, Lambda freeze/thaw socket noise).
 * Any second backend that skips them receives a firehose rather than a signal:
 * the `socket hang up` rule alone accounts for ~10k events/day.
 *
 * The rules operate on a normalized signal so the same predicate can judge a
 * Sentry `Event` (already parsed by the SDK) and a raw `Error` reaching the
 * PostHog provider. Fields a given source cannot supply stay `undefined`, and
 * every rule requires the evidence it depends on — an unknown never reads as
 * a match.
 */

import { parseStackFrames } from "../tracking/posthog-exception.js";

export interface ErrorSignalFrame {
  function?: string;
  filename?: string;
  in_app?: boolean;
}

export interface NormalizedErrorSignal {
  /** Error class name, e.g. `ValidationError`. */
  type?: string;
  /** Error message. */
  value?: string;
  /** Capture mechanism, e.g. `onunhandledrejection`. */
  mechanismType?: string;
  frames?: ErrorSignalFrame[];
  /** HTTP status carried by h3's `HTTPError` / `H3Error`. */
  statusCode?: number;
  tags?: Record<string, string | undefined>;
  /**
   * Sentry-only: some SDK-internal rejections arrive with no `exception.values`
   * at all and only a `metadata` blob. Left `undefined` elsewhere.
   */
  metadataValue?: string;
  metadataFilename?: string;
  hasExceptionValues?: boolean;
}

function isUnhandledRejection(signal: NormalizedErrorSignal): boolean {
  return (
    typeof signal.mechanismType === "string" &&
    signal.mechanismType.endsWith("onunhandledrejection")
  );
}

/** Expected user-input rejections. The framework and CLI both throw these. */
function isValidationNoise(signal: NormalizedErrorSignal): boolean {
  return (
    signal.type === "ValidationError" || signal.tags?.handled === "validation"
  );
}

/**
 * Access-control rejections. These are 4xx user-facing errors that reached the
 * error hook because a route forgot to catch them — fixing the route is the
 * right answer, but until then they bury real bugs. Auth routes report their
 * own failures at `warning` level, so this only sees the escape path.
 */
function isAccessControlNoise(signal: NormalizedErrorSignal): boolean {
  return (
    signal.type === "ForbiddenError" || signal.type === "UnauthorizedError"
  );
}

/**
 * `socket hang up` unhandled rejections from Lambda freeze cycles. AWS recycles
 * long-lived sockets (MCP Streamable HTTP long-polls, keep-alive agents) ~60s
 * after a function returns 200; the next thaw delivers a socket-end event whose
 * Promise has nobody left to await it. The function already returned correctly,
 * so there is no user impact. The narrow frame match keeps genuine
 * application-thrown socket errors visible.
 */
function isLambdaSocketHangUpNoise(signal: NormalizedErrorSignal): boolean {
  if (signal.value !== "socket hang up" || !isUnhandledRejection(signal)) {
    return false;
  }
  return (signal.frames ?? []).some(
    (frame) =>
      frame?.function === "Socket.socketOnEnd" ||
      frame?.filename === "node:_http_client",
  );
}

/**
 * SDK-only `ErrorEvent` promise rejections — typically the Neon serverless
 * driver's WebSocket dying across a freeze/thaw and rejecting a floating
 * promise with the raw ErrorEvent (`db/client.ts` already records these with
 * context). Events with real application frames stay visible.
 *
 * "Application frame" must exclude the Sentry SDK's own bundled chunks:
 * serverless bundles place them under the app root (e.g.
 * `/var/task/_libs/@sentry/node+….mjs`), outside node_modules, so the SDK marks
 * them `in_app` and the instrumentation stack alone would defeat this filter.
 */
function isSdkErrorEventNoise(signal: NormalizedErrorSignal): boolean {
  if (signal.value === "[object ErrorEvent]" && isUnhandledRejection(signal)) {
    const frames = signal.frames ?? [];
    const hasApplicationFrame = frames.some(
      (frame) =>
        frame?.in_app && !String(frame?.filename ?? "").includes("sentry"),
    );
    const hasSentryFrame = frames.some((frame) =>
      String(frame?.filename ?? "").includes("sentry"),
    );
    if (!hasApplicationFrame && hasSentryFrame) return true;
  }

  return (
    signal.metadataValue === "[object ErrorEvent]" &&
    signal.hasExceptionValues === false &&
    String(signal.metadataFilename ?? "").includes("sentry")
  );
}

/**
 * h3's `createError({ statusCode: 4xx })` produces an `HTTPError` (h3 v2) /
 * `H3Error` (h3 v1). 4xx ones are handler-controlled "expected failure"
 * responses that route through the error hook only because they bubble out of
 * `defineEventHandler`. Capture when the status looks 5xx, or is missing on a
 * generic Error masquerading as an HTTPError.
 */
function isExpectedHttpNoise(signal: NormalizedErrorSignal): boolean {
  if (signal.type !== "HTTPError" && signal.type !== "H3Error") return false;

  const code = signal.statusCode;
  if (typeof code === "number" && Number.isFinite(code)) {
    return code >= 400 && code < 500;
  }

  // No status in the payload — match the common 4xx messages so handler-thrown
  // 404/400/403/401 don't pollute the backend. A heuristic, but the
  // alternatives (every 4xx becomes a real issue, or every route grows a
  // catch+return) are worse.
  const value = signal.value ?? "";
  return (
    /^Cannot find any route matching/i.test(value) ||
    / not found$/i.test(value) ||
    /Unauthenticated$/i.test(value) ||
    /^Unauthorized$/i.test(value) ||
    /^No access to /i.test(value)
  );
}

/**
 * `false` when the error is known non-bug noise and should not be reported.
 *
 * Deliberately fails open: anything the rules cannot positively identify as
 * noise is reported. A dropped real error is invisible; a kept noisy one is
 * merely loud.
 */
export function shouldReportErrorSignal(
  signal: NormalizedErrorSignal,
): boolean {
  return !(
    isValidationNoise(signal) ||
    isAccessControlNoise(signal) ||
    isLambdaSocketHangUpNoise(signal) ||
    isSdkErrorEventNoise(signal) ||
    isExpectedHttpNoise(signal)
  );
}

interface SentryLikeEvent {
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      mechanism?: { type?: string };
      stacktrace?: { frames?: ErrorSignalFrame[] };
    }>;
  };
  tags?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  metadata?: { value?: unknown; filename?: unknown };
}

function toNumericStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Normalize a Sentry event. Typed structurally so this module stays SDK-free. */
export function errorSignalFromSentryEvent(
  event: SentryLikeEvent,
): NormalizedErrorSignal {
  const first = event.exception?.values?.[0];
  const tags: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(event.tags ?? {})) {
    if (typeof value === "string") tags[key] = value;
  }

  return {
    type: first?.type,
    value: first?.value ?? "",
    mechanismType: first?.mechanism?.type,
    frames: first?.stacktrace?.frames ?? [],
    statusCode: toNumericStatus(
      event.tags?.statusCode ?? event.contexts?.h3?.statusCode,
    ),
    tags,
    metadataValue:
      typeof event.metadata?.value === "string"
        ? event.metadata.value
        : undefined,
    metadataFilename:
      typeof event.metadata?.filename === "string"
        ? event.metadata.filename
        : undefined,
    hasExceptionValues: Boolean(event.exception?.values?.length),
  };
}

export interface ErrorSignalFromErrorOptions {
  mechanismType?: string;
  tags?: Record<string, string | undefined>;
}

/** Normalize a raw thrown value for backends that never see a Sentry event. */
export function errorSignalFromError(
  error: unknown,
  options: ErrorSignalFromErrorOptions = {},
): NormalizedErrorSignal {
  if (!(error instanceof Error)) {
    return {
      type: "Error",
      value: typeof error === "string" ? error : String(error ?? ""),
      mechanismType: options.mechanismType,
      tags: options.tags,
      hasExceptionValues: true,
    };
  }

  const withStatus = error as Error & {
    statusCode?: unknown;
    status?: unknown;
  };

  return {
    type: error.name || "Error",
    value: error.message ?? "",
    mechanismType: options.mechanismType,
    frames: parseStackFrames(error.stack),
    statusCode:
      toNumericStatus(withStatus.statusCode) ??
      toNumericStatus(withStatus.status),
    tags: options.tags,
    hasExceptionValues: true,
  };
}

/** Convenience wrapper for the raw-error path. */
export function shouldReportError(
  error: unknown,
  options: ErrorSignalFromErrorOptions = {},
): boolean {
  return shouldReportErrorSignal(errorSignalFromError(error, options));
}
