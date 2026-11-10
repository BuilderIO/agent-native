import {
  mergeRecords,
  type RecordMerge,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";

import type { PlanBlock } from "./plan-content";

const OVERLAP_LABEL_LENGTH = 60;

// The editor writes only a prose block's markdown, so whatever else the saved
// block holds, such as `editable`, is nothing it changed.
function withSavedProseFields(
  blocks: PlanBlock[],
  saved: PlanBlock[],
): PlanBlock[] {
  const savedById = new Map(saved.map((block) => [block.id, block]));
  return blocks.map((block) => {
    const before = savedById.get(block.id);
    if (block.type !== "rich-text" || before?.type !== "rich-text") {
      return block;
    }
    return {
      ...before,
      data: { ...before.data, markdown: block.data.markdown },
    };
  });
}

/**
 * Three-way merge of a plan's blocks. `base` is the saved content this client's
 * edit started from, `local` the blocks it is trying to save, and `remote` the
 * content another writer saved first.
 */
export function mergePlanBlocks(
  base: PlanBlock[],
  local: PlanBlock[],
  remote: PlanBlock[],
): RecordMerge<PlanBlock[]> {
  return mergeRecords(base, withSavedProseFields(local, base), remote);
}

/** A block both writers changed, named the way a reader would find it. */
export function describeOverlappingBlock(
  path: string,
  { mine, theirs }: Pick<SaveOverlap<PlanBlock[]>, "mine" | "theirs">,
): string | null {
  const id = path.split(".")[0];
  const block =
    mine.find((candidate) => candidate.id === id) ??
    theirs.find((candidate) => candidate.id === id);
  if (!block) return null;
  if (block.type !== "rich-text") return block.title ?? null;
  const firstLine = block.data.markdown
    .split("\n")
    .map((line) => line.replace(/^[\s#>*-]+/, "").trim())
    .find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > OVERLAP_LABEL_LENGTH
    ? `${firstLine.slice(0, OVERLAP_LABEL_LENGTH)}…`
    : firstLine;
}
