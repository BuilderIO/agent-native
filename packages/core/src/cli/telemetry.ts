/**
 * Best-effort install-funnel telemetry for the core CLI.
 *
 * Events are POSTed to the first-party Agent Native Analytics endpoint
 * (analytics.agent-native.com/track) using a PUBLIC, write-only key — the same
 * mechanism every agent-native app uses to report client-side events. Nothing
 * here ever blocks or throws into the install flow: sends are fire-and-forget
 * and `flush()` awaits any in-flight requests with a short cap before exit.
 *
 * Privacy: we report skill NAMES, client ids, scope, counts, platform, and the
 * CLI version — never file paths, repo names, cwd, skill sources, or anything
 * user-identifying. A random per-machine install id (unique installs) and a
 * per-invocation run id (step-by-step dropoff) are the only identifiers.
 *
 * Opt out with DO_NOT_TRACK=1 or AGENT_NATIVE_TELEMETRY_DISABLED=1.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Public, write-only analytics key. Safe to embed (revocable from the Analytics
// settings UI). Override with AGENT_NATIVE_ANALYTICS_PUBLIC_KEY for testing or
// to point telemetry at a different first-party analytics instance.
// guard:allow-public-key -- first-party analytics write key is public by design.
const EMBEDDED_PUBLIC_KEY =
  "anpk_dc523e34b99bc34d76e82d94c46593544e4a8509a4bfc93c";
const DEFAULT_ENDPOINT = "https://analytics.agent-native.com/track";
const FLUSH_TIMEOUT_MS = 1500;

export interface CliTelemetryOptions {
  /** Stable identifier for the emitting CLI, e.g. "skills-installer". */
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

function telemetryDisabled(): boolean {
  return (
    process.env.DO_NOT_TRACK === "1" ||
    process.env.AGENT_NATIVE_TELEMETRY_DISABLED === "1" ||
    process.env.NODE_ENV === "test" ||
    typeof fetch !== "function"
  );
}

const MAX_EXCEPTION_MESSAGE_LENGTH = 1000;
const MAX_EXCEPTION_STACK_LENGTH = 8000;
const MAX_EXCEPTION_TAGS = 30;
const MAX_EXCEPTION_EXTRA_KEYS = 30;
const MAX_EXCEPTION_VALUE_LENGTH = 1000;
const SECRET_RE = /\b(?:bearer|basic)\s+[^\s]+/gi;
const SECRET_KEY_RE =
  /(?:authorization|cookie|set[-_]?cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)/i;

function redactExceptionText(value: string): string {
  return value
    .replace(SECRET_RE, (match) => `${match.split(/\s+/, 1)[0]} <redacted>`)
    .replace(
      /([A-Za-z0-9_$.-]*(?:authorization|cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|credential)[A-Za-z0-9_$.-]*\s*[:=]\s*)([^\s,;}]+)/gi,
      "$1<redacted>",
    );
}

function boundedExceptionText(value: unknown, max: number): string {
  const text =
    typeof value === "string" ? value : String(value ?? "Unknown error");
  const safe = redactExceptionText(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

function safeExceptionValue(value: unknown, depth = 2): unknown {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return boundedExceptionText(value, MAX_EXCEPTION_VALUE_LENGTH);
  }
  if (depth <= 0)
    return boundedExceptionText(value, MAX_EXCEPTION_VALUE_LENGTH);
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => safeExceptionValue(item, depth - 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.keys(out).length >= MAX_EXCEPTION_EXTRA_KEYS) break;
      const safeKey = boundedExceptionText(key, 100);
      out[safeKey] = SECRET_KEY_RE.test(safeKey)
        ? "<redacted>"
        : safeExceptionValue(child, depth - 1);
    }
    return out;
  }
  return boundedExceptionText(value, MAX_EXCEPTION_VALUE_LENGTH);
}

function captureException(
  error: unknown,
  context: CliExceptionContext,
  trackEvent: (event: string, properties?: Record<string, unknown>) => void,
): void {
  const exception =
    error instanceof Error
      ? {
          type: boundedExceptionText(error.name || "Error", 200),
          message: boundedExceptionText(
            error.message || error.name || "Error",
            MAX_EXCEPTION_MESSAGE_LENGTH,
          ),
          stack: error.stack
            ? boundedExceptionText(error.stack, MAX_EXCEPTION_STACK_LENGTH)
            : undefined,
        }
      : {
          type: "Error",
          message: boundedExceptionText(error, MAX_EXCEPTION_MESSAGE_LENGTH),
          stack: undefined,
        };
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    if (Object.keys(tags).length >= MAX_EXCEPTION_TAGS || value == null) break;
    const safeKey = boundedExceptionText(key, 100);
    tags[safeKey] = SECRET_KEY_RE.test(safeKey)
      ? "<redacted>"
      : boundedExceptionText(value, 200);
  }
  const extra = safeExceptionValue(context.extra);
  trackEvent("$exception", {
    app: "agent-native-cli",
    template: "cli",
    runtime: "cli",
    source: "cli",
    exceptionType: exception.type,
    exceptionMessage: exception.message,
    ...(exception.stack ? { exceptionStack: exception.stack } : {}),
    handled: context.handled ?? false,
    level: context.level ?? "error",
    occurredAt: new Date().toISOString(),
    ...(Object.keys(tags).length ? { exceptionTags: tags } : {}),
    ...(extra && typeof extra === "object" ? { exceptionExtra: extra } : {}),
  });
}

/**
 * Read (or lazily create) a stable per-machine install id, shared across both
 * skills CLIs so one developer counts once. Best-effort: an unwritable home
 * directory just yields an ephemeral id for this run.
 */
function resolveInstallId(): string {
  try {
    const dir = path.join(os.homedir(), ".agent-native");
    const file = path.join(dir, "installation-id");
    const existing = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").trim()
      : "";
    if (existing) return existing;
    const id = crypto.randomUUID();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${id}\n`, "utf8");
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function createCliTelemetry(options: CliTelemetryOptions): CliTelemetry {
  const publicKey = resolvePublicKey();
  const disabled = telemetryDisabled() || !publicKey;
  const endpoint = resolveEndpoint();
  const installId = disabled ? "" : resolveInstallId();
  const runId = crypto.randomUUID();
  const inFlight = new Set<Promise<void>>();

  const base = {
    cli: options.cli,
    cliVersion: options.cliVersion,
    command: options.command,
    node: process.version,
    platform: process.platform,
    ci: process.env.CI === "true",
    interactive: options.interactive,
    runId,
    installId,
  };

  function track(event: string, properties?: Record<string, unknown>): void {
    if (disabled) return;
    const body = JSON.stringify({
      publicKey,
      event,
      anonymousId: installId,
      sessionId: runId,
      timestamp: new Date().toISOString(),
      properties: { ...base, ...properties },
    });
    const promise = fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined);
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
  }

  async function flush(): Promise<void> {
    if (disabled || inFlight.size === 0) return;
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ]);
  }

  return {
    track,
    captureException: (error, context = {}) =>
      captureException(error, context, track),
    flush,
  };
}
