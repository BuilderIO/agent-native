
import { parseStackFrames } from "../tracking/posthog-exception.js";

export interface ErrorSignalFrame {
  function?: string;
  filename?: string;
  in_app?: boolean;
}

export interface NormalizedErrorSignal {
  type?: string;
  value?: string;
  mechanismType?: string;
  frames?: ErrorSignalFrame[];
  statusCode?: number;
  tags?: Record<string, string | undefined>;
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

function isValidationNoise(signal: NormalizedErrorSignal): boolean {
  return (
    signal.type === "ValidationError" || signal.tags?.handled === "validation"
  );
}

function isAccessControlNoise(signal: NormalizedErrorSignal): boolean {
  return (
    signal.type === "ForbiddenError" || signal.type === "UnauthorizedError"
  );
}

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

function isExpectedHttpNoise(signal: NormalizedErrorSignal): boolean {
  if (signal.type !== "HTTPError" && signal.type !== "H3Error") return false;

  const code = signal.statusCode;
  if (typeof code === "number" && Number.isFinite(code)) {
    return code >= 400 && code < 500;
  }

  const value = signal.value ?? "";
  return (
    /^Cannot find any route matching/i.test(value) ||
    / not found$/i.test(value) ||
    /Unauthenticated$/i.test(value) ||
    /^Unauthorized$/i.test(value) ||
    /^No access to /i.test(value)
  );
}

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

export function shouldReportError(
  error: unknown,
  options: ErrorSignalFromErrorOptions = {},
): boolean {
  return shouldReportErrorSignal(errorSignalFromError(error, options));
}
