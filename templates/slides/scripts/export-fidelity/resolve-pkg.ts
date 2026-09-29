import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKTREE_ROOT = path.resolve(SCRIPT_DIR, "../../../../");
export const SLIDES_ROOT = path.join(WORKTREE_ROOT, "templates/slides");
const PNPM_DIR = path.join(WORKTREE_ROOT, "node_modules/.pnpm");

export function resolvePnpmEntry(name: string, versionPrefix: string): string {
  const match = readdirSync(PNPM_DIR).find((entry) =>
    entry.startsWith(`${name}@${versionPrefix}`),
  );
  if (!match) {
    throw new Error(
      `Could not find ${name}@${versionPrefix}* under ${PNPM_DIR}`,
    );
  }
  const pkgDir = path.join(PNPM_DIR, match, "node_modules", name);
  const pkgJson = JSON.parse(
    readFileSync(path.join(pkgDir, "package.json"), "utf8"),
  );
  const main = pkgJson.main ?? "index.js";
  return pathToFileURL(path.join(pkgDir, main)).href;
}

export function pick<T>(mod: any, key: string): T {
  return mod[key] ?? mod.default?.[key];
}
