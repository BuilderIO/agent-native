import {
  classifyErrorNoise,
  type ErrorNoiseVerdict,
} from "../shared/error-noise.js";
import { parseStackFrames } from "../tracking/posthog-exception.js";

export interface ErrorSignalFrame {
  function?: string;
  filename?: string;
  in_app?: boolean;
}

export interface NormalizedErrorSignal {
  type?: string;
  value?: string;
  stack?: string;
  mechanismType?: string;
  frames?: ErrorSignalFrame[];
  statusCode?: number;
  tags?: Record<string, string | undefined>;
  metadataValue?: string;
  metadataFilename?: string;
  hasExceptionValues?: boolean;
}

export function classifyErrorSignal(
  signal: NormalizedErrorSignal,
): ErrorNoiseVerdict {
  return classifyErrorNoise({ surface: "server", ...signal });
}

export function shouldReportErrorSignal(
  signal: NormalizedErrorSignal,
): boolean {
  return !classifyErrorSignal(signal).drop;
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
    stack: typeof error.stack === "string" ? error.stack : undefined,
    mechanismType: options.mechanismType,
    frames: parseStackFrames(error.stack),
    statusCode:
      toNumericStatus(withStatus.statusCode) ??
      toNumericStatus(withStatus.status),
    tags: options.tags,
    hasExceptionValues: true,
  };
}

export function classifyError(
  error: unknown,
  options: ErrorSignalFromErrorOptions = {},
): ErrorNoiseVerdict {
  return classifyErrorSignal(errorSignalFromError(error, options));
}

export function shouldReportError(
  error: unknown,
  options: ErrorSignalFromErrorOptions = {},
): boolean {
  return !classifyError(error, options).drop;
}
