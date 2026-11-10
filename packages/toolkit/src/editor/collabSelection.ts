import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

interface SyncBinding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
  beforeTransactionSelection: unknown;
}

/** The text selection y-sync saves as Yjs positions before it applies a change. */
interface SavedTextSelection {
  type: "text";
  anchor: Y.RelativePosition | null;
  head: Y.RelativePosition | null;
  absAnchor: number;
  absHead: number;
}

function savedTextSelection(value: unknown): SavedTextSelection | null {
  const saved = value as Partial<SavedTextSelection> | null;
  if (
    saved?.type !== "text" ||
    typeof saved.absAnchor !== "number" ||
    typeof saved.absHead !== "number"
  ) {
    return null;
  }
  return saved as SavedTextSelection;
}

/**
 * Whether the doc still has the character a cursor sat after. y-sync anchors
 * a cursor to the character before it, so a collaborator typing at or before
 * the cursor leaves that character, and the cursor, where they were.
 */
function isAfterLiveCharacter(
  doc: Y.Doc,
  position: Y.RelativePosition | null,
): position is Y.RelativePosition {
  const id = position?.item;
  if (!id || Y.getState(doc.store, id.client) <= id.clock) return false;
  return !Y.getItem(doc.store, id).deleted;
}

/**
 * Whether two positions sit in blocks of the same types and attributes, from
 * the textblock out to the doc. When they don't, the Yjs position landed in a
 * block whose attributes moved, such as a block id or colour that went with a
 * moved block. y-tiptap's own recovery matches blocks by those attributes.
 */
function sameBlocks($a: ResolvedPos, $b: ResolvedPos) {
  if ($a.depth !== $b.depth) return false;
  for (let depth = 1; depth <= $a.depth; depth += 1) {
    if (!$a.node(depth).sameMarkup($b.node(depth))) return false;
  }
  return true;
}

/** Where a doc's textblocks match `isBlock`, and how many match `isLanded`. */
function textblockCensus(
  doc: ProseMirrorNode,
  isBlock: (node: ProseMirrorNode) => boolean,
  isLanded: (node: ProseMirrorNode) => boolean,
) {
  const blocks: number[] = [];
  let landed = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (isBlock(node)) blocks.push(pos);
    else if (isLanded(node)) landed += 1;
    return false;
  });
  return { blocks, landed };
}

/** Matches textblocks with the same type, attributes and text, sizes first. */
function copiesOf(block: ProseMirrorNode) {
  const text = block.textContent;
  return (node: ProseMirrorNode) =>
    node.sameMarkup(block) &&
    node.content.size === block.content.size &&
    node.textContent === text;
}

/**
 * Finds the cursor's textblock after a collaborator moved it. y-sync can send
 * a textblock moved among others of the same type as each one's text
 * rewritten in place, and a rewrite keeps the cursor's character when the two
 * texts share it, such as a closing period. A move shows as the textblock the
 * Yjs position landed in now holding another textblock's old text, which a
 * collaborator typing in it doesn't produce. And a move only rearranges
 * textblocks: the cursor's old textblock, text and attributes alike, must sit
 * in exactly one textblock elsewhere, and the text it was replaced with must
 * be no more common than before.
 */
function positionInMovedBlock(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  $old: ResolvedPos,
  $resolved: ResolvedPos,
) {
  const block = $old.parent;
  const isBlock = copiesOf(block);
  if (!block.isTextblock || !block.textContent || isBlock($resolved.parent)) {
    return null;
  }
  // This runs on every keystroke a collaborator sends, so typing stops after
  // one pass over the old doc, and only a move reads the new one.
  const isLanded = copiesOf($resolved.parent);
  const before = textblockCensus(oldDoc, isBlock, isLanded);
  if (before.landed === 0 || before.blocks.length !== 1) return null;
  const after = textblockCensus(newDoc, isBlock, isLanded);
  if (after.landed !== before.landed || after.blocks.length !== 1) return null;
  const start = after.blocks.at(0);
  return start === undefined ? null : start + 1 + $old.parentOffset;
}

function endpointAfterRemoteChange(
  binding: SyncBinding,
  position: Y.RelativePosition | null,
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  oldPos: number,
) {
  if (
    oldPos > oldDoc.content.size ||
    !isAfterLiveCharacter(binding.doc, position)
  ) {
    return null;
  }
  const resolved = relativePositionToAbsolutePosition(
    binding.doc,
    binding.type,
    position,
    binding.mapping as never,
  );
  if (resolved === null || resolved > newDoc.content.size) return null;
  const $old = oldDoc.resolve(oldPos);
  const $resolved = newDoc.resolve(resolved);
  if (!sameBlocks($old, $resolved)) return null;
  return positionInMovedBlock(oldDoc, newDoc, $old, $resolved) ?? resolved;
}

/**
 * Keeps the cursor where Yjs puts it when a collaborator types in the same
 * block. After a change from Yjs, y-tiptap 3.0.7 distrusts the Yjs position
 * whenever the cursor's block text changed, and looks for the cursor by the
 * block's old text instead. A collaborator typing in that block always
 * changes its text, so the cursor lands back where its offset used to be,
 * left of what the collaborator typed, and the next keystrokes go into the
 * middle of their word.
 *
 * While the character the cursor sat after survives, this plugin puts the
 * cursor back at the Yjs position, unless its block was moved. When that
 * character was deleted, the cursor sat at the start of a text, or the Yjs
 * position landed in a block of another type or attributes, it leaves
 * y-tiptap's choice alone.
 */
export function collabSelectionPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("collabSelection"),
    appendTransaction(transactions, _oldState, newState) {
      const change = transactions.find((tr) => {
        const meta = tr.getMeta(ySyncPluginKey) as
          | { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean }
          | undefined;
        // Selection-only changes from Yjs include the one this plugin appends.
        return (
          tr.docChanged &&
          meta?.isChangeOrigin === true &&
          !meta.isUndoRedoOperation
        );
      });
      if (!change) return null;
      const binding = ySyncPluginKey.getState(newState)?.binding as
        | SyncBinding
        | undefined;
      const saved = savedTextSelection(binding?.beforeTransactionSelection);
      if (!binding || !saved) return null;

      const restored = change.selection;
      const endpoint = (position: Y.RelativePosition | null, oldPos: number) =>
        endpointAfterRemoteChange(
          binding,
          position,
          change.before,
          change.doc,
          oldPos,
        );
      const anchorPos = endpoint(saved.anchor, saved.absAnchor);
      // A collapsed cursor saved the same Yjs position twice.
      const headPos =
        saved.absHead === saved.absAnchor
          ? anchorPos
          : endpoint(saved.head, saved.absHead);
      const anchor = anchorPos ?? restored.anchor;
      const head = headPos ?? restored.head;
      if (anchor === restored.anchor && head === restored.head) return null;

      // Plugins may have appended changes of their own since.
      const later = transactions.slice(transactions.indexOf(change) + 1);
      const map = (pos: number) =>
        later.reduce((mapped, tr) => tr.mapping.map(mapped), pos);
      const { doc } = newState;
      return newState.tr
        .setSelection(
          TextSelection.between(
            doc.resolve(map(anchor)),
            doc.resolve(map(head)),
          ),
        )
        .setMeta(ySyncPluginKey, { isChangeOrigin: true })
        .setMeta("addToHistory", false);
    },
  });
}
