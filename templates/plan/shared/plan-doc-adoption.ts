import { mergePlanBlocks } from "./plan-blocks-merge";
import type { PlanBlock } from "./plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "./plan-doc";

/**
 * Blocks as the document would serialize them, so that a saved copy and the
 * document compare equal when only fields the editor does not write
 * (`editable`) differ.
 */
export function normalizeBlocksValue(input: string): string {
  try {
    const parsed = JSON.parse(input) as PlanBlock[];
    return JSON.stringify(proseJSONToBlocks(blocksToProseJSON(parsed), parsed));
  } catch {
    return input;
  }
}

// The editor leaves `editable` off the prose blocks it writes back.
function withoutProseEditable(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.map((block) => {
    if (block.type !== "rich-text") return block;
    const { editable: _editable, ...rest } = block;
    return rest as PlanBlock;
  });
}

function sameBlocks(a: PlanBlock[], b: PlanBlock[]): boolean {
  return (
    normalizeBlocksValue(JSON.stringify(withoutProseEditable(a))) ===
    normalizeBlocksValue(JSON.stringify(withoutProseEditable(b)))
  );
}

/**
 * What the live document should hold after another writer's saved `snapshot`
 * arrives. `base` is the saved copy the document was last brought up to and
 * `live` what it holds now. The snapshot is merged in rather than replacing the
 * document, because the document holds collaborators' typing that the snapshot
 * predates. `keptLiveEdits` says the result holds more than the snapshot, which
 * no one else will save.
 */
export function adoptSnapshot(
  base: PlanBlock[],
  live: PlanBlock[],
  snapshot: PlanBlock[],
): { target: PlanBlock[]; keptLiveEdits: boolean } {
  const merged = mergePlanBlocks(base, live, snapshot);
  // Overlapping edits to structure leave nothing to merge; the snapshot wins,
  // as it did before documents were merged.
  if (!merged) return { target: snapshot, keptLiveEdits: false };
  return { target: merged, keptLiveEdits: !sameBlocks(merged, snapshot) };
}

/** Whether the live document holds something the latest saved copy does not. */
export function documentIsAheadOfSaved(
  live: PlanBlock[],
  saved: PlanBlock[],
): boolean {
  return !sameBlocks(live, saved);
}
