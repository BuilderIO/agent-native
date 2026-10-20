import {
  MAX_INLINE_ITEMS,
  MAX_STEP_OUTPUT_BYTES,
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
