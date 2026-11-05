import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

/** Non-blank variables already in `env` win over the workspace root `.env`. */
export function withWorkspaceRootEnv(
  root: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return env;
  const defined = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  return { ...dotenv.parse(fs.readFileSync(file)), ...defined };
}

/** The app `/` should open, or null when `WORKSPACE_DEFAULT_APP` names no app in the workspace. */
export function resolveWorkspaceDefaultApp(
  env: NodeJS.ProcessEnv,
  appIds: readonly string[],
): string | null {
  const id = env.WORKSPACE_DEFAULT_APP?.trim();
  return id && appIds.includes(id) ? id : null;
}
