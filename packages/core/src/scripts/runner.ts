/**
 * Generic script dispatcher for @agent-native/core apps.
 *
 * Dynamically imports and runs scripts from the app's scripts/ directory.
 * Scripts must export a default function: (args: string[]) => Promise<void>
 *
 * Usage: pnpm script <script-name> [--args]
 */

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
    process.exit(0);
  }

  // Validate script name (only allow alphanumeric + hyphens)
  if (!/^[a-z][a-z0-9-]*$/.test(scriptName)) {
    console.error(`Error: Invalid script name "${scriptName}"`);
    process.exit(1);
  }

  // Dynamically import and run the script
  try {
    const mod = await import(/* @vite-ignore */ `./${scriptName}.js`);
    const args = process.argv.slice(3);
    await mod.default(args);
  } catch (err: any) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      console.error(
        `Error: Script "${scriptName}" not found. Run "pnpm script --help" for usage.`,
      );
      process.exit(1);
    }
    console.error(`Script "${scriptName}" failed:`, err.message || err);
    process.exit(1);
  }
}
