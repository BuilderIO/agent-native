import { planNotionCompatibleBlockTypes } from "./plan-block-registry.js";
import type { PlanBlock } from "./plan-content.js";

/**
 * Notion-sync compatibility. When a plan opts into "Sync to Notion", its blocks
 * must map to the content app's Notion-Flavored-Markdown (NFM) vocabulary
 * (`templates/content/shared/nfm.ts`) to round-trip into a Notion page. Plan
 * blocks that have NO NFM analog (wireframes, diagrams, tabs, code-tabs,
 * Mermaid, API endpoint/spec blocks, data models, diffs, file trees, JSON
 * explorers, annotated code, decisions, question forms, visual questions, custom HTML,
 * implementation maps) can't sync — they're flagged on enable and
 * excluded from the slash menu in compatible-only mode, and degrade to a
 * callout placeholder on push.
 */

/**
 * Prose / non-registry-atom NFM analogs. These round-trip to Notion but are not
 * registry atoms carrying a `notionCompatible` flag: `rich-text` and `callout`
 * are prose blocks rendered through the markdown path, and `image` is a native
 * editor node, not a registered block spec. They're unioned with the
 * registry-flagged atoms below so the allowlist stays single-sourced for the
 * blocks that DO live in the registry (checklist, table).
 */
const PROSE_NOTION_COMPATIBLE_TYPES: readonly string[] = [
  "rich-text",
  "callout",
  "image",
];

/**
 * Plan block types that DO round-trip to NFM (prose, callout, table, image,
 * tasks). The registry-atom members (checklist, table) are derived from the
 * shared block registry's `notionCompatible` flag
 * (`plan-block-registry.ts` → core `BlockRegistry.notionCompatibleTypes()`) so
 * the gating allowlist is single-sourced with content; the prose analogs are
 * unioned in.
 */
export const NOTION_COMPATIBLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...PROSE_NOTION_COMPATIBLE_TYPES,
  ...planNotionCompatibleBlockTypes(),
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
