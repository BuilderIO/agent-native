import { WorkflowError, type WorkflowNode } from "./contract.js";
import { operationArgs, pathsReadBy } from "./graph-validation.js";

/** The one blank item a test of a step with no per-item input runs on. */
export const STANDALONE_TEST_ITEM_ID = "test-no-item";

/**
 * Whether a step can be tested before any run has shown it an item: a lookup
 * that reads only the workflow's settings and the run, with no field a model
 * writes from the item. Such a lookup asks the same question of every item, so
 * a test runs it once on a blank item. A step that reads `item.*` or
 * `nodes.*`, and every other kind of step, still needs real items.
 */
export function canTestWithoutItems(node: WorkflowNode): boolean {
  if (node.kind !== "lookup") return false;
  if (
    Object.values(operationArgs(node) ?? {}).some(
      (binding) => binding.mode === "ai",
    )
  ) {
    return false;
  }
  try {
    return pathsReadBy(node).every(
      (path) => path.root === "settings" || path.root === "run",
    );
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    // coercion-ok: a path that does not parse is the validator's to report; here it only means the step is not known to be item-free
    return false;
  }
}

/**
 * Whether a test of this one step has to be given items to run on. A trigger
 * and a source make their own, and a lookup that reads nothing about an item
 * runs once on a blank one. Every other step runs on the items it is given, and
 * with none it would run on nothing and still read as clean, so a test of it
 * without items is refused instead of started.
 */
export function testNeedsItems(node: WorkflowNode): boolean {
  return (
    node.kind !== "trigger" &&
    node.kind !== "source" &&
    !canTestWithoutItems(node)
  );
}
