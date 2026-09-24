// Resolves packages straight out of the pnpm store for scripts that live
// under templates/slides/scripts/ and aren't in any package.json's own
// dependency graph (repo rule: no new package.json / patches here). See
// README.md.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// export-fidelity/ -> scripts/ -> slides/ -> templates/ -> worktree root
export const WORKTREE_ROOT = path.resolve(SCRIPT_DIR, "../../../../");
export const SLIDES_ROOT = path.join(WORKTREE_ROOT, "templates/slides");
const PNPM_DIR = path.join(WORKTREE_ROOT, "node_modules/.pnpm");

/** file:// URL to a package's main entry, found by scanning the pnpm store
 * directly (`<name>@<versionPrefix>...`). */
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

/** CJS/ESM interop: named export if present, else fall back to .default.<key>. */
export function pick<T>(mod: any, key: string): T {
  return mod[key] ?? mod.default?.[key];
}
