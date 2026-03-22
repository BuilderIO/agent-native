/**
 * Generic script dispatcher for @agent-native/core apps.
 *
 * Dynamically imports and runs scripts from the app's scripts/ directory.
 * Falls back to core scripts (db-schema, db-query, db-exec, etc.) when
 * no local script is found.
 *
 * Scripts must export a default function: (args: string[]) => Promise<void>
 *
 * Usage: pnpm script <script-name> [--args]
 */

import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { coreScripts, getCoreScriptNames } from "./core-scripts.js";

/**
 * Run the script dispatcher. Call this from your app's scripts/run.ts:
 *
 *   import { runScript } from "@agent-native/core";
 *   runScript();
 */
export async function runScript(): Promise<void> {
  const scriptName = process.argv[2];

  if (!scriptName || scriptName === "--help") {
    console.log(`Usage: pnpm script <script-name> [--arg value ...]`);
    console.log(`\nRun any script with --help for usage details.`);

    // List local scripts
    const localDir = path.resolve(process.cwd(), "scripts");
    if (fs.existsSync(localDir)) {
      const locals = fs
        .readdirSync(localDir)
        .filter((f) => f.endsWith(".ts") && f !== "run.ts")
        .map((f) => f.replace(/\.ts$/, ""));
      if (locals.length > 0) {
        console.log(`\nApp scripts:`);
        for (const name of locals) {
          console.log(`  ${name}`);
        }
      }
    }

    // List core scripts
    const coreNames = getCoreScriptNames();
    if (coreNames.length > 0) {
      console.log(`\nCore scripts (built-in):`);
      for (const name of coreNames) {
        console.log(`  ${name}`);
      }
    }

    process.exit(0);
  }

  // Validate script name (only allow alphanumeric + hyphens)
  if (!/^[a-z][a-z0-9-]*$/.test(scriptName)) {
    console.error(`Error: Invalid script name "${scriptName}"`);
    process.exit(1);
  }

  const args = process.argv.slice(3);

  // 1. Try local app script first
  const scriptPath = path.resolve(process.cwd(), "scripts", `${scriptName}.ts`);

  if (fs.existsSync(scriptPath)) {
    try {
      const mod = await import(
        /* @vite-ignore */ pathToFileURL(scriptPath).href
      );
      await mod.default(args);
      return;
    } catch (err: any) {
      console.error(`Script "${scriptName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 2. Fall back to core scripts
  const coreScript = coreScripts[scriptName];
  if (coreScript) {
    try {
      await coreScript(args);
      return;
    } catch (err: any) {
      console.error(`Core script "${scriptName}" failed:`, err.message || err);
      process.exit(1);
    }
  }

  // 3. Not found anywhere
  console.error(
    `Error: Script "${scriptName}" not found. Run "pnpm script --help" for available scripts.`,
  );
  process.exit(1);
}
