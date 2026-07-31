import {
  ACTION_CHANGE_MARKER_KEY,
  actionChangeMarkerSession,
  actionChangeMarkerValue,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import type { ActionPlanModeConfig } from "../action.js";
import { appStatePut } from "../application-state/store.js";
import { recordChange } from "./poll.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

/**
 * Whether THIS invocation should announce a change.
 *
 * `readOnly` describes an action name, but a tool that discriminates on an
 * argument reads on some calls and writes on others — `manage-agent-engine`
 * with `action: "list"` is a status poll, with `action: "set"` a write. Such
 * actions already publish the per-call answer as a Plan-mode `effect`
 * predicate, so read it here instead of treating every call as a write: a poll
 * that bumps the `"action"` change version makes every query keyed on it
 * refetch forever.
 *
 * `readOnly` stays authoritative otherwise. Widening the flag to cover mixed
 * tools would also open them to read-only A2A peers and to the agent's
 * read-result cache, where it would be false.
 */
export function actionCallIsReadOnly(
  entry: { readOnly?: boolean; planMode?: ActionPlanModeConfig<any> },
  params: unknown,
  fallback: boolean,
): boolean {
  const effect = entry.planMode?.effect;
  if (typeof effect === "function") {
    try {
      return effect(params) === "read";
    } catch {
      // A predicate that throws says nothing; fall through to the flag.
    }
  }
  if (typeof entry.readOnly === "boolean") return entry.readOnly;
  return fallback;
}

export interface NotifyActionChangeOptions {
  actionName: string;
  owner?: string;
  orgId?: string;
  requestSource?: string;
}

function actionChangeTarget(
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
    { requestSource: options.requestSource ?? "agent" },
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
    ...(options.requestSource ? { requestSource: options.requestSource } : {}),
  });

  await writeActionChangeMarker({
    actionName: options.actionName,
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
    ...(options.requestSource ? { requestSource: options.requestSource } : {}),
  });
}
