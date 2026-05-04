import type { ActionEntry } from "@agent-native/core/server";

/**
 * Dispatch's actions registered as a flat name→entry map. Imported by
 * `@agent-native/dispatch/server`'s side-effect block, which calls
 * `registerPackageActions(dispatchActions)` so the framework's action
 * loader picks them up.
 *
 * Lifted incrementally — see `templates/dispatch/actions/` for the source.
 * Empty until the action lift completes (subsequent commits).
 */
export const dispatchActions: Record<string, ActionEntry> = {};
