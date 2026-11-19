import type {
  ErrorEvent,
  EventHint,
  Exception,
  StackFrame,
} from "@sentry/node";

import {
  loadOptionalPeer,
  OptionalPeerDependencyError,
} from "../shared/optional-peer.js";
import { telemetryCommandName } from "./telemetry-routing.js";
import {
  CLI_EXCEPTION_EXTRA,
  CLI_EXCEPTION_TAGS,
  errorCode,
  errorHint,
  errorType,
  ownFilePath,
  ownFrameFunction,
  ownStack,
  pickSafeFields,
  safeErrorName,
} from "./telemetry-sanitize.js";
import {
  cliTelemetryMode,
  printTelemetryDebug,
  printTelemetryNoticeOnce,
} from "./telemetry-settings.js";

type SentryModule = typeof import("@sentry/node");
export type SentryCaptureContext = Parameters<
  SentryModule["captureException"]
>[1];

let sentryPromise: Promise<SentryModule | undefined> | undefined;
let reporting = Promise.resolve();
let diagnosticPrinted = false;
let cliVersion = "unknown";

export function setCliSentryVersion(version: string): void {
  cliVersion = version;
}

type ErrorOutput = Pick<NodeJS.WriteStream, "write">;

function reportUnavailable(error: unknown, stderr: ErrorOutput): void {
  if (diagnosticPrinted) return;
  diagnosticPrinted = true;
  const message =
    error instanceof OptionalPeerDependencyError
      ? error.message
      : `CLI error reporting is unavailable: ${error instanceof Error ? error.message : String(error)}`;
  stderr.write(`${message}\n`);
}

function ownFrames(frames: StackFrame[] | undefined): StackFrame[] {
  const kept: StackFrame[] = [];
  for (const frame of frames ?? []) {
    const filename = ownFilePath(frame.filename);
    if (!filename) continue;
    const own: StackFrame = { filename, in_app: true };
    const name = ownFrameFunction(frame.function);
    if (name) own.function = name;
    if (frame.lineno !== undefined) own.lineno = frame.lineno;
    if (frame.colno !== undefined) own.colno = frame.colno;
    kept.push(own);
  }
  return kept;
}

function safeException(value: Exception, original: unknown): Exception {
  const type = safeErrorName(value.type);
  const safe: Exception = {
    type,
    value: errorHint(original ?? value.value) || type,
    stacktrace: { frames: ownFrames(value.stacktrace?.frames) },
  };
  if (value.mechanism) {
    safe.mechanism = { type: value.mechanism.type };
    if (value.mechanism.handled !== undefined) {
      safe.mechanism.handled = value.mechanism.handled;
    }
  }
  return safe;
}

// Fixed, because the SDK would otherwise read SENTRY_ENVIRONMENT, which can hold
// a path or a project name.
const SENTRY_ENVIRONMENT = "production";

/**
 * Builds the report from nothing rather than deleting from what the SDK made,
 * so a field a later SDK adds (a hostname, source lines, a dependency list)
 * stays home by default.
 */
export function sanitizeSentryEvent(
  event: ErrorEvent,
  hint?: EventHint,
): ErrorEvent {
  const original = hint?.originalException;
  const code = errorCode(original);
  const safe: ErrorEvent = {
    type: undefined,
    environment: SENTRY_ENVIRONMENT,
    exception: {
      values: (event.exception?.values ?? []).map((value) =>
        safeException(value, original),
      ),
    },
    tags: {
      ...pickSafeFields(event.tags, CLI_EXCEPTION_TAGS),
      ...(code ? { code } : {}),
      command: telemetryCommandName(process.argv[2]),
      nodeVersion: process.version,
      platform: process.platform,
    },
    extra: pickSafeFields(event.extra, CLI_EXCEPTION_EXTRA),
  };
  if (event.fingerprint?.every((part) => typeof part === "string")) {
    safe.fingerprint = event.fingerprint;
  }
  if (event.event_id) safe.event_id = event.event_id;
  if (event.timestamp) safe.timestamp = event.timestamp;
  if (event.platform) safe.platform = event.platform;
  if (event.level) safe.level = event.level;
  if (event.release) safe.release = event.release;
  if (event.sdk) safe.sdk = event.sdk;
  return safe;
}

function loadSentry(stderr: ErrorOutput): Promise<SentryModule | undefined> {
  if (!sentryPromise) {
    sentryPromise = loadOptionalPeer(
      "@sentry/node",
      () => import("@sentry/node"),
    )
      .then((sentry) => {
        sentry.init({
          dsn: "https://0d384e9eff2f6542af468b92769f2f5b@o117565.ingest.us.sentry.io/4511270386466816",
          release: `agent-native-cli@${cliVersion}`,
          environment: SENTRY_ENVIRONMENT,
          // The defaults read hostnames, source lines around each frame, console
          // output and the project's dependency list.
          defaultIntegrations: false,
          sendDefaultPii: false,
          beforeSend(event, hint) {
            // Telemetry may have been turned off while this report waited.
            if (cliTelemetryMode() !== "on") return null;
            const exceptionType = event.exception?.values?.[0]?.type;
            if (
              exceptionType === "ValidationError" ||
              event.tags?.handled === "validation"
            ) {
              return null;
            }
            return sanitizeSentryEvent(event, hint);
          },
        });
        return sentry;
      })
      .catch((error: unknown) => {
        reportUnavailable(error, stderr);
        return undefined;
      });
  }
  return sentryPromise;
}

function printSentryDebug(error: unknown, context: SentryCaptureContext): void {
  const type = errorType(error);
  const code = errorCode(error);
  const stack = ownStack(error, type);
  const tags = (context as { tags?: Record<string, unknown> } | undefined)
    ?.tags;
  printTelemetryDebug("sentry", {
    exceptionType: type,
    ...(code ? { exceptionCode: code } : {}),
    exceptionMessage: errorHint(error) || type,
    ...(stack ? { exceptionStack: stack } : {}),
    tags: pickSafeFields(tags, CLI_EXCEPTION_TAGS),
  });
}

export function captureSentryException(
  error: unknown,
  context?: SentryCaptureContext,
  stderr: ErrorOutput = process.stderr,
): Promise<void> {
  const mode = cliTelemetryMode();
  if (mode === "debug") printSentryDebug(error, context);
  if (mode !== "on") return reporting;
  printTelemetryNoticeOnce();
  reporting = reporting
    .then(async () => {
      const sentry = await loadSentry(stderr);
      sentry?.captureException(error, context);
    })
    .catch((reportingError: unknown) =>
      reportUnavailable(reportingError, stderr),
    );
  return reporting;
}

export async function flushSentryTelemetry(
  timeout = 2000,
  stderr: ErrorOutput = process.stderr,
): Promise<void> {
  await reporting;
  if (!sentryPromise) return;
  const sentry = await sentryPromise;
  if (!sentry) return;
  try {
    await sentry.flush(timeout);
  } catch (error) {
    reportUnavailable(error, stderr);
  }
}
