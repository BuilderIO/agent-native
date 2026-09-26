
import fs from "fs";
import { spawnSync } from "node:child_process";
import path from "path";
import { pathToFileURL } from "url";

import "../authorization/check-action.js";
import { Agent } from "undici";

import type { ActionEntry } from "../agent/production-agent.js";
import { getAppConfig } from "../app-config/index.js";
import {
  closeDbExec,
  getRuntimeDatabaseUrl,
  isProcessAlive,
} from "../db/client.js";
import {
  actionCallIsReadOnly,
  notifyActionChange,
} from "../server/action-change.js";
import {
  DEV_ACTION_ORG_HEADER,
  DEV_ACTION_ROUTE,
  DEV_ACTION_TOKEN_HEADER,
  DEV_ACTION_USER_HEADER,
  devActionHandoffUrl,
  hashDatabaseKey,
  isLoopbackDevActionOrigin,
  isValidDevActionHandoffUrl,
  readDevActionDiscoveryFile,
} from "../server/dev-action-bridge.js";
import {
  runWithRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { loadCliBootstrap } from "./cli-bootstrap.js";
import { coreScripts, getCoreScriptNames } from "./core-scripts.js";
import { resolveDevUserEmail } from "./dev-session.js";
import { loadEnv } from "./utils.js";

loadEnv();

const CLI_HANDOFF_KEYS = new Set(["embedStartUrl", "startUrl"]);
const CLI_HANDOFF_URL_PATTERN =
  /\/_agent-native\/embed\/start\?[^\s"'<>)}\]]+/g;

function withoutCliHandoffText(value: unknown): string {
  return String(value).replace(
    CLI_HANDOFF_URL_PATTERN,
    "[redacted embed handoff]",
  );
}

function withoutCliHandoffSecrets(
  value: unknown,
  ancestors = new WeakSet<object>(),
): unknown {
  if (
    typeof value === "string" &&
    value.includes("/_agent-native/embed/start?")
  ) {
    return withoutCliHandoffText(value);
  }
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child) => withoutCliHandoffSecrets(child, ancestors));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !CLI_HANDOFF_KEYS.has(key))
        .map(([key, child]) => [
          key,
          withoutCliHandoffSecrets(child, ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

type CliHandoffLaunchOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "disabled" | "missing-base" | "invalid-url" | "open-failed";
      message: string;
    };

interface CliHandoffLaunchDeps {
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawn?: (
    command: string,
    args: string[],
  ) => { status: number | null; error?: Error };
}

function resolveCliHandoffBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  return (
    env.APP_URL ||
    env.WORKSPACE_GATEWAY_URL ||
    env.VITE_WORKSPACE_GATEWAY_URL ||
    env.BETTER_AUTH_URL
  );
}

export function openCliHandoff(
  urlOrPath: string,
  deps: CliHandoffLaunchDeps = {},
): CliHandoffLaunchOutcome {
  const env = deps.env ?? process.env;
  if (env.AGENT_NATIVE_NO_OPEN === "1") {
    return {
      ok: false,
      reason: "disabled",
      message:
        "Secure browser handoff is disabled by AGENT_NATIVE_NO_OPEN. Remove it and rerun this action.",
    };
  }
  const baseUrl = deps.baseUrl ?? resolveCliHandoffBaseUrl(env);
  if (!isValidDevActionHandoffUrl(urlOrPath, baseUrl)) {
    return {
      ok: false,
      reason: "invalid-url",
      message:
        "Secure browser handoff found an invalid app URL. Fix APP_URL or WORKSPACE_GATEWAY_URL, then rerun this action.",
    };
  }
  let url = urlOrPath;
  if (urlOrPath.startsWith("/")) {
    if (!baseUrl) {
      return {
        ok: false,
        reason: "missing-base",
        message:
          "Secure browser handoff needs APP_URL or WORKSPACE_GATEWAY_URL. Start the app locally or set its URL, then rerun this action.",
      };
    }
    try {
      url = new URL(urlOrPath, baseUrl).toString();
    } catch {
      return {
        ok: false,
        reason: "invalid-url",
        message:
          "Secure browser handoff found an invalid app URL. Fix APP_URL or WORKSPACE_GATEWAY_URL, then rerun this action.",
      };
    }
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return {
      ok: false,
      reason: "invalid-url",
      message:
        "Secure browser handoff found an invalid app URL. Fix APP_URL or WORKSPACE_GATEWAY_URL, then rerun this action.",
    };
  }

  const platform = deps.platform ?? process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const launch =
      deps.spawn?.(command, args) ??
      spawnSync(command, args, {
        stdio: "ignore",
        timeout: 10_000,
      });
    if (launch.error || launch.status !== 0) {
      return {
        ok: false,
        reason: "open-failed",
        message:
          "Secure browser handoff could not invoke the system URL opener. Verify local URL handling, then rerun this action.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "open-failed",
      message:
        "Secure browser handoff could not invoke the system URL opener. Verify local URL handling, then rerun this action.",
    };
  }
  return { ok: true };
}

function printActionResult(result: unknown): CliHandoffLaunchOutcome | null {
  const handoffUrl = devActionHandoffUrl(result);
  const handoff = handoffUrl ? openCliHandoff(handoffUrl) : null;
  console.log(withoutCliHandoffSecrets(result));
  return handoff;
}

function assertCliHandoffLaunched(
  outcome: CliHandoffLaunchOutcome | null,
): void {
  if (outcome && !outcome.ok) throw new Error(outcome.message);
}

export interface RunScriptOptions {
  packageActions?: Record<string, ActionEntry>;
  packageActionLabel?: string;
}

async function runAppDbPluginIfPresent(): Promise<void> {
  const dbPluginPath = path.resolve(process.cwd(), "server/plugins/db.ts");
  if (!fs.existsSync(dbPluginPath)) return;

  const mod = await import(/* @vite-ignore */ pathToFileURL(dbPluginPath).href);
  const plugin = mod.default;
  if (typeof plugin === "function") {
    await plugin({});
  }
}

export async function runScript(options: RunScriptOptions = {}): Promise<void> {
  const actionName = process.argv[2];
  const args = process.argv.slice(3);

  if (!actionName || actionName === "--help" || args.includes("--help")) {
    console.log(
      `Usage: pnpm action <action-name> ['{"arg":"value"}'] [--arg value ...]`,
    );

    const actionsDir = path.resolve(process.cwd(), "actions");
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const localDir = fs.existsSync(actionsDir) ? actionsDir : scriptsDir;
    if (fs.existsSync(localDir)) {
      const locals = fs
        .readdirSync(localDir)
        .filter((f) => f.endsWith(".ts") && f !== "run.ts")
        .map((f) => f.replace(/\.ts$/, ""));
      if (locals.length > 0) {
        console.log(`\nApp actions:`);
        for (const name of locals) {
          console.log(`  ${name}`);
        }
      }
    }

    const packageActionNames = Object.keys(options.packageActions ?? {}).sort();
    if (packageActionNames.length > 0) {
      console.log(`\n${options.packageActionLabel ?? "Package actions"}:`);
      for (const name of packageActionNames) {
        console.log(`  ${name}`);
      }
    }

    const coreNames = getCoreScriptNames();
    if (coreNames.length > 0) {
      console.log(`\nCore actions (built-in):`);
      for (const name of coreNames) {
        console.log(`  ${name}`);
      }
    }

    process.exit(0);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(actionName)) {
    console.error(`Error: Invalid action name "${actionName}"`);
    process.exit(1);
  }

  await tryForwardToDevServer(actionName, args);


  await loadCliBootstrap();

  const userEmail = await resolveDevUserEmail();
  const orgId = process.env.AGENT_ORG_ID || undefined;

  return runWithRequestContext({ userEmail, orgId }, () =>
    dispatchAction(actionName, args, options),
  );
}

export async function tryForwardToDevServer(
  actionName: string,
  args: string[],
): Promise<void> {
  const discovery = readDevActionDiscoveryFile(process.cwd());
  if (!discovery || !isProcessAlive(discovery.pid)) return;
  // dev token plus the caller's identity headers: only ever send those to the
  if (!isLoopbackDevActionOrigin(discovery.origin)) return;
  const ourDatabaseKey = hashDatabaseKey(
    getRuntimeDatabaseUrl("pglite:./data/pglite"),
  );
  if (discovery.databaseKey !== ourDatabaseKey) return;

  let input: Record<string, unknown>;
  try {
    input = parseActionArgs(args, { coerceBooleans: true });
  } catch (error) {
    console.error(
      `Action "${actionName}" failed:`,
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }

  let response: Response;
  // so certificate bypass cannot send the dev token to a remote host.
  const tlsDispatcher = discovery.origin.startsWith("https:")
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  try {
    const request: RequestInit & { dispatcher?: Agent } = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEV_ACTION_TOKEN_HEADER]: discovery.token,
        ...(process.env.AGENT_USER_EMAIL
          ? { [DEV_ACTION_USER_HEADER]: process.env.AGENT_USER_EMAIL }
          : {}),
        ...(process.env.AGENT_ORG_ID
          ? { [DEV_ACTION_ORG_HEADER]: process.env.AGENT_ORG_ID }
          : {}),
      },
      body: JSON.stringify({ name: actionName, input }),
      ...(tlsDispatcher ? { dispatcher: tlsDispatcher } : {}),
    };
    response = await fetch(`${discovery.origin}${DEV_ACTION_ROUTE}`, request);
  } catch {
    await tlsDispatcher?.destroy();
    return;
  }

  if (response.status === 404) {
    await tlsDispatcher?.close();
    return;
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    console.error(
      `Action "${actionName}" failed:`,
      (body as { error?: string })?.error ?? `HTTP ${response.status}`,
    );
    await tlsDispatcher?.close();
    process.exit(1);
  }

  const body = (await response.json().catch(() => ({
    ok: false,
    error: "Invalid response from dev server.",
  }))) as {
    ok: boolean;
    result?: unknown;
    error?: string;
    devHandoffUrl?: unknown;
  };
  await tlsDispatcher?.close();
  if (!body.ok) {
    console.error(
      `Action "${actionName}" failed:`,
      withoutCliHandoffText(body.error ?? "Unknown error"),
    );
    process.exit(1);
  }
  const handoffUrl =
    typeof body.devHandoffUrl === "string"
      ? body.devHandoffUrl
      : devActionHandoffUrl(body.result);
  if (body.result !== undefined) {
    console.log(withoutCliHandoffSecrets(body.result));
  }
  const validHandoffUrl = isValidDevActionHandoffUrl(
    handoffUrl,
    discovery.origin,
  )
    ? handoffUrl
    : undefined;
  assertCliHandoffLaunched(
    validHandoffUrl
      ? openCliHandoff(validHandoffUrl, { baseUrl: discovery.origin })
      : null,
  );
  process.exit(0);
}

function coerceCliValue(
  value: string,
  coerceBooleans: boolean,
): string | boolean {
  if (!coerceBooleans) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function setParsedArg(
  parsed: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  const existing = parsed[key];
  if (existing === undefined) {
    parsed[key] = value;
    return;
  }
  parsed[key] = Array.isArray(existing)
    ? [...existing, value]
    : [existing, value];
}

function parseActionArgs(
  args: string[],
  options: { coerceBooleans?: boolean } = {},
): Record<string, unknown> {
  const parsed = parsePositionalJsonArg(args);
  const flagArgs: Record<string, unknown> = {};
  const coerceBooleans = options.coerceBooleans ?? false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0) {
      setParsedArg(
        flagArgs,
        arg.slice(2, eqIdx),
        coerceCliValue(arg.slice(eqIdx + 1), coerceBooleans),
      );
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        setParsedArg(flagArgs, key, coerceCliValue(next, coerceBooleans));
        i++;
      } else {
        setParsedArg(flagArgs, key, coerceBooleans ? true : "true");
      }
    }
  }
  return { ...parsed, ...flagArgs };
}

function parsePositionalJsonArg(args: string[]): Record<string, unknown> {
  let jsonArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && args[i + 1] && !args[i + 1].startsWith("--")) {
        i++;
      }
      continue;
    }

    const trimmed = arg.trim();
    if (!trimmed.startsWith("{")) continue;
    if (jsonArg !== undefined) {
      throw new Error("Only one positional JSON object argument is supported.");
    }
    jsonArg = trimmed;
  }

  if (jsonArg === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonArg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid positional JSON argument: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Positional JSON argument must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function cliActionCtx(
  actionName: string,
): import("../action.js").ActionRunContext {
  const app = getAppConfig().app;
  const appId = app.id ?? app.slug ?? app.template;
  return {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId() ?? null,
    ...(appId ? { appId } : {}),
    caller: "cli",
    actionName,
  };
}

async function dispatchAction(
  actionName: string,
  args: string[],
  options: RunScriptOptions,
): Promise<void> {
  const actionsPath = path.resolve(
    process.cwd(),
    "actions",
    `${actionName}.ts`,
  );
  const scriptsPath = path.resolve(
    process.cwd(),
    "scripts",
    `${actionName}.ts`,
  );
  const localPath = fs.existsSync(actionsPath) ? actionsPath : scriptsPath;

  if (fs.existsSync(localPath)) {
    try {
      await runAppDbPluginIfPresent();
      const mod = await import(
        /* @vite-ignore */ pathToFileURL(localPath).href
      );
      const handler = mod.default;
      if (
        handler &&
        typeof handler === "object" &&
        typeof handler.run === "function"
      ) {
        const parsed = parseActionArgs(args, { coerceBooleans: true });
        const result = await handler.run(parsed, cliActionCtx(actionName));
        if (!actionCallIsReadOnly(handler, parsed, false)) {
          await notifyActionChange({ actionName }).catch(() => {});
        }
        if (result) assertCliHandoffLaunched(printActionResult(result));
      } else if (typeof handler === "function") {
        await handler(args);
      } else {
        console.error(
          `Action "${actionName}" does not export a default function or defineAction.`,
        );
        process.exit(1);
      }
      await closeDbExec().catch(() => {});
      process.exit(0);
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(
        `Action "${actionName}" failed:`,
        withoutCliHandoffText(err.message || err),
      );
      process.exit(1);
    }
  }

  const packageAction = options.packageActions?.[actionName];
  if (packageAction) {
    try {
      await runAppDbPluginIfPresent();
      const parsed = parseActionArgs(args, { coerceBooleans: true });
      const result = await packageAction.run(
        parsed as Record<string, string>,
        cliActionCtx(actionName),
      );
      if (!actionCallIsReadOnly(packageAction, parsed, false)) {
        await notifyActionChange({ actionName }).catch(() => {});
      }
      if (result) assertCliHandoffLaunched(printActionResult(result));
      await closeDbExec().catch(() => {});
      process.exit(0);
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(
        `Action "${actionName}" failed:`,
        withoutCliHandoffText(err.message || err),
      );
      process.exit(1);
    }
  }

  const coreScript = coreScripts[actionName];
  if (coreScript) {
    try {
      await coreScript(args);
      await closeDbExec().catch(() => {});
      process.exit(0);
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(
        `Core action "${actionName}" failed:`,
        withoutCliHandoffText(err.message || err),
      );
      process.exit(1);
    }
  }

  console.error(
    `Error: Action "${actionName}" not found. Run "pnpm action --help" for available actions.`,
  );
  process.exit(1);
}
