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
 *
 * `live` is `null` while the document has not been filled yet. That is not the
 * same as an empty document: merging an empty one reads as someone deleting
 * every block, which the merge would then carry out and save.
 */
export function adoptSnapshot(
  base: PlanBlock[],
  live: PlanBlock[] | null,
  snapshot: PlanBlock[],
): { target: PlanBlock[]; keptLiveEdits: boolean } {
  if (live === null) return { target: snapshot, keptLiveEdits: false };
  const merged = mergePlanBlocks(base, live, snapshot);
  // Keep the live copy on overlap so the existing save path reports the
  // conflict instead of dropping either writer's data.
  if (!merged) return { target: live, keptLiveEdits: true };
  return { target: merged, keptLiveEdits: !sameBlocks(merged, snapshot) };
}

/**
 * The editor's document holds a structured block's id and type but not its
 * data, which lives in the blocks. A block with an id none of the blocks it can
 * be read from knows, and no data of its own, has data nothing here can supply.
 */
export class PlanBlockDataUnknownError extends Error {
  constructor(readonly blockIds: string[]) {
    super(
      `The data of block ${blockIds.join(", ")} is not known yet, so it cannot be saved.`,
    );
    this.name = "PlanBlockDataUnknownError";
  }
}

/** Blocks from every source by id, the earliest source winning. */
export function knownBlocksById(
  ...sources: PlanBlock[][]
): Map<string, PlanBlock> {
  const known = new Map<string, PlanBlock>();
  for (const blocks of sources) {
    for (const block of blocks) {
      if (!known.has(block.id)) known.set(block.id, block);
    }
  }
  return known;
}

/** Whether a structured block has no data and no known block to take it from. */
export function hasUnknownStructuredData(
  block: PlanBlock,
  known: ReadonlyMap<string, PlanBlock>,
): boolean {
  if (block.type === "rich-text" || known.has(block.id)) return false;
  const data = (block as { data?: unknown }).data;
  return (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length === 0
  );
}

/** Whether the live document holds something the latest saved copy does not. */
export function documentIsAheadOfSaved(
  live: PlanBlock[],
  saved: PlanBlock[],
): boolean {
  return !sameBlocks(live, saved);
}
