import type { RefinementCtx } from "zod";

type PlanInputSources = {
  content?: unknown;
  screens?: readonly unknown[];
  transitions?: readonly unknown[];
  states?: readonly unknown[];
  components?: readonly unknown[];
};

export function rejectMixedPlanSources(
  value: PlanInputSources,
  ctx: RefinementCtx,
): void {
  if (!value.content) return;

  const conflictingFields = [
    ["screens", value.screens],
    ["transitions", value.transitions],
    ["states", value.states],
    ["components", value.components],
  ] as const;

  for (const [field, entries] of conflictingFields) {
    if (!entries || entries.length === 0) continue;
    ctx.addIssue({
      code: "custom",
      path: [field],
      message:
        `content is a complete visual-plan replacement; do not pass ${field} ` +
        "alongside it. Remove content or provide the full content payload.",
    });
  }
}
