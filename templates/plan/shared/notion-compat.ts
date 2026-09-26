import { planNotionCompatibleBlockTypes } from "./plan-block-registry.js";
import type { PlanBlock } from "./plan-content.js";


const PROSE_NOTION_COMPATIBLE_TYPES: readonly string[] = [
  "rich-text",
  "callout",
  "image",
];

export const NOTION_COMPATIBLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...PROSE_NOTION_COMPATIBLE_TYPES,
  ...planNotionCompatibleBlockTypes(),
]);

export function isNotionCompatibleBlockType(type: string): boolean {
  return NOTION_COMPATIBLE_BLOCK_TYPES.has(type);
}

export function getIncompatibleBlockCounts(
  blocks: PlanBlock[],
): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  const walk = (list: PlanBlock[]) => {
    for (const block of list) {
      if (!isNotionCompatibleBlockType(block.type)) {
        counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
      }
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) walk(tab.blocks);
      }
    }
  };
  walk(blocks);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function describeIncompatibleBlocks(blocks: PlanBlock[]): string | null {
  const counts = getIncompatibleBlockCounts(blocks);
  if (counts.length === 0) return null;
  return counts
    .map(({ type, count }) => `${count} ${type.replace(/-/g, " ")}`)
    .join(", ");
}
