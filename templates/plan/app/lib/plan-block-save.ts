import {
  type SavedRecord,
  type SaveOverlap,
  type SaveWithMergeOptions,
} from "@agent-native/core/save-conflict";
import { mergePlanBlocks } from "@shared/plan-blocks-merge";
import type { PlanBlock } from "@shared/plan-content";
import { diffWordsWithSpace } from "diff";

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

/** What a writer added and removed, leaving out spacing, which a diff can align either way. */
function changedText(before: string, after: string) {
  let added = "";
  let removed = "";
  for (const change of diffWordsWithSpace(before, after)) {
    if (change.added) added += change.value;
    if (change.removed) removed += change.value;
  }
  return {
    added: added.replace(/\s/g, ""),
    removed: removed.replace(/\s/g, ""),
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
 * change only has to appear in order among what `live` changed.
 */
function holdsChange(base: string, live: string, theirs: string): boolean {
  const their = changedText(base, theirs);
  const held = changedText(base, live);
  return (
    containsInOrder(held.added, their.added) &&
    containsInOrder(held.removed, their.removed)
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
  /** The revision that save started from, which the plan has since moved past. */
  startedFrom: string | null;
  sent: PlanBlock[];
  saved: SavedPlanBlocks;
}

/**
 * What the next save starts from: the newer of what this tab last saved and what
 * the document was last brought up to. A merged save holds more than this tab
 * sent, and the document may not have that yet, so it comes in here instead of
 * being written over. Once the document has it, later edits were made on top of
 * it, so taking it out again is an edit like any other.
 */
export function startBlockSave(
  own: OwnBlockSave | null,
  documentBase: SavedPlanBlocks | null | undefined,
  planAsLoaded: SavedPlanBlocks | null,
  blocks: PlanBlock[],
): { base: SavedPlanBlocks; mine: PlanBlock[] } {
  if (documentBase?.revision && documentBase.revision === own?.saved.revision) {
    return { base: documentBase, mine: blocks };
  }
  const loaded = documentBase ?? planAsLoaded;
  if (
    own &&
    (!loaded || (own.saved.revision ?? "") >= (loaded.revision ?? ""))
  ) {
    const rebased = mergePlanBlocks(own.sent, blocks, own.saved.value);
    if (rebased.ok) return { base: own.saved, mine: rebased.merged };
    // The document changed something that save's merge brought in. Sent from a
    // revision the plan has moved past, this comes back as a conflict, which asks.
    return {
      base: { value: own.sent, revision: own.startedFrom },
      mine: blocks,
    };
  }
  if (!loaded) throw new Error("A plan revision is required to save blocks.");
  return { base: loaded, mine: blocks };
}
