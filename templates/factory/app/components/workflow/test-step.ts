import type { NodeKind } from "@/lib/workflow-editor";

import type { NodeAudit } from "./items/read-types";

/** Each item an AI step is tested on costs a model call, and a few are enough to tune a step on. */
const TEST_STEP_SAMPLE_ITEMS = 3;

/** A trigger and a source make their own items, so testing one pins none. */
export function stepNeedsItems(kind: NodeKind): boolean {
  return kind !== "trigger" && kind !== "source";
}

/**
 * The inbox items a step last received in a run of the whole workflow, from
 * the newest of the audits given. Only an item in the inbox can be pinned, and
 * the audit titles exactly those.
 */
export function sampleItemIdsFor(
  audits: readonly (NodeAudit | undefined)[],
): string[] {
  const steps = audits
    .flatMap((audit) => (audit?.latest ? [audit.latest] : []))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const step of steps) {
    const ids = [
      ...new Set(
        step.in.flatMap((input) =>
          input.items
            .filter((item) => item.title !== null)
            .map((item) => item.itemId),
        ),
      ),
    ];
    if (ids.length > 0) return ids.slice(0, TEST_STEP_SAMPLE_ITEMS);
  }
  return [];
}
