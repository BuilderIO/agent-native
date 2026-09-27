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
