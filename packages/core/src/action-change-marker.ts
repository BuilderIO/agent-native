export const ACTION_CHANGE_MARKER_KEY = "__action_change__";
export const ACTION_CHANGE_MARKER_ORG_PREFIX = "__org__:";

export interface ActionChangeTarget {
  actionName?: string;
  owner?: string;
  orgId?: string;
  requestSource?: string;
}

export function actionChangeMarkerSession(
  target: ActionChangeTarget,
): string | null {
  if (target.owner) return target.owner;
  if (target.orgId) return `${ACTION_CHANGE_MARKER_ORG_PREFIX}${target.orgId}`;
  return null;
}

export function actionChangeMarkerValue(
  target: ActionChangeTarget,
): Record<string, string> {
  return {
    source: "action",
    ...(target.actionName ? { actionName: target.actionName } : {}),
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
    ...(target.requestSource ? { requestSource: target.requestSource } : {}),
  };
}

export function parseActionChangeMarker(
  sessionId: unknown,
  value: unknown,
): ActionChangeTarget | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }

  let actionName: string | undefined;
  let owner: string | undefined;
  let orgId: string | undefined;
  let requestSource: string | undefined;

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    actionName =
      typeof record.actionName === "string" ? record.actionName : undefined;
    owner = typeof record.owner === "string" ? record.owner : undefined;
    orgId = typeof record.orgId === "string" ? record.orgId : undefined;
    requestSource =
      typeof record.requestSource === "string"
        ? record.requestSource
        : undefined;
  }

  if (!owner && !orgId && typeof sessionId === "string" && sessionId) {
    if (sessionId.startsWith(ACTION_CHANGE_MARKER_ORG_PREFIX)) {
      const parsedOrgId = sessionId.slice(
        ACTION_CHANGE_MARKER_ORG_PREFIX.length,
      );
      if (parsedOrgId) orgId = parsedOrgId;
    } else {
      owner = sessionId;
    }
  }

  if (!actionName && !owner && !orgId) return null;
  return { actionName, owner, orgId, requestSource };
}
