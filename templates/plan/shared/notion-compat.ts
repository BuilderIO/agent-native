import type { PlanBlock } from "./plan-content.js";

/**
 * Notion-sync compatibility. When a plan opts into "Sync to Notion", its blocks
 * must map to the content app's Notion-Flavored-Markdown (NFM) vocabulary
 * (`templates/content/shared/nfm.ts`) to round-trip into a Notion page. Plan
 * blocks that have NO NFM analog (wireframes, diagrams, tabs, code-tabs,
 * decisions, question forms, visual questions, custom HTML, implementation maps) can't sync —
 * they're flagged on enable and excluded from the slash menu in compatible-only
 * mode, and degrade to a callout placeholder on push.
 */

/** Plan block types that DO round-trip to NFM (prose, callout, table, image, tasks). */
export const NOTION_COMPATIBLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "rich-text",
  "callout",
  "table",
  "image",
  "checklist",
]);

/** True when this block type round-trips to a Notion (NFM) block. */
export function isNotionCompatibleBlockType(type: string): boolean {
  return NOTION_COMPATIBLE_BLOCK_TYPES.has(type);
}

/** Per-type tally of blocks in a plan that cannot sync to Notion. */
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

/** Human summary for the enable-time warning, e.g. "2 wireframes, 1 tabs block". */
export function describeIncompatibleBlocks(blocks: PlanBlock[]): string | null {
  const counts = getIncompatibleBlockCounts(blocks);
  if (counts.length === 0) return null;
  return counts
    .map(({ type, count }) => `${count} ${type.replace(/-/g, " ")}`)
    .join(", ");
}
