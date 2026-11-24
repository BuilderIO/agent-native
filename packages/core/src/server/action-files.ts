import nodeFs from "node:fs";
import nodePath from "node:path";

class ActionNameCollisionError extends TypeError {
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

export function actionNameFromRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/\.(ts|js)$/, "")
    .split("/")
    .join("-");
}

function isActionSourceFile(filename: string): boolean {
  if (!/\.(ts|js)$/.test(filename)) return false;
  if (/\.d\.ts$/.test(filename)) return false;
  if (/\.(test|spec)\.(ts|js)$/.test(filename)) return false;
  return !filename.startsWith("_");
}

/**
 * Recursively lists action source files under `actionsDir`. Directories that
 * start with `_` or `.` are helpers and are skipped, like `_` files. Two files
 * deriving the same action name (`billing/create-invoice.ts` and
 * `billing-create-invoice.ts`) throw instead of one silently shadowing the other.
 * `skipTopLevel` names top-level files that are never actions.
 */
export function scanActionDir(
  actionsDir: string,
  skipTopLevel: ReadonlySet<string>,
): ActionFileEntry[] {
  const found = new Map<string, ActionFileEntry>();

  const walk = (dir: string, prefix: string): void => {
    let entries: nodeFs.Dirent[];
    try {
      entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    } catch {
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
        walk(nodePath.join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!isActionSourceFile(entry.name)) continue;
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
