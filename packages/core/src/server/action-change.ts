import {
  ACTION_CHANGE_MARKER_KEY,
  actionChangeMarkerSession,
  actionChangeMarkerValue,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { appStatePut } from "../application-state/store.js";
import { recordChange } from "./poll.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export interface NotifyActionChangeOptions {
  actionName: string;
  owner?: string;
  orgId?: string;
}

function actionChangeTarget(
  options: NotifyActionChangeOptions,
): ActionChangeTarget {
  const owner = options.owner ?? getRequestUserEmail() ?? undefined;
  return {
    actionName: options.actionName,
    owner,
    orgId: owner ? undefined : (options.orgId ?? getRequestOrgId()),
  };
}

export async function writeActionChangeMarker(
  options: NotifyActionChangeOptions,
): Promise<void> {
  const target = actionChangeTarget(options);
  const sessionId = actionChangeMarkerSession(target);
  if (!sessionId) return;
  await appStatePut(
    sessionId,
    ACTION_CHANGE_MARKER_KEY,
    {
      ...actionChangeMarkerValue(target),
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    { requestSource: "agent" },
  );
}

export async function notifyActionChange(
  options: NotifyActionChangeOptions,
): Promise<void> {
  const target = actionChangeTarget(options);
  recordChange({
    source: "action",
    type: "change",
    key: options.actionName,
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
  });

  await writeActionChangeMarker({
    actionName: options.actionName,
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
  });
}
