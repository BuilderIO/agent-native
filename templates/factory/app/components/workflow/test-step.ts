import { testNeedsItems, type WorkflowNode } from "@/lib/workflow-editor";

import type { NodeAudit } from "./items/read-types";

/** Each item an AI step is tested on costs a model call, and a few are enough to tune a step on. */
const TEST_STEP_SAMPLE_ITEMS = 3;

/**
 * Whether testing a step has to wait for a run of the whole workflow to have
 * shown it items: the rule the server refuses a test by. A trigger and a source
 * make their own, and a lookup that reads nothing about an item (no `item.*`, no
 * `nodes.*`, nothing a model writes from the item) asks the same question of
 * every item, so it is tested on its own, once.
 */
export function stepNeedsItems(node: WorkflowNode): boolean {
  return testNeedsItems(node);
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
