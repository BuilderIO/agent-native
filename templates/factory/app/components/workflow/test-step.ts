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
 * How many of a step's latest runs the test looks back over for one that gave
 * it items. A quiet stretch should not leave the step untestable, and items
 * from far back may no longer be open in the inbox.
 */
export const TEST_STEP_LOOKBACK_STEPS = 10;

export interface TestSample {
  itemIds: string[];
  /** The items came from a run older than the newest one that reached this step, which gave it none. */
  fromOlderRun: boolean;
}

/**
 * The inbox items a step last received in a run of the whole workflow. Each
 * audit already names, in `latest`, the newest step of its mode that took
 * items; of those, the newest wins. Only an item in the inbox can be pinned,
 * and the audit titles exactly those.
 */
export function testSampleFor(
  audits: readonly (NodeAudit | undefined)[],
): TestSample {
  const steps = audits
    .flatMap((audit) => (audit?.latest ? [audit.latest] : []))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const runs = audits
    .flatMap((audit) => audit?.steps ?? [])
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const newestRun = runs.length > 0 ? runs[0] : undefined;
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
    if (ids.length > 0) {
      return {
        itemIds: ids.slice(0, TEST_STEP_SAMPLE_ITEMS),
        fromOlderRun: newestRun !== undefined && newestRun.runId !== step.runId,
      };
    }
  }
  return { itemIds: [], fromOlderRun: false };
}
