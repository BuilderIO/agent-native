import {
  rebaseOntoSaved,
  type SavedRecord,
  type SaveOverlap,
  type SaveWithMergeOptions,
} from "@agent-native/core/save-conflict";
import type { PlanBlock } from "@shared/plan-content";

/** A plan's saved blocks at one revision. */
export type SavedPlanBlocks = SavedRecord<PlanBlock[]>;

export type PlanBlocksOverlapResolver = NonNullable<
  SaveWithMergeOptions<PlanBlock[]>["resolveOverlap"]
>;

const MARKDOWN_PATH = ".data.markdown";

function markdownOf(blocks: PlanBlock[], id: string): string | null {
  const block = blocks.find((candidate) => candidate.id === id);
  return block?.type === "rich-text" ? block.data.markdown : null;
}

/** The span of `before` that was replaced to get `after`, and what replaced it. */
function changedSpan(before: string, after: string) {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start += 1;
  let tail = 0;
  while (
    tail < shorter - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return {
    start,
    end: before.length - tail,
    inserted: after.slice(start, after.length - tail),
  };
}

function containsInOrder(text: string, characters: string): boolean {
  let found = 0;
  for (let i = 0; i < text.length && found < characters.length; i += 1) {
    if (text[i] === characters[found]) found += 1;
  }
  return found === characters.length;
}

/**
 * Whether `live` has the change that turned `base` into `theirs`. Their copy can
 * hold part of what this tab typed, with the rest landing in between, so their
 * text only has to appear in order among what `live` changed.
 */
function holdsChange(base: string, live: string, theirs: string): boolean {
  const { start, end, inserted } = changedSpan(base, theirs);
  const removalNotApplied =
    end > start &&
    (live.startsWith(base.slice(0, end)) || live.endsWith(base.slice(start)));
  return (
    !removalNotApplied &&
    containsInOrder(changedSpan(base, live).inserted, inserted)
  );
}

/**
 * Whether the live document already has the other writer's side of this overlap.
 * A save from someone typing in the same document overlaps with a copy that has
 * their text, so there's nothing to ask. An agent's write isn't in the document,
 * and only prose is merged there, so anything else is a real overlap.
 */
export function documentHoldsTheirChanges(
  { fields, base, theirs }: SaveOverlap<PlanBlock[]>,
  live: PlanBlock[],
): boolean {
  return fields.every((path) => {
    if (!path.endsWith(MARKDOWN_PATH)) return false;
    const id = path.slice(0, -MARKDOWN_PATH.length);
    const before = markdownOf(base, id);
    const held = markdownOf(live, id);
    const other = markdownOf(theirs, id);
    return (
      before !== null &&
      held !== null &&
      other !== null &&
      holdsChange(before, held, other)
    );
  });
}

/** This tab's last save: what it was given, and what came back. */
export interface OwnBlockSave {
  planId: string;
  sent: PlanBlock[];
  saved: SavedPlanBlocks;
}

/**
 * What the next save starts from: the newer of what this tab last saved and what
 * the document was last brought up to. A merged save holds more than this tab
 * sent, and the document may not have that yet, so it comes in here instead of
 * being written over.
 */
export function startBlockSave(
  own: OwnBlockSave | null,
  loaded: SavedPlanBlocks | null,
  blocks: PlanBlock[],
): { base: SavedPlanBlocks; mine: PlanBlock[] } {
  if (
    own &&
    (!loaded || (own.saved.revision ?? "") >= (loaded.revision ?? ""))
  ) {
    return {
      base: own.saved,
      mine: rebaseOntoSaved(own.sent, blocks, own.saved.value),
    };
  }
  if (!loaded) throw new Error("A plan revision is required to save blocks.");
  return { base: loaded, mine: blocks };
}
