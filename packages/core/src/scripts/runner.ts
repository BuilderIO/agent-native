/**
 * Generic action dispatcher for @agent-native/core apps.
 *
 * Dynamically imports and runs actions from the app's actions/ directory.
 * Falls back to scripts/ directory for backwards compatibility, then to
 * core scripts (db-schema, db-query, db-exec, etc.) when no local action is found.
 *
 * Actions must export a default function: (args: string[]) => Promise<void>
 *
 * Usage: pnpm action <action-name> ['{"arg":"value"}'] [--args]
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import type { ActionEntry } from "../agent/production-agent.js";
import { closeDbExec } from "../db/client.js";
import { notifyActionChange } from "../server/action-change.js";
import {
  runWithRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { coreScripts, getCoreScriptNames } from "./core-scripts.js";
import { resolveDevUserEmail } from "./dev-session.js";
import { loadEnv } from "./utils.js";

// Load .env from cwd so DATABASE_URL and other vars are available to all actions.
loadEnv();

export interface RunScriptOptions {
  /**
   * Actions contributed by packages rather than the app's local `actions/`
   * directory. Local app actions still win on name collision.
   */
  packageActions?: Record<string, ActionEntry>;
  /** Help-section label for package actions. */
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

/**
 * Run the action dispatcher. Call this from your app's actions/run.ts (or scripts/run.ts):
 *
 *   import { runScript } from "@agent-native/core";
 *   runScript();
 */
export async function runScript(options: RunScriptOptions = {}): Promise<void> {
  const actionName = process.argv[2];

  if (!actionName || actionName === "--help") {
    console.log(
      `Usage: pnpm action <action-name> ['{"arg":"value"}'] [--arg value ...]`,
    );
    console.log(`\nRun any action with --help for usage details.`);

    // List local actions (try actions/ first, then scripts/)
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

    // List core scripts
    const coreNames = getCoreScriptNames();
    if (coreNames.length > 0) {
      console.log(`\nCore actions (built-in):`);
      for (const name of coreNames) {
        console.log(`  ${name}`);
      }
    }

    process.exit(0);
  }

  // Validate action name (only allow alphanumeric + hyphens)
  if (!/^[a-z][a-z0-9-]*$/.test(actionName)) {
    console.error(`Error: Invalid action name "${actionName}"`);
    process.exit(1);
  }

  const args = process.argv.slice(3);

  // Establish a request context for the duration of this CLI run. Without
  // it, db-exec / db-query / db-patch and any action that calls
  // `getRequestUserEmail()` see no identity and refuse to run. The
  // resolver picks up `AGENT_USER_EMAIL` if explicitly set, otherwise
  // reads the DB session owner only when it is unambiguous (dev-only,
  // narrowly gated — see dev-session.ts).
  //
  // This wrap is intentionally a single point of injection: it covers
  // both the local-action branch and the fall-through to core scripts
  // (db-query, db-exec, …) so every CLI entrypoint runs scoped to a real
  // user. It uses `runWithRequestContext` rather than mutating
  // `process.env.AGENT_USER_EMAIL` because env mutation leaks across
  // boundaries — see the cautionary comment in
  // `server/request-context.ts` about exactly that pattern.
  const userEmail = await resolveDevUserEmail();
  const orgId = process.env.AGENT_ORG_ID || undefined;

  return runWithRequestContext({ userEmail, orgId }, () =>
    dispatchAction(actionName, args, options),
  );
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

/**
 * Build the `ctx` passed as the action's second arg for CLI dispatch. The
 * identity comes from the `runWithRequestContext` wrap in `runScript` (which
 * resolves `AGENT_USER_EMAIL` / the dev session); we never inject a dev
 * identity here beyond what that wrap already established.
 */
function cliActionCtx(
  actionName: string,
): import("../action.js").ActionRunContext {
  return {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId() ?? null,
    caller: "cli",
    actionName,
  };
}

async function dispatchAction(
  actionName: string,
  args: string[],
  options: RunScriptOptions,
): Promise<void> {
  // 1. Try local app action first (actions/ then scripts/ for backwards compat)
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
      // Support defineAction-style default exports (object with run method)
      if (
        handler &&
        typeof handler === "object" &&
        typeof handler.run === "function"
      ) {
        const parsed = parseActionArgs(args, { coerceBooleans: true });
        const result = await handler.run(parsed, cliActionCtx(actionName));
        if (handler.readOnly !== true) {
          await notifyActionChange({ actionName }).catch(() => {});
        }
        if (result) console.log(result);
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
      console.error(`Action "${actionName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 2. Try package-contributed actions (e.g. @agent-native/dispatch)
  const packageAction = options.packageActions?.[actionName];
  if (packageAction) {
    try {
      await runAppDbPluginIfPresent();
      const parsed = parseActionArgs(args, { coerceBooleans: true });
      const result = await packageAction.run(
        parsed as Record<string, string>,
        cliActionCtx(actionName),
      );
      if (packageAction.readOnly !== true) {
        await notifyActionChange({ actionName }).catch(() => {});
      }
      if (result) console.log(result);
      await closeDbExec().catch(() => {});
      process.exit(0);
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(`Action "${actionName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 3. Fall back to core scripts
  const coreScript = coreScripts[actionName];
  if (coreScript) {
    try {
      await coreScript(args);
      await closeDbExec().catch(() => {});
      process.exit(0);
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(`Core action "${actionName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 4. Not found anywhere
  console.error(
    `Error: Action "${actionName}" not found. Run "pnpm action --help" for available actions.`,
  );
  process.exit(1);
}
