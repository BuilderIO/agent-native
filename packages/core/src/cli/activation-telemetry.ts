/**
 * The framework activation funnel: of the machines that ran `create`, how many
 * got a dev server running and finished a deploy build, and from which
 * templates. docs/content/telemetry.mdx documents each event.
 *
 * Only fixed words and our own template names leave through here. A template
 * URL, app name, project name or custom preset is reported as a fixed word.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEV_SERVER_READY_FILE_ENV } from "./process.js";
import { cliTelemetryMode } from "./telemetry-settings.js";
import type { CliTelemetry } from "./telemetry.js";
import { getTemplate } from "./templates-meta.js";

export const CREATE_FINISHED_EVENT = "cli_create_finished";
export const DEV_READY_EVENT = "cli_dev_ready";
export const DEPLOY_FINISHED_EVENT = "cli_deploy_finished";

export type CreateProjectKind =
  | "workspace"
  | "standalone"
  | "headless"
  | "workspace-add";
export type CreateStep = "choose" | "scaffold" | "finish";

const COMMUNITY_TEMPLATE = "community";
const HEADLESS_TEMPLATE = "headless";
const UNKNOWN_TEMPLATE = "unknown";
const DEV_READY_POLL_MS = 500;
const DEFAULT_PRESET = "node";
const OTHER_PRESET = "other";
// Nitro names a preset after its host, such as vercel_edge or netlify-edge.
const PRESET_HOST_RE =
  /^(aws|azure|bun|cloudflare|deno|firebase|netlify|node|vercel)(?:$|[-_])/;

const createRun: {
  kind?: CreateProjectKind;
  templates: string[];
  step: CreateStep;
  cancelled: boolean;
  returned: boolean;
} = { templates: [], step: "choose", cancelled: false, returned: false };

/** Pass "community" for a community template, never its URL. */
export function reportableTemplate(name: string): string {
  if (name === COMMUNITY_TEMPLATE || name === HEADLESS_TEMPLATE) return name;
  return getTemplate(name)?.name ?? UNKNOWN_TEMPLATE;
}

export function noteCreateProject(
  templates: string[],
  kind?: CreateProjectKind,
): void {
  createRun.templates = templates.map(reportableTemplate);
  if (kind) createRun.kind = kind;
}

export function noteCreateStep(step: CreateStep): void {
  createRun.step = step;
}

/** For a path that returns without creating anything. */
export function noteCreateCancelled(): void {
  createRun.cancelled = true;
}

export function noteCreateReturned(): void {
  createRun.returned = true;
}

/**
 * The prompts leave with `process.exit(0)` when cancelled, so an exit of 0
 * before `create` returned is a cancel.
 */
export function createFinishedProperties(
  exitCode: number,
): Record<string, unknown> {
  const outcome =
    exitCode !== 0
      ? "failed"
      : createRun.returned && !createRun.cancelled
        ? "completed"
        : "cancelled";
  return {
    outcome,
    ...(createRun.templates.length
      ? { templates: createRun.templates.join(",") }
      : {}),
    ...(createRun.kind ? { projectKind: createRun.kind } : {}),
    ...(outcome === "failed" ? { failedStep: createRun.step } : {}),
  };
}

/** A preset can be any string a developer set, so only known hosts pass. */
export function reportablePreset(preset: string): string {
  return PRESET_HOST_RE.exec(preset.trim().toLowerCase())?.[1] ?? OTHER_PRESET;
}

/** A preset marker that can't be read doesn't name a host or cost the event. */
export function readPresetForReport(
  read: () => string | undefined,
): string | undefined {
  try {
    return read();
    // coercion-ok: the build reports its own outcome whatever this marker holds
  } catch {
    return OTHER_PRESET;
  }
}

export function deployFinishedProperties(
  exitCode: number,
  run: { step: string; preset?: string },
): Record<string, unknown> {
  const failed = exitCode !== 0;
  // With no preset a build targets Node. A failed run may not have got as far
  // as finding the preset, so it doesn't claim one.
  const preset = run.preset ?? (failed ? undefined : DEFAULT_PRESET);
  return {
    outcome: failed ? "failed" : "completed",
    ...(preset ? { preset: reportablePreset(preset) } : {}),
    ...(failed ? { failedStep: run.step } : {}),
  };
}

/**
 * Sends one event as the process exits, however it exits: `create` and `build`
 * call `process.exit` from dozens of places.
 */
export function reportAtExit(
  telemetry: Pick<CliTelemetry, "trackAtExit">,
  event: string,
  properties: (exitCode: number) => Record<string, unknown>,
  target: Pick<NodeJS.Process, "once"> = process,
): void {
  target.once("exit", (exitCode: number) => {
    try {
      telemetry.trackAtExit(event, properties(exitCode));
      // coercion-ok: telemetry never changes how a command ends
    } catch {}
  });
}

/**
 * Watches for the dev server's first "listening" in this run and returns the
 * environment to start it with. The dev server creates the file named there,
 * and only the first creation succeeds, so a restart can't report again.
 */
export function startDevReadyReport(
  telemetry: Pick<CliTelemetry, "track">,
  run: { workspace: boolean; appCount: () => number },
  env: NodeJS.ProcessEnv = process.env,
  pollMs = DEV_READY_POLL_MS,
): NodeJS.ProcessEnv {
  // An outer `agent-native dev` is already watching.
  if (env[DEV_SERVER_READY_FILE_ENV] || cliTelemetryMode() === "off") {
    return env;
  }
  const startedAt = Date.now();
  const file = path.join(
    os.tmpdir(),
    `agent-native-dev-ready-${crypto.randomUUID()}`,
  );
  const poll = setInterval(() => {
    let readyAt: number;
    try {
      readyAt = Number(fs.readFileSync(file, "utf8"));
      // coercion-ok: no file yet means the server isn't ready yet
    } catch {
      return;
    }
    // The server has created the file but not written the time into it yet.
    if (!readyAt) return;
    clearInterval(poll);
    try {
      telemetry.track(DEV_READY_EVENT, {
        workspace: run.workspace,
        appCount: run.appCount(),
        readySeconds: Math.round((readyAt - startedAt) / 100) / 10,
      });
      // coercion-ok: telemetry never disturbs the dev server
    } catch {}
  }, pollMs);
  poll.unref();
  process.once("exit", () => {
    try {
      fs.rmSync(file, { force: true });
      // coercion-ok: a leftover temp file never changes how a command ends
    } catch {}
  });
  return { ...env, [DEV_SERVER_READY_FILE_ENV]: file };
}
