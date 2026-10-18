import { coerceGatewayStringifiedArgs } from "./action-input-coercion.js";
import type {
  ActionChangeResource,
  ActionMcpToolAnnotations,
  ActionOutputEffect,
  ActionPlanModeConfig,
} from "./action.js";
import type { ActionTool } from "./agent/types.js";

/** One call's effect, as its action declares it for those arguments. */
export interface ActionCallClassification {
  /** Whether the call is read-only; `undefined` when nothing declares it. */
  readonly readOnly: boolean | undefined;
  /**
   * Whether plan mode may run the call: its `planMode` effect says it reads,
   * or, without `planMode`, the action is declared read-only. A predicate
   * that throws allows nothing.
   */
  readonly planModeRead: boolean;
}

/**
 * Classifies one call, running its `planMode.effect` predicate once, so every
 * gate that reads the result agrees with the run that consumes it.
 */
export function classifyActionCall(
  entry: { readOnly?: boolean; planMode?: ActionPlanModeConfig<any> },
  params: unknown,
): ActionCallClassification {
  const declared =
    typeof entry.readOnly === "boolean" ? entry.readOnly : undefined;
  const effect = entry.planMode?.effect;
  if (typeof effect === "string") {
    return { readOnly: effect === "read", planModeRead: effect === "read" };
  }
  if (typeof effect === "function") {
    try {
      const read = effect(params) === "read";
      return { readOnly: read, planModeRead: read };
    } catch {
      // coercion-ok: plan-mode hints must not make action dispatch fail
      // A predicate that throws says nothing; fall through to the flag.
    }
  }
  // Plan mode trusts a declared `planMode` alone, so one whose effect cannot
  // be read allows nothing there.
  return {
    readOnly: declared,
    planModeRead: !entry.planMode && declared === true,
  };
}

/**
 * Whether one call is read-only, or `undefined` when neither `planMode` nor
 * `readOnly` says.
 */
export function actionCallReadOnly(
  entry: { readOnly?: boolean; planMode?: ActionPlanModeConfig<any> },
  params: unknown,
): boolean | undefined {
  return classifyActionCall(entry, params).readOnly;
}

export function actionCallIsReadOnly(
  entry: { readOnly?: boolean; planMode?: ActionPlanModeConfig<any> },
  params: unknown,
  fallback: boolean,
): boolean {
  return actionCallReadOnly(entry, params) ?? fallback;
}

/**
 * What a call that ran has done, for a failure reported after it ran. Only a
 * call declared read-only changed nothing.
 */
export function actionOutputEffect(
  readOnly: boolean | undefined,
): ActionOutputEffect {
  return readOnly === true ? "none" : "committed";
}

/** `actionCallEmitsChange` for a call already classified. */
export function classifiedCallEmitsChange(
  entry: { changeEvents?: boolean },
  readOnly: boolean | undefined,
  fallbackReadOnly: boolean,
): boolean {
  if (entry.changeEvents === false) return false;
  return !(readOnly ?? fallbackReadOnly);
}

/**
 * Whether no call of this action can write. MCP has one hint and one OAuth
 * scope per tool, so it needs this rather than the per-call answer above:
 * `readOnly` is the in-app classification, which a plan-mode effect refines
 * per call, and an action whose writes its metadata cannot show declares
 * `readOnlyHint: false`.
 */
export function isMcpReadOnlyTool(entry: {
  readOnly?: boolean;
  planMode?: ActionPlanModeConfig<any>;
  mcpAnnotations?: ActionMcpToolAnnotations;
}): boolean {
  const effect = entry.planMode?.effect;
  return (
    entry.readOnly === true &&
    (effect === undefined || effect === "read") &&
    entry.mcpAnnotations?.readOnlyHint !== false
  );
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
  return classifiedCallEmitsChange(
    entry,
    actionCallReadOnly(entry, params),
    fallbackReadOnly,
  );
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
