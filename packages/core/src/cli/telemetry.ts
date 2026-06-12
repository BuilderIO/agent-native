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
  flush(): Promise<void>;
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

  return { track, flush };
}
