import { publishActionChangeFastPath } from "../action-change-fast-path.js";
import {
  ACTION_CHANGE_MARKER_KEY,
  actionChangeMarkerSession,
  actionChangeMarkerValue,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { appStatePut } from "../application-state/store.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export interface NotifyActionChangeOptions {
  actionName: string;
  owner?: string;
  orgId?: string;
  requestSource?: string;
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
  if (!sessionId) return;
  publishActionChangeFastPath(target);
  await appStatePut(
    sessionId,
    ACTION_CHANGE_MARKER_KEY,
    actionChangeMarkerValue(target),
    { requestSource: options.requestSource ?? "agent" },
  );
}
