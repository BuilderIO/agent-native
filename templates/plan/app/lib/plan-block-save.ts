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

/**
 * Whether the live document already settled this overlap, so there's nothing to
 * ask. While someone else is in it, it merges what they type with what this tab
 * types, so a save of theirs overlaps with a document that already holds their
 * text. Structured data isn't in the document, so it can still really overlap.
 */
export function liveDocumentSettledOverlap(
  { fields, mine, theirs }: SaveOverlap<PlanBlock[]>,
  otherEditorIsLive: boolean,
): boolean {
  if (!otherEditorIsLive) return false;
  return fields.every((path) => {
    const id = path.split(".")[0];
    const block = [...mine, ...theirs].find((candidate) => candidate.id === id);
    return !block || block.type === "rich-text";
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
