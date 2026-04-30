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
import nodePath from "node:path";
import { captureCliOutput } from "./cli-capture.js";

// Lazy fs — loaded via dynamic import() on first use.
// Avoids require() which bundlers convert to createRequire() that crashes on CF Workers.
let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}
import { fileURLToPath } from "node:url";

/** Files to skip during auto-discovery (no extension). */
const SKIP_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
]);

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
      }
      current = "";
      wasQuoted = false;
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
 * by capturing stdout/stderr and intercepting process.exit. Uses the
 * shared AsyncLocalStorage-backed capture so concurrent invocations do
 * not corrupt the global `console.log` / `process.stdout.write` /
 * `process.exit` pointers (see `cli-capture.ts`).
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
      return captureCliOutput(() => defaultFn(cliArgs));
    },
  };
}

function preserveActionFlags(entry: Record<string, any>): Partial<ActionEntry> {
  const out: Partial<ActionEntry> = {};
  if (typeof entry.readOnly === "boolean") out.readOnly = entry.readOnly;
  if (typeof entry.toolCallable === "boolean") {
    out.toolCallable = entry.toolCallable;
  }
  return out;
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
async function resolveActionsDir(from: string): Promise<string> {
  const fs = await getFs();
  const exists = (p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };
  // On edge runtimes (e.g. Cloudflare Workers), import.meta.url may be
  // undefined after bundling. Fall back to cwd-based discovery.
  if (!from) {
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  if (from.startsWith("file://") || from.startsWith("file:///")) {
    const callerPath = fileURLToPath(from);
    const callerDir = nodePath.dirname(callerPath);
    const actionsResolved = nodePath.resolve(callerDir, "../../actions");
    if (exists(actionsResolved)) return actionsResolved;
    const scriptsResolved = nodePath.resolve(callerDir, "../../scripts");
    if (exists(scriptsResolved)) return scriptsResolved;
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  if (from === "auto") {
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  return nodePath.resolve(from);
}

/**
 * Load actions from a single directory into the given registry. Shared by
 * both the template-actions discovery path and the workspace-core actions
 * layer. When `skipExisting` is true, an entry with the same name that's
 * already in the registry is left untouched (template-wins on collision).
 */
async function loadActionsIntoRegistry(
  actionsDir: string,
  registry: Record<string, ActionEntry>,
  skipExisting: boolean,
): Promise<void> {
  let files: string[];
  try {
    const fs = await getFs();
    if (!fs.existsSync(actionsDir)) return;
    files = fs.readdirSync(actionsDir);
  } catch {
    return;
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
    if (skipExisting && registry[name]) continue;

    const filePath = nodePath.join(actionsDir, file);
    try {
      const mod = await import(/* @vite-ignore */ filePath);

      if (mod.tool && typeof mod.run === "function") {
        registry[name] = {
          tool: mod.tool,
          run: mod.run,
          ...(mod.http !== undefined ? { http: mod.http } : {}),
          ...preserveActionFlags(mod),
        };
      } else if (
        mod.default &&
        typeof mod.default === "object" &&
        mod.default.tool &&
        typeof mod.default.run === "function"
      ) {
        registry[name] = {
          tool: mod.default.tool,
          run: mod.default.run,
          ...(mod.default.http !== undefined ? { http: mod.default.http } : {}),
          ...preserveActionFlags(mod.default),
        };
      } else if (typeof mod.default === "function") {
        registry[name] = wrapDefaultExport(name, mod.default);
      }
    } catch {
      // CLI-style scripts (top-level execution) throw on import.
      // Expected — they're available via `pnpm action <name>` / shell instead.
    }
  }
}

/**
 * Normalize a pre-bundled static action registry (name → raw module) into
 * the `Record<string, ActionEntry>` shape the agent-chat plugin expects.
 *
 * Used by `autoDiscoverActions` when `.generated/actions-registry.ts` is
 * present so that Nitro-bundled serverless functions (Netlify, Vercel,
 * AWS-Lambda) can serve `/_agent-native/actions/*` routes without relying
 * on a filesystem scan that doesn't work in bundled output.
 */
export function loadActionsFromStaticRegistry(
  modules: Record<string, unknown>,
): Record<string, ActionEntry> {
  const registry: Record<string, ActionEntry> = {};
  for (const [name, raw] of Object.entries(modules)) {
    const mod = raw as Record<string, any> | null | undefined;
    if (!mod) continue;

    if (mod.tool && typeof mod.run === "function") {
      registry[name] = {
        tool: mod.tool,
        run: mod.run,
        ...(mod.http !== undefined ? { http: mod.http } : {}),
        ...preserveActionFlags(mod),
      };
      continue;
    }

    const def = mod.default;
    if (
      def &&
      typeof def === "object" &&
      def.tool &&
      typeof def.run === "function"
    ) {
      registry[name] = {
        tool: def.tool,
        run: def.run,
        ...(def.http !== undefined ? { http: def.http } : {}),
        ...preserveActionFlags(def),
      };
      continue;
    }

    if (typeof def === "function") {
      registry[name] = wrapDefaultExport(name, def);
    }
  }
  return registry;
}

/**
 * Auto-discover actions from a directory.
 *
 * Merges in any actions from the enterprise workspace core (if present in
 * the ancestor chain). Template actions take precedence over workspace-core
 * actions on name collision, so an app can override an enterprise-wide
 * action by dropping a same-named file under its own `actions/`.
 *
 * Note: this helper uses a filesystem scan, which works in dev and in
 * non-bundled Node deployments. In bundled serverless functions (Nitro's
 * netlify / vercel / aws-lambda presets) the `actions/` directory is not
 * on disk at runtime; templates should pass the static registry generated
 * by the Vite plugin to `createAgentChatPlugin({ actions })` instead, so
 * the bundler sees static imports and pulls every action into the bundle.
 *
 * @param from - The caller's `import.meta.url` or an absolute path to the
 *   actions directory.
 * @returns A record mapping action names to ActionEntry objects, suitable for
 *   passing to `createAgentChatPlugin({ actions })`.
 */
export async function autoDiscoverActions(
  from: string,
): Promise<Record<string, ActionEntry>> {
  const actionsDir = await resolveActionsDir(from);
  const registry: Record<string, ActionEntry> = {};

  // 1. Template actions first — these are the authoritative layer for the
  //    current app and must override any workspace-core entry with the same
  //    name.
  try {
    await loadActionsIntoRegistry(actionsDir, registry, false);
  } catch (err: any) {
    console.warn(
      `[autoDiscoverActions] Could not read actions directory: ${actionsDir} — ${err?.message}`,
    );
  }

  // 1b. Fallback: if filesystem discovery found no template actions (common
  //     in bundled serverless environments like Netlify/Vercel where the
  //     actions/ directory doesn't exist on disk), try importing the
  //     generated static registry at .generated/actions-registry.
  //
  //     This prevents the silent-empty-tools footgun where the agent has no
  //     template actions and falls back to generic tools like web-request.
  //     Prefer `loadActionsFromStaticRegistry` over `autoDiscoverActions` for
  //     production reliability — this fallback is a safety net, not the
  //     primary path.
  if (Object.keys(registry).length === 0 && from) {
    try {
      let registryPath: string;
      if (from.startsWith("file://") || from.startsWith("file:///")) {
        const callerDir = nodePath.dirname(fileURLToPath(from));
        registryPath = nodePath.resolve(
          callerDir,
          "../../.generated/actions-registry.js",
        );
      } else {
        registryPath = nodePath.resolve(
          from,
          "../.generated/actions-registry.js",
        );
      }
      const mod = await import(/* @vite-ignore */ registryPath);
      const staticEntries = loadActionsFromStaticRegistry(mod.default || mod);
      Object.assign(registry, staticEntries);
      if (Object.keys(staticEntries).length > 0) {
        console.log(
          `[autoDiscoverActions] Filesystem scan found 0 actions — loaded ${Object.keys(staticEntries).length} from .generated/actions-registry.ts instead. ` +
            `Consider switching to loadActionsFromStaticRegistry(actionsRegistry) for production reliability.`,
        );
      }
    } catch {
      // No generated registry available — registry stays empty.
    }
  }

  // If still empty after all fallbacks, warn loudly.
  if (Object.keys(registry).length === 0) {
    console.warn(
      `[autoDiscoverActions] WARNING: No template actions found! ` +
        `The agent will have no template-specific tools. ` +
        `If in production, switch from autoDiscoverActions to loadActionsFromStaticRegistry. ` +
        `See: https://docs.agent-native.com/actions#static-registry`,
    );
  }

  // 2. Workspace-core actions — merged in with skipExisting so they can't
  //    overwrite template entries.
  try {
    const { getWorkspaceCoreExports } =
      await import("../deploy/workspace-core.js");
    const ws = await getWorkspaceCoreExports(process.cwd());
    if (ws && ws.actionsDir) {
      await loadActionsIntoRegistry(ws.actionsDir, registry, true);
    }
  } catch {
    // workspace-core discovery unavailable (e.g. edge runtime) — skip.
  }

  // 3. Framework-level sharing actions — always available to any template
  //    that registers a shareable resource. Merged with skipExisting so
  //    templates can override by providing a same-named file.
  try {
    await mergeCoreSharingActions(registry);
  } catch {
    // Ignore — templates without sharing still work.
  }

  return registry;
}

export async function mergeCoreSharingActions(
  registry: Record<string, ActionEntry>,
): Promise<void> {
  const entries: Array<[string, () => Promise<any>]> = [
    ["share-resource", () => import("../sharing/actions/share-resource.js")],
    [
      "unshare-resource",
      () => import("../sharing/actions/unshare-resource.js"),
    ],
    [
      "list-resource-shares",
      () => import("../sharing/actions/list-resource-shares.js"),
    ],
    [
      "set-resource-visibility",
      () => import("../sharing/actions/set-resource-visibility.js"),
    ],
  ];
  for (const [name, loader] of entries) {
    if (registry[name]) continue;
    try {
      const mod = await loader();
      const def = mod.default;
      if (def && def.tool && typeof def.run === "function") {
        registry[name] = {
          tool: def.tool,
          run: def.run,
          ...(def.http !== undefined ? { http: def.http } : {}),
          ...(def.readOnly === true ? { readOnly: true } : {}),
        };
      }
    } catch {
      // Skip any sharing action that fails to import.
    }
  }
}

/** @deprecated Use `autoDiscoverActions` instead */
export const autoDiscoverScripts = autoDiscoverActions;
