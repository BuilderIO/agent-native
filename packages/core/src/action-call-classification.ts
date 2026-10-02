import type { ActionPlanModeConfig } from "./action.js";

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
