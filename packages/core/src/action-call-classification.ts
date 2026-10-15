import { coerceGatewayStringifiedArgs } from "./action-input-coercion.js";
import type { ActionChangeResource, ActionPlanModeConfig } from "./action.js";
import type { ActionTool } from "./agent/types.js";

export function actionCallIsReadOnly(
  entry: { readOnly?: boolean; planMode?: ActionPlanModeConfig<any> },
  params: unknown,
  fallback: boolean,
): boolean {
  const effect = entry.planMode?.effect;
  if (typeof effect === "string") return effect === "read";
  if (typeof effect === "function") {
    try {
      return effect(params) === "read";
    } catch {
      // coercion-ok: plan-mode hints must not make action dispatch fail
      // A predicate that throws says nothing; fall through to the flag.
    }
  }
  if (typeof entry.readOnly === "boolean") return entry.readOnly;
  return fallback;
}

/**
 * Whether re-running this call after an error or a lost result is safe. An
 * action opts in with `retrySafe`; an undeclared action is not, so an
 * ambiguous write keeps blocking the run. A predicate sees the arguments after
 * the same gateway-string repair schema validation applies (`"true"` already
 * `true`), never the raw model input a stringified flag could slip past a
 * strict comparison in.
 */
export function actionCallIsRetrySafe(
  entry: {
    retrySafe?: boolean | ((input: any) => boolean);
    tool?: { parameters?: ActionTool["parameters"] };
  },
  params: unknown,
): boolean {
  const { retrySafe } = entry;
  if (typeof retrySafe === "boolean") return retrySafe;
  if (typeof retrySafe !== "function") return false;
  try {
    return (
      retrySafe(
        coerceGatewayStringifiedArgs(params, entry.tool?.parameters),
      ) === true
    );
  } catch {
    // coercion-ok: a throwing predicate declares nothing, so the call stays
    // conservative (blocked) rather than being treated as safe to replay.
    return false;
  }
}

/**
 * Whether a successful call should publish an `action` change event.
 *
 * Read-only calls never do. An unclassified call does, on purpose: staying
 * quiet for an action nobody declared would hide real writes from other
 * sessions. A mutating action that never needs to refresh anyone else
 * (telemetry, playback position) opts out with `changeEvents: false`.
 */
export function actionCallEmitsChange(
  entry: {
    readOnly?: boolean;
    planMode?: ActionPlanModeConfig<any>;
    changeEvents?: boolean;
  },
  params: unknown,
  fallbackReadOnly: boolean,
): boolean {
  if (entry.changeEvents === false) return false;
  return !actionCallIsReadOnly(entry, params, fallbackReadOnly);
}

/**
 * The resource a successful call changed, for an action that declares
 * `changeResource`. A declaration that throws or returns something malformed
 * is a bug in the action: it is logged, and the event falls back to reaching
 * only the actor rather than failing a call that already succeeded.
 */
export function actionChangeResource(
  entry: {
    changeResource?: (
      input: any,
      result: any,
    ) => ActionChangeResource | null | undefined;
  },
  params: unknown,
  result: unknown,
): ActionChangeResource | undefined {
  if (!entry.changeResource) return undefined;
  try {
    const resource = entry.changeResource(params, result);
    if (!resource) return undefined;
    if (
      typeof resource.resourceType === "string" &&
      resource.resourceType &&
      typeof resource.resourceId === "string" &&
      resource.resourceId
    ) {
      return resource;
    }
    console.warn(
      "[action-change] changeResource returned no resourceType/resourceId; notifying only the actor",
    );
  } catch (error) {
    console.warn(
      "[action-change] changeResource threw; notifying only the actor:",
      error instanceof Error ? error.message : String(error),
    );
  }
  return undefined;
}
