/**
 * Auto-discover actions from a template's actions/ directory.
 *
 * Scans for .ts/.js files and builds an action registry suitable for
 * `createAgentChatPlugin({ actions })`.
 *
 * Supports two action conventions:
 *
 * 1. **Full interface** — exports `tool: ActionTool` and `run(args): Promise<string>`.
 *    These are used directly.
 *
 * 2. **CLI-style** — exports only `default async function(args: string[])`.
 *    These are wrapped: args are converted from `Record<string, string>` to
 *    `["--key", "value", ...]`, console output is captured, and a tool
 *    definition is synthesized from the action name.
 *
 * 3. **defineAction** — exports `default` from `defineAction()`. Has `tool` and `run`.
 *
 * Usage in agent-chat plugins:
 * ```ts
 * import { autoDiscoverActions } from "@agent-native/core/server";
 *
 * export default createAgentChatPlugin({
 *   actions: () => autoDiscoverActions(import.meta.url),
 * });
 * ```
 */
import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

/** Files to skip during auto-discovery (no extension). */
const SKIP_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
]);

/** Sentinel thrown by our process.exit interceptor */
class ExitIntercepted extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/**
 * Split a string into shell-like tokens, handling double and single quotes.
 * `--title "My Page" --content ""` → `["--title", "My Page", "--content", ""]`
 */
function splitShellArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let wasQuoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      wasQuoted = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      wasQuoted = true;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current.length > 0 || wasQuoted) {
        tokens.push(current);
        current = "";
        wasQuoted = false;
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || wasQuoted) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Wrap a CLI-style action (that writes to console.log) as an ActionEntry
 * by capturing stdout/stderr and intercepting process.exit.
 */
function wrapDefaultExport(
  name: string,
  defaultFn: (args: string[]) => Promise<void>,
): ActionEntry {
  const tool: ActionTool = {
    description: `Run the "${name}" action. Pass arguments as key-value pairs.`,
    parameters: {
      type: "object",
      properties: {
        args: {
          type: "string",
          description:
            "Space-separated CLI arguments (e.g. '--id abc --title Hello')",
        },
      },
    },
  };

  return {
    tool,
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      // If only an "args" key was provided, split it into CLI tokens
      if (args.args && Object.keys(args).length === 1) {
        cliArgs.push(...splitShellArgs(args.args));
      } else {
        for (const [k, v] of Object.entries(args)) {
          cliArgs.push(`--${k}`, v);
        }
      }

      const logs: string[] = [];
      const origLog = console.log;
      const origError = console.error;
      const origStdoutWrite = process.stdout.write;
      const origExit = process.exit;

      console.log = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };
      console.error = (...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      };
      process.stdout.write = ((chunk: any) => {
        if (typeof chunk === "string") {
          logs.push(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          logs.push(chunk.toString());
        }
        return true;
      }) as any;
      process.exit = ((code?: number) => {
        throw new ExitIntercepted(code ?? 0);
      }) as never;

      try {
        await defaultFn(cliArgs);
      } catch (err: any) {
        if (!(err instanceof ExitIntercepted)) {
          logs.push(`Error: ${err?.message ?? String(err)}`);
        }
      } finally {
        console.log = origLog;
        console.error = origError;
        process.stdout.write = origStdoutWrite;
        process.exit = origExit;
      }
      return logs.join("\n") || "(no output)";
    },
  };
}

/**
 * Resolve the actions directory from the caller's context.
 *
 * @param from - Either an `import.meta.url` (file:// URL from a plugin file),
 *   an absolute directory path, or "auto" to use `process.cwd() + "/actions"`.
 *   When an import.meta.url is provided, the actions directory is resolved as
 *   `../../actions/` relative to the caller (typically `server/plugins/agent-chat.ts`).
 *   If the resolved directory doesn't exist, falls back to `../../scripts/` for
 *   backwards compatibility, then to `process.cwd() + "/actions"`.
 */
function resolveActionsDir(from: string): string {
  if (from.startsWith("file://") || from.startsWith("file:///")) {
    const callerPath = fileURLToPath(from);
    const callerDir = nodePath.dirname(callerPath);
    // Try actions/ first
    const actionsResolved = nodePath.resolve(callerDir, "../../actions");
    if (fs.existsSync(actionsResolved)) return actionsResolved;
    // Fall back to scripts/ for backwards compat
    const scriptsResolved = nodePath.resolve(callerDir, "../../scripts");
    if (fs.existsSync(scriptsResolved)) return scriptsResolved;
    // In bundled environments import.meta.url may not reflect the source layout.
    // Fall back to cwd-based resolution.
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (fs.existsSync(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  if (from === "auto") {
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (fs.existsSync(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  return nodePath.resolve(from);
}

/**
 * Auto-discover actions from a directory.
 *
 * @param from - The caller's `import.meta.url` or an absolute path to the
 *   actions directory.
 * @returns A record mapping action names to ActionEntry objects, suitable for
 *   passing to `createAgentChatPlugin({ actions })`.
 */
export async function autoDiscoverActions(
  from: string,
): Promise<Record<string, ActionEntry>> {
  const actionsDir = resolveActionsDir(from);
  const registry: Record<string, ActionEntry> = {};

  let files: string[];
  try {
    files = fs.readdirSync(actionsDir);
  } catch (err: any) {
    console.warn(
      `[autoDiscoverActions] Could not read actions directory: ${actionsDir} — ${err?.message}`,
    );
    return registry;
  }

  const actionFiles = files.filter((f) => {
    if (!f.endsWith(".ts") && !f.endsWith(".js")) return false;
    const name = f.replace(/\.(ts|js)$/, "");
    if (name.startsWith("_")) return false;
    if (SKIP_FILES.has(name)) return false;
    return true;
  });

  for (const file of actionFiles) {
    const name = file.replace(/\.(ts|js)$/, "");
    const filePath = nodePath.join(actionsDir, file);

    try {
      const mod = await import(/* @vite-ignore */ filePath);

      if (mod.tool && typeof mod.run === "function") {
        // Full interface: has both tool definition and run function
        registry[name] = { tool: mod.tool, run: mod.run };
      } else if (
        mod.default &&
        typeof mod.default === "object" &&
        mod.default.tool &&
        typeof mod.default.run === "function"
      ) {
        // defineAction style: default export has tool + run
        registry[name] = { tool: mod.default.tool, run: mod.default.run };
      } else if (typeof mod.default === "function") {
        // CLI-style: only has a default export function
        registry[name] = wrapDefaultExport(name, mod.default);
      } else {
        // Neither pattern — skip silently
      }
    } catch {
      // CLI-style scripts (top-level execution) will throw on import.
      // This is expected — they'll be available via `pnpm action <name>` / shell instead.
    }
  }

  return registry;
}

/** @deprecated Use `autoDiscoverActions` instead */
export const autoDiscoverScripts = autoDiscoverActions;
