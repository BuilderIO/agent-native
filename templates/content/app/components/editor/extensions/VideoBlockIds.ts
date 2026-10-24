import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

import { commentAnchorBlockList } from "../comment-block-anchors";
import { createContentBlockId } from "./registryBlocks";

export interface VideoBlockIdsOptions {
  /** Whether a change is this tab's own edit, which may write ids. */
  isEdit: (transaction: Transaction) => boolean;
  canAssign?: () => boolean;
}

const savedBlockId = (node: PMNode) =>
  typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";

/**
 * Writes down the id comments use for each video. A video keeps the id it had
 * before the change, including the one derived for a video saved without one,
 * and so does each of two videos that already share an id, since nothing says
 * which one a thread on it meant; commenting on one gives it an id of its own.
 * Any other video, such as a new one or a copy of one on the page, keeps a
 * saved id only if no video had it, and otherwise gets a fresh one. Only an
 * editing tab's own edit writes, so a suggestion, a read-only view or another
 * tab's change never does, and every tab arrives at the same ids.
 */
export const VideoBlockIds = Extension.create<VideoBlockIdsOptions>({
  name: "videoBlockIds",

  addOptions() {
    return { isEdit: () => false, canAssign: undefined };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    // A plugin's follow-up, such as the trailing paragraph after a remote
    // change, is only as much this tab's edit as the change it follows. A
    // collaborative undo or redo rebuilds the whole document, so no video maps
    // to its old place, and nothing written in reply reaches other tabs; the
    // undo already brings back the ids the page had.
    const isEdit = (transaction: Transaction) => {
      const root =
        (transaction.getMeta("appendedTransaction") as
          | Transaction
          | undefined) ?? transaction;
      return (
        !root.getMeta(ySyncPluginKey)?.isChangeOrigin && options.isEdit(root)
      );
    };
    return [
      new Plugin({
        key: new PluginKey("videoBlockIds"),
        appendTransaction(transactions, oldState, newState) {
          if (
            !editor.isEditable ||
            !transactions.some(isEdit) ||
            options.canAssign?.() === false
          )
            return null;

          const kept = new Map<number, string>();
          // Moving a video reinserts its node and resizing one writes a new
          // node over it, so mapping loses both. One saved with an id is found
          // again by that id. One saved without an id keeps its derived id only
          // when its own node comes back or a video with its source takes
          // exactly its place.
          const lost: { id: string; node: PMNode; from: number; to: number }[] =
            [];
          for (const block of commentAnchorBlockList(oldState.doc)) {
            if (block.blockType !== "video") continue;
            const node = oldState.doc.nodeAt(block.pos);
            let from = block.pos;
            let to = block.pos + (node?.nodeSize ?? 0);
            let deleted = false;
            for (const transaction of transactions) {
              const mapped = transaction.mapping.mapResult(from, 1);
              deleted ||= mapped.deleted;
              from = mapped.pos;
              to = transaction.mapping.map(to, -1);
            }
            if (!deleted) {
              kept.set(from, block.blockId);
              continue;
            }
            if (node) lost.push({ id: block.blockId, node, from, to });
          }
          const reserved = new Set([
            ...kept.values(),
            ...lost.map(({ id }) => id),
          ]);

          const used = new Set<string>();
          const take = (carries: (entry: (typeof lost)[number]) => boolean) => {
            const index = lost.findIndex(carries);
            return index < 0 ? undefined : lost.splice(index, 1)[0].id;
          };
          const tr = newState.tr;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "video") return true;
            const saved = savedBlockId(node);
            const keepsSaved =
              !!saved &&
              (kept.get(pos) === saved ||
                !!take((entry) => savedBlockId(entry.node) === saved) ||
                (!reserved.has(saved) && !used.has(saved)));
            const id = keepsSaved
              ? saved
              : (!saved &&
                  (kept.get(pos) ??
                    take((entry) => entry.node === node) ??
                    take(
                      (entry) =>
                        !savedBlockId(entry.node) &&
                        entry.from === pos &&
                        entry.to === pos + node.nodeSize &&
                        entry.node.attrs.src === node.attrs.src,
                    ))) ||
                createContentBlockId("video");
            used.add(id);
            if (id !== saved) tr.setNodeAttribute(pos, "blockId", id);
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
