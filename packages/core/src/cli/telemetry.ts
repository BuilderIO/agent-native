/**
 * Best-effort CLI telemetry, shared by the core and skills CLIs.
 *
 * Events are POSTed to the first-party Agent-Native Analytics endpoint
 * (analytics.agent-native.com/track) using a PUBLIC, write-only key — the same
 * mechanism every agent-native app uses to report client-side events. Nothing
 * here ever blocks or throws into the install flow: sends are fire-and-forget
 * and `flush()` awaits any in-flight requests with a short cap before exit.
 *
 * Privacy: telemetry-sanitize.ts holds the only list of what may be sent, and
 * docs/content/telemetry.mdx documents all of it. A random per-machine install
 * id (unique installs) and a per-invocation run id (step-by-step dropoff) are
 * the only identifiers.
 *
 * Opt out with `agent-native telemetry disable`, DO_NOT_TRACK=1 or
 * AGENT_NATIVE_TELEMETRY_DISABLED=1. AGENT_NATIVE_TELEMETRY_DEBUG=1 prints each
 * event instead of sending it.
 */
import crypto from "node:crypto";

import { canonicalTrackingEvent } from "../shared/analytics-events.js";
import {
  CLI_EXCEPTION_EXTRA,
  CLI_EXCEPTION_TAGS,
  errorCode,
  errorHint,
  errorType,
  ownStack,
  pickSafeFields,
  sanitizeEventProperties,
} from "./telemetry-sanitize.js";
import {
  cliTelemetryMode,
  isCiEnvironment,
  printTelemetryDebug,
  printTelemetryNoticeOnce,
  resolveInstallId,
} from "./telemetry-settings.js";

// Public, write-only analytics key. Safe to embed (revocable from the Analytics
// settings UI). Override with AGENT_NATIVE_ANALYTICS_PUBLIC_KEY for testing or
// to point telemetry at a different first-party analytics instance.
// guard:allow-public-key -- first-party analytics write key is public by design.
const EMBEDDED_PUBLIC_KEY =
  "anpk_dc523e34b99bc34d76e82d94c46593544e4a8509a4bfc93c";
const DEFAULT_ENDPOINT = "https://analytics.agent-native.com/track";
// How long a send can hold up a command, including one that never flushes.
const SEND_TIMEOUT_MS = 1500;

export interface CliTelemetryOptions {
  cli: string;
  cliVersion: string;
  command: string;
  interactive: boolean;
}

export interface CliTelemetry {
  track(event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, context?: CliExceptionContext): void;
  flush(): Promise<void>;
}

export interface CliExceptionContext {
  handled?: boolean;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

function resolvePublicKey(): string {
  const fromEnv = process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY?.trim();
  return fromEnv || EMBEDDED_PUBLIC_KEY;
}

function resolveEndpoint(): string {
  const fromEnv = process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT?.trim();
  return (fromEnv || DEFAULT_ENDPOINT).replace(/\/+$/, "");
}

// A fuzz or test harness stubs `process.exit` with a function that throws this
// label; running the CLI under one is not a production failure.
function isTestHarnessError(error: unknown): boolean {
  const value = error instanceof Error ? error.message : String(error ?? "");
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  return (
    value.trim() === "fuzz-intercepted-process-exit" ||
    /fuzzInterceptedProcessExit|fuzz-exports\.js/.test(stack)
  );
}

function exceptionProperties(
  error: unknown,
  context: CliExceptionContext,
  release: string,
): Record<string, unknown> {
  const type = errorType(error);
  const code = errorCode(error);
  const stack = ownStack(error, type);
  const tags = pickSafeFields(context.tags, CLI_EXCEPTION_TAGS);
  const extra = pickSafeFields(context.extra, CLI_EXCEPTION_EXTRA);
  return {
    app: "agent-native-cli",
    template: "cli",
    runtime: "cli",
    source: "cli",
    exceptionType: type,
    ...(code ? { exceptionCode: code } : {}),
    exceptionMessage: errorHint(error) || type,
    ...(stack ? { exceptionStack: stack } : {}),
    handled: context.handled ?? false,
    level: context.level ?? "error",
    occurredAt: new Date().toISOString(),
    release,
    ...(Object.keys(tags).length ? { exceptionTags: tags } : {}),
    ...(Object.keys(extra).length ? { exceptionExtra: extra } : {}),
  };
}

export function createCliTelemetry(options: CliTelemetryOptions): CliTelemetry {
  const publicKey = resolvePublicKey();
  const endpoint = resolveEndpoint();
  let installId: string | undefined;
  const runId = crypto.randomUUID();
  const inFlight = new Set<Promise<void>>();

  const base = {
    cli: options.cli,
    cliVersion: options.cliVersion,
    command: options.command,
    node: process.version,
    platform: process.platform,
    ci: isCiEnvironment(),
    interactive: options.interactive,
    runId,
  };

  function emit(event: string, properties: Record<string, unknown>): void {
    // Read for each event, so disabling telemetry also stops a running command.
    const mode = publicKey ? cliTelemetryMode() : "off";
    if (mode === "off") return;
    installId ??= resolveInstallId({ persist: mode === "on" });
    const legacyProperties = { ...base, installId, ...properties };
    const events: Array<{
      name: string;
      properties: Record<string, unknown>;
    }> = [{ name: event, properties: legacyProperties }];
    const canonical = canonicalTrackingEvent(event, legacyProperties);
    if (canonical) events.push(canonical);
    if (mode === "debug") {
      for (const emitted of events) {
        printTelemetryDebug(emitted.name, emitted.properties);
      }
      return;
    }
    printTelemetryNoticeOnce();
    for (const emitted of events) {
      const body = JSON.stringify({
        publicKey,
        event: emitted.name,
        anonymousId: installId,
        sessionId: runId,
        timestamp: new Date().toISOString(),
        properties: emitted.properties,
      });
      const promise = fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
        .then(() => undefined)
        .catch(() => undefined);
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
    }
  }

  async function flush(): Promise<void> {
    if (inFlight.size === 0) return;
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS)),
    ]);
  }

  return {
    track: (event, properties) =>
      emit(event, sanitizeEventProperties(properties)),
    captureException: (error, context = {}) => {
      if (isTestHarnessError(error)) return;
      emit(
        "$exception",
        exceptionProperties(
          error,
          context,
          `agent-native-cli@${options.cliVersion}`,
        ),
      );
    },
    flush,
  };
}
