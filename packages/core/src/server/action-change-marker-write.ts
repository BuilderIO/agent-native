import { publishActionChangeFastPath } from "../action-change-fast-path.js";
import {
  ACTION_CHANGE_MARKER_KEY,
  actionChangeMarkerSession,
  actionChangeMarkerValue,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { appStatePut } from "../application-state/store.js";
import { runAfterWriteDrains } from "../resource-changes/store.js";
import { platformWaitUntil, runInBackground } from "./background-work.js";
import {
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
} from "./request-context.js";

export interface NotifyActionChangeOptions {
  actionName: string;
  owner?: string;
  orgId?: string;
  requestSource?: string;
  /** Also notify every user who can read this resource. See `changeResource`. */
  resourceType?: string;
  resourceId?: string;
}

export function actionChangeTarget(
  options: NotifyActionChangeOptions,
): ActionChangeTarget {
  const owner = options.owner ?? getRequestUserEmail() ?? undefined;
  return {
    actionName: options.actionName,
    owner,
    orgId: owner ? undefined : (options.orgId ?? getRequestOrgId()),
    requestSource: options.requestSource,
    ...(options.resourceType && options.resourceId
      ? { resourceType: options.resourceType, resourceId: options.resourceId }
      : {}),
  };
}

export async function writeActionChangeMarker(
  options: NotifyActionChangeOptions,
): Promise<void> {
  const target = {
    ...actionChangeTarget(options),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  const sessionId = actionChangeMarkerSession(target);
  // The action changed data, so the database is awake: let change-feed
  // consumers such as the search index catch up without delaying the caller.
  runAfterWriteDrains(getRequestRunContext()?.waitUntil);
  if (!sessionId) return;
  publishActionChangeFastPath(target);
  await appStatePut(
    sessionId,
    ACTION_CHANGE_MARKER_KEY,
    actionChangeMarkerValue(target),
    { requestSource: options.requestSource ?? "agent" },
  );
}

/**
 * Writes the marker for a write response: the response goes out once the write
 * is with the platform (or after BACKGROUND_DEADLINE_MS without waitUntil), not
 * after the database answers. The fast-path publish inside still runs first.
 */
export async function writeActionChangeMarkerForResponse(
  options: NotifyActionChangeOptions,
): Promise<void> {
  const write = writeActionChangeMarker(options).catch((error: unknown) => {
    console.warn(
      "[action-change] durable marker write failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
  await runInBackground(
    write,
    getRequestRunContext()?.waitUntil ?? platformWaitUntil(),
  );
}
