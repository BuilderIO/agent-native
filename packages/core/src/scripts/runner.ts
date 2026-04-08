/**
 * Generic action dispatcher for @agent-native/core apps.
 *
 * Dynamically imports and runs actions from the app's actions/ directory.
 * Falls back to scripts/ directory for backwards compatibility, then to
 * core scripts (db-schema, db-query, db-exec, etc.) when no local action is found.
 *
 * Actions must export a default function: (args: string[]) => Promise<void>
 *
 * Usage: pnpm action <action-name> [--args]
 */

import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { coreScripts, getCoreScriptNames } from "./core-scripts.js";
import { closeDbExec } from "../db/client.js";

/**
 * Run the action dispatcher. Call this from your app's actions/run.ts (or scripts/run.ts):
 *
 *   import { runScript } from "@agent-native/core";
 *   runScript();
 */
export async function runScript(): Promise<void> {
  const actionName = process.argv[2];

  if (!actionName || actionName === "--help") {
    console.log(`Usage: pnpm action <action-name> [--arg value ...]`);
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
        // Parse --key=value and --key value pairs into a Record
        const parsed: Record<string, string> = {};
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (!arg.startsWith("--")) continue;
          const eqIdx = arg.indexOf("=");
          if (eqIdx > 0) {
            parsed[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
          } else {
            const key = arg.slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith("--")) {
              parsed[key] = next;
              i++;
            } else {
              parsed[key] = "true";
            }
          }
        }
        const result = await handler.run(parsed);
        if (result) console.log(result);
      } else if (typeof handler === "function") {
        await handler(args);
      } else {
        console.error(
          `Action "${actionName}" does not export a default function or defineAction.`,
        );
        process.exit(1);
      }
      await closeDbExec();
      return;
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(`Action "${actionName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 2. Fall back to core scripts
  const coreScript = coreScripts[actionName];
  if (coreScript) {
    try {
      await coreScript(args);
      await closeDbExec();
      return;
    } catch (err: any) {
      await closeDbExec().catch(() => {});
      console.error(`Core action "${actionName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 3. Not found anywhere
  console.error(
    `Error: Action "${actionName}" not found. Run "pnpm action --help" for available actions.`,
  );
  process.exit(1);
}
