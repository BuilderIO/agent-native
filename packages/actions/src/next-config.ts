import fs from "node:fs";
import path from "node:path";

import { generateActionArtifacts } from "./codegen.js";

export interface WithAgentNativeActionsOptions {
  /** Directory containing `actions/*.ts`. Defaults to `"actions"`. */
  actionsDir?: string;
  /** Output directory for generated static manifest & types. Defaults to `".generated"`. */
  generatedDir?: string;
  /** Project root directory. Defaults to `process.cwd()`. */
  projectRoot?: string;
}

const activeWatchers = new Map<string, fs.FSWatcher>();

/**
 * Wrap your `next.config.ts` to deterministically generate `.generated/actions.ts`
 * (static ES imports — works identically with Turbopack, Webpack, Vercel Serverless,
 * and `output: "standalone"`) and `.generated/action-types.d.ts`.
 */
export function withAgentNativeActions<TConfig extends Record<string, unknown>>(
  nextConfig: TConfig,
  options: WithAgentNativeActionsOptions = {},
): TConfig {
  const projectRoot = options.projectRoot ?? process.cwd();
  const actionsDir = options.actionsDir ?? "actions";
  const generatedDir = options.generatedDir ?? ".generated";

  generateActionArtifacts({
    projectRoot,
    actionsDir,
    generatedDir,
  });

  const absActionsDir = path.resolve(projectRoot, actionsDir);
  if (
    process.env["NODE_ENV"] !== "production" &&
    fs.existsSync(absActionsDir) &&
    !activeWatchers.has(absActionsDir)
  ) {
    try {
      const watcher = fs.watch(absActionsDir, () => {
        try {
          generateActionArtifacts({
            projectRoot,
            actionsDir,
            generatedDir,
          });
        } catch (err) {
          console.error(
            `[@agent-native/actions/next] Failed to regenerate actions manifest:`,
            err,
          );
        }
      });
      watcher.unref();
      activeWatchers.set(absActionsDir, watcher);
    } catch {
      return nextConfig;
    }
  }

  return nextConfig;
}
