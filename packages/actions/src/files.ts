import fs from "node:fs";
import path from "node:path";

const DEFAULT_ACTION_EXTENSIONS = new Set([".ts", ".js"]);

export class ActionNameCollisionError extends TypeError {
  readonly actionDefinitionError = true;

  constructor(message: string) {
    super(message);
    this.name = "ActionDefinitionError";
  }
}

export interface ActionFileEntry {
  /** Path relative to the actions dir, with forward slashes (`billing/create-invoice.ts`). */
  relPath: string;
  /** Action name: the relative path without extension, segments joined by `-`. */
  name: string;
}

export interface ScanActionDirOptions {
  /** Allowed source file extensions (defaults to `[".ts", ".js"]`). */
  extensions?: ReadonlySet<string>;
}

export function actionNameFromRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/\.(?:tsx?|mts|mjs|js)$/, "")
    .split("/")
    .join("-");
}

function isActionSourceFile(
  filename: string,
  extensions: ReadonlySet<string>,
): boolean {
  if (filename.startsWith("_") || filename.startsWith(".")) return false;
  if (/\.d\.(?:ts|mts|cts)$/.test(filename)) return false;
  if (/\.(?:test|spec)\.(?:tsx?|mts|mjs|js)$/.test(filename)) return false;
  return extensions.has(path.extname(filename));
}

/**
 * Recursively lists action source files under `actionsDir`. Directories that
 * start with `_` or `.` (and `node_modules`) are skipped, like `_` files. Two
 * files deriving the same action name (`billing/create-invoice.ts` and
 * `billing-create-invoice.ts`) throw `ActionNameCollisionError` instead of one
 * silently shadowing the other. `skipTopLevel` names top-level files that are
 * never actions.
 */
export function scanActionDir(
  actionsDir: string,
  skipTopLevel: ReadonlySet<string> = new Set(),
  options: ScanActionDirOptions = {},
): ActionFileEntry[] {
  const extensions = options.extensions ?? DEFAULT_ACTION_EXTENSIONS;
  const found = new Map<string, ActionFileEntry>();

  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // coercion-ok: missing or unreadable actions directory yields an empty action list
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith("_") ||
          entry.name.startsWith(".") ||
          entry.name === "node_modules"
        ) {
          continue;
        }
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!isActionSourceFile(entry.name, extensions)) continue;
      const relPath = `${prefix}${entry.name}`;
      const name = actionNameFromRelPath(relPath);
      if (!prefix && skipTopLevel.has(name)) continue;
      const existing = found.get(name);
      if (existing) {
        throw new ActionNameCollisionError(
          `Action "${name}": "${existing.relPath}" and "${relPath}" both resolve to this name. Rename one of them.`,
        );
      }
      found.set(name, { relPath, name });
    }
  };

  walk(actionsDir, "");
  return [...found.values()];
}
