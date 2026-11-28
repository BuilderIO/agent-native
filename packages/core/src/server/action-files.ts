import {
  ActionNameCollisionError,
  actionNameFromRelPath,
  scanActionDir as scanSharedActionDir,
  type ActionFileEntry,
} from "@agent-native/actions/files";

export { ActionNameCollisionError, actionNameFromRelPath };
export type { ActionFileEntry };

const CORE_ACTION_EXTENSIONS = new Set([".ts", ".js"]);

/**
 * Recursively lists action source files under `actionsDir`, delegating to
 * `@agent-native/actions/files` with Core's `.ts`/`.js` extension set.
 */
export function scanActionDir(
  actionsDir: string,
  skipTopLevel: ReadonlySet<string>,
): ActionFileEntry[] {
  return scanSharedActionDir(actionsDir, skipTopLevel, {
    extensions: CORE_ACTION_EXTENSIONS,
  });
}
