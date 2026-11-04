import { WorkflowError, type WorkflowNode } from "../contract.js";
import {
  MAX_INLINE_ITEMS,
  MAX_STEP_OUTPUT_BYTES,
  assertWithinStepCap,
  jsonByteLength,
} from "../items.js";
import type { FlowItem, PortItems } from "./types.js";

/** What counts toward a step's output cap: the item as the next node will read it. */
export function capView(item: FlowItem): {
  id: string;
  data: FlowItem["data"];
  nodes: FlowItem["nodes"];
} {
  return { id: item.id, data: item.data, nodes: item.nodes };
}

export function emittedItems(itemsByPort: PortItems): FlowItem[] {
  return Object.values(itemsByPort).flatMap((items) => [...items]);
}

/**
 * The leading items that fit one step's cap. A source with more than a step
 * can hold takes what fits and says so; the caller records the cut.
 * `oversized` is set when even the first item does not fit, which no amount of
 * trimming the list can fix.
 */
export function takeWithinCap(
  items: readonly FlowItem[],
  maxItems: number = MAX_INLINE_ITEMS,
  maxBytes: number = MAX_STEP_OUTPUT_BYTES,
): { taken: FlowItem[]; oversized: boolean } {
  const taken: FlowItem[] = [];
  let bytes = 2;
  for (const item of items) {
    if (taken.length >= maxItems) break;
    const cost = jsonByteLength(capView(item)) + (taken.length > 0 ? 1 : 0);
    if (bytes + cost > maxBytes) break;
    taken.push(item);
    bytes += cost;
  }
  return { taken, oversized: taken.length === 0 && items.length > 0 };
}

const WHAT_TO_DO =
  "Narrow the request (a smaller page size, a more specific path or filter), ask the provider for fewer fields, or split the work so one step does not carry so much. The cap is not raised: large raw answers are not stored.";

function titleOf(node: WorkflowNode): string {
  return node.label === undefined
    ? `"${node.name}"`
    : `"${node.label}" (${node.name})`;
}

/** What weighs most on the items a step emits: the item itself and each earlier step's result still attached to it. */
function largestParts(
  items: readonly FlowItem[],
): { name: string; bytes: number }[] {
  const sizes = new Map<string, number>();
  const add = (name: string, value: unknown) =>
    sizes.set(
      name,
      (sizes.get(name) ?? 0) +
        jsonByteLength(value === undefined ? null : value),
    );
  for (const item of items) {
    add("the item itself", item.data);
    for (const [name, value] of Object.entries(item.nodes)) {
      add(`nodes.${name}`, value);
    }
  }
  return [...sizes]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3);
}

/**
 * Fails a step whose emitted items are too big for one step to hand on. The
 * measure is the whole step: every item it emits, each as the next node reads
 * it (`id`, `data` and every `nodes.<step>` result still attached), so a chain
 * of answers adds up item by item. The failure names the step, what weighs
 * most and what to do; the cap itself is not raised.
 */
export function assertStepWithinCap(
  node: WorkflowNode,
  items: readonly FlowItem[],
): void {
  try {
    assertWithinStepCap(items.map(capView));
  } catch (error) {
    if (!(error instanceof WorkflowError) || error.code !== "output_over_cap") {
      throw error;
    }
    const { bytes, maxBytes, maxItems } = error.details as {
      bytes: number;
      maxBytes: number;
      maxItems: number;
    };
    const largest = largestParts(items);
    const problem =
      items.length > maxItems
        ? `${items.length} items, and one step may hand on at most ${maxItems}`
        : `${bytes} bytes across ${items.length === 1 ? "its 1 item" : `${items.length} items`}, and one step may hand on at most ${maxBytes} bytes`;
    throw new WorkflowError(
      "output_over_cap",
      `Step ${titleOf(node)} cannot hand on what it produced: ${problem}. Each item counts as the next step reads it: the item itself plus every earlier step's result still attached to it. Largest: ${largest.map((part) => `${part.name} (${part.bytes} bytes)`).join(", ")}. ${WHAT_TO_DO}`,
      {
        node: node.name,
        items: items.length,
        bytes,
        maxItems,
        maxBytes,
        largest,
      },
    );
  }
}

/** Fails one item whose single answer is over the cap on its own, naming the step and the operation. */
export function assertAnswerWithinCap(
  node: WorkflowNode,
  operationId: string,
  output: unknown,
): void {
  try {
    assertWithinStepCap([output], { maxItems: 1 });
  } catch (error) {
    if (!(error instanceof WorkflowError) || error.code !== "output_over_cap") {
      throw error;
    }
    const { bytes, maxBytes } = error.details as {
      bytes: number;
      maxBytes: number;
    };
    throw new WorkflowError(
      "output_over_cap",
      `The answer of step ${titleOf(node)} (${operationId}) is ${bytes} bytes, and one step's result may hold at most ${maxBytes} bytes. ${WHAT_TO_DO}`,
      { node: node.name, operationId, bytes, maxBytes },
    );
  }
}
