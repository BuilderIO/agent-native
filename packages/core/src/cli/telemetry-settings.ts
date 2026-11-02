/**
 * The machine's telemetry state, shared by the core and skills CLIs: whether
 * telemetry is on, the once-only notice, and the random machine id. It all lives
 * in `~/.agent-native`, so one `telemetry disable` covers both CLIs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { docsUrl } from "../shared/docs-url.js";

export const TELEMETRY_DOCS_URL = docsUrl("telemetry");

const TELEMETRY_NOTICE = `▶ Agent-Native collects anonymous usage data.
  It shows us which parts of the CLI work and where people get stuck.
  Run "npx @agent-native/core telemetry disable" to opt out.
  ${TELEMETRY_DOCS_URL}

`;

export interface TelemetrySettings {
  enabled?: boolean;
  notifiedAt?: string;
}

export type TelemetryOffReason =
  | "DO_NOT_TRACK"
  | "AGENT_NATIVE_TELEMETRY_DISABLED"
  | "setting";

function agentNativeDir(): string {
  return path.join(os.homedir(), ".agent-native");
}

function settingsPath(): string {
  return path.join(agentNativeDir(), "telemetry.json");
}

function installIdPath(): string {
  return path.join(agentNativeDir(), "installation-id");
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value) && value !== "0" && value !== "false";
}

function isTelemetrySettings(value: unknown): value is TelemetrySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { enabled, notifiedAt } = value as Record<string, unknown>;
  return (
    (enabled === undefined || typeof enabled === "boolean") &&
    (notifiedAt === undefined || typeof notifiedAt === "string")
  );
}

export function readTelemetrySettings(): TelemetrySettings {
  let text: string;
  try {
    text = fs.readFileSync(settingsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { enabled: false };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (isTelemetrySettings(parsed)) return parsed;
    // coercion-ok: a file that won't parse falls through to off, below
  } catch {}
  // Someone may have opted out in a file we can no longer read: stay off.
  return { enabled: false };
}

function writeTelemetrySettings(settings: TelemetrySettings): void {
  fs.mkdirSync(agentNativeDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

export function setTelemetryEnabled(enabled: boolean): void {
  writeTelemetrySettings({ ...readTelemetrySettings(), enabled });
}

export function telemetryOffReason(): TelemetryOffReason | null {
  if (envFlag("DO_NOT_TRACK")) return "DO_NOT_TRACK";
  if (envFlag("AGENT_NATIVE_TELEMETRY_DISABLED")) {
    return "AGENT_NATIVE_TELEMETRY_DISABLED";
  }
  return readTelemetrySettings().enabled === false ? "setting" : null;
}

/**
 * "debug" prints what would be sent and sends nothing, even when telemetry is
 * off, so anyone can read exactly what a command reports before deciding.
 */
export function cliTelemetryMode(): "on" | "off" | "debug" {
  if (envFlag("AGENT_NATIVE_TELEMETRY_DEBUG")) return "debug";
  if (
    telemetryOffReason() ||
    process.env.NODE_ENV === "test" ||
    typeof fetch !== "function"
  ) {
    return "off";
  }
  return "on";
}

export function printTelemetryDebug(
  event: string,
  properties: Record<string, unknown>,
): void {
  process.stderr.write(
    `[telemetry] ${JSON.stringify({ event, properties })}\n`,
  );
}

export function isCiEnvironment(): boolean {
  return envFlag("CI") || envFlag("GITHUB_ACTIONS") || envFlag("GITLAB_CI");
}

let noticeChecked = false;

/** Tells the person on this machine once, before the first send, on stderr. */
export function printTelemetryNoticeOnce(): void {
  if (noticeChecked) return;
  noticeChecked = true;
  if (isCiEnvironment()) return;
  const settings = readTelemetrySettings();
  if (settings.notifiedAt) return;
  process.stderr.write(TELEMETRY_NOTICE);
  try {
    writeTelemetrySettings({
      ...settings,
      notifiedAt: new Date().toISOString(),
    });
    // coercion-ok: with a read-only home the notice just prints again next run
  } catch {}
}

/** The random machine id. `persist: false` previews without leaving one behind. */
export function resolveInstallId({ persist = true } = {}): string {
  try {
    const file = installIdPath();
    const existing = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").trim()
      : "";
    if (existing) return existing;
    const id = crypto.randomUUID();
    if (persist) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${id}\n`, "utf8");
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function resetInstallId(): void {
  fs.mkdirSync(agentNativeDir(), { recursive: true });
  fs.writeFileSync(installIdPath(), `${crypto.randomUUID()}\n`, "utf8");
}
