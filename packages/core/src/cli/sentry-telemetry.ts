import type { ErrorEvent, EventHint, StackFrame } from "@sentry/node";

import {
  loadOptionalPeer,
  OptionalPeerDependencyError,
} from "../shared/optional-peer.js";
import { telemetryCommandName } from "./telemetry-routing.js";
import {
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
    kept.push({
      filename,
      function: ownFrameFunction(frame.function),
      lineno: frame.lineno,
      colno: frame.colno,
      in_app: true,
    });
  }
  return kept;
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
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: SENTRY_ENVIRONMENT,
    sdk: event.sdk,
    exception: {
      values: event.exception?.values?.map((value) => {
        const type = safeErrorName(value.type);
        return {
          type,
          value: errorHint(original ?? value.value) || type,
          mechanism: value.mechanism && {
            type: value.mechanism.type,
            handled: value.mechanism.handled,
          },
          stacktrace: { frames: ownFrames(value.stacktrace?.frames) },
        };
      }),
    },
    tags: {
      ...pickSafeFields(event.tags, CLI_EXCEPTION_TAGS),
      ...(code ? { code } : {}),
      command: telemetryCommandName(process.argv[2]),
      nodeVersion: process.version,
      platform: process.platform,
    },
  };
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
