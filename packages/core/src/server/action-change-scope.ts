import { AsyncLocalStorage } from "node:async_hooks";

import type { ActionChangeResource } from "../action.js";
import { ROLE_RANK, type ShareRole } from "../sharing/schema.js";

/**
 * The shareable resources one action call proved it may write, collected
 * while the call runs so core can name the change resource the action did not
 * declare.
 */
export interface ActionChangeScope {
  readonly writes: Map<string, ActionChangeResource>;
}

const scopes = new AsyncLocalStorage<ActionChangeScope>();

export function createActionChangeScope(): ActionChangeScope {
  return { writes: new Map() };
}

export function runInActionChangeScope<T>(
  scope: ActionChangeScope,
  run: () => T,
): T {
  return scopes.run(scope, run);
}

/** Called by the access checks once a caller is confirmed at `role`. */
export function noteResourceAccess(
  resourceType: string,
  resourceId: string,
  role: ShareRole | "owner",
): void {
  if (ROLE_RANK[role] < ROLE_RANK.editor) return;
  const scope = scopes.getStore();
  if (!scope || !resourceType || !resourceId) return;
  scope.writes.set(JSON.stringify([resourceType, resourceId]), {
    resourceType,
    resourceId,
  });
}

/**
 * The one resource the call asserted write access to. A call that wrote to
 * several resources has no single answer and must declare `changeResource`.
 */
export function derivedChangeResource(
  scope: ActionChangeScope | undefined,
): ActionChangeResource | undefined {
  if (!scope || scope.writes.size !== 1) return undefined;
  return scope.writes.values().next().value;
}
